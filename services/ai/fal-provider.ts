import type { ImageAIProvider, ImageGenerationInput } from "@/services/ai/types";
import {
  buildCharacterSheetPrompt,
  buildColoringPagePrompt,
  buildCoverPrompt,
  buildNegativePrompt,
  buildReferenceGuidedScenePrompt,
  CHARACTER_SHEET_NEGATIVE_PROMPT,
} from "@/services/ai/prompts";
import { withRetry } from "@/lib/async";
import { isBlankOrTooFaint, hasPoorEnvironment, isColored } from "@/lib/image-quality";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";
import { StorageService } from "@/services/storage-service";
import { randomUUID } from "crypto";

/**
 * Whether an endpoint accepts a real `negative_prompt` param.
 * - Flux (schnell/dev/pro) IGNORES it and can 422 on strict schemas → folded into the positive prompt.
 * - Ideogram V3 and the SDXL/SD family DO accept it → send it for real.
 */
function endpointSupportsNegative(endpoint: string): boolean {
  if (process.env.FAL_SEND_NEGATIVE === "true") return true;
  if (process.env.FAL_SEND_NEGATIVE === "false") return false;
  return /ideogram|sdxl|stable-diffusion|stable_diffusion|sd-|lightning|playground/i.test(
    endpoint
  );
}

/**
 * Interior PAGES and the COVER default to Ideogram V3 (style DESIGN + expand_prompt:false +
 * negative_prompt): the A/B test scored it 0 blank / 0 colored / 0 poor-environment for clean
 * flat B&W line art. Override with FAL_PAGE_ENDPOINT (or legacy FAL_IMAGE_ENDPOINT).
 * When FAL_REF_ENDPOINT (Kontext) is set AND a validated hero portrait exists, pages+cover
 * are redrawn reference-guided from the hero for character consistency (phase-2 pipeline);
 * Ideogram remains the hero generator and the text-only fallback.
 */
const DEFAULT_PAGE_ENDPOINT = "https://fal.run/fal-ai/ideogram/v3";
/** Legacy flux/dev endpoint — kept available for override/fallback experiments. */
const DEFAULT_IMAGE_ENDPOINT = "https://fal.run/fal-ai/flux/dev";
const FAL_TIMEOUT_MS = Number(process.env.FAL_TIMEOUT_MS || 90_000);
const FAL_RETRY_ATTEMPTS = Number(process.env.FAL_RETRY_ATTEMPTS || 3);
/** Default guidance raised for stronger prompt adherence (environment + line weight). */
const DEFAULT_GUIDANCE_SCALE = Number(process.env.FAL_GUIDANCE_SCALE || 4.5);
/**
 * Extra quality re-rolls (fresh seed + stronger env instruction) when a page comes back
 * blank/near-blank OR as a subject floating on an empty background. Capped: after the
 * cap we KEEP THE BEST attempt (never fail the page — an empty page beats a failed one).
 */
const FAL_QUALITY_REROLLS = Number(process.env.FAL_QUALITY_REROLLS ?? 4);
const ENV_BOOST =
  "STRONGER ENVIRONMENT: fill the ENTIRE background with the scene setting (props, nature, weather, or architecture) reaching all page edges; absolutely no empty white void and no floating character.";
const LINEART_BOOST =
  "STRICT BLACK AND WHITE LINE ART ONLY: pure black outlines on white paper, absolutely NO color, no colored fills, no shading, no grey — a printable coloring page, NOT a colored illustration. No artist signature, no watermark, no text in the corners.";
/** Re-roll nudge when the hero cast portrait came back B&W (degenerate) instead of colored. */
const COLOR_SHEET_BOOST =
  "IMPORTANT: render the characters in soft flat COLORS (colored skin, hair, outfits and fur) with bold cartoon outlines — this reference portrait must NOT be black-and-white line art.";

export class FalImageProvider implements ImageAIProvider {
  private storage = new StorageService();

  async generateImage(input: ImageGenerationInput) {
    const key = process.env.FAL_KEY;
    if (!key) throw new Error("Missing FAL_KEY");

    // Ideogram V3 by default for pages+cover+sheet. `FAL_MODEL=flux` (or FAL_IMAGE_ENDPOINT)
    // switches back to the legacy flux/dev endpoint; FAL_PAGE_ENDPOINT overrides everything.
    const textEndpoint =
      process.env.FAL_PAGE_ENDPOINT?.trim() ||
      (process.env.FAL_MODEL === "flux" ? DEFAULT_IMAGE_ENDPOINT : "") ||
      process.env.FAL_IMAGE_ENDPOINT?.trim() ||
      DEFAULT_PAGE_ENDPOINT;
    const refEndpoint = process.env.FAL_REF_ENDPOINT?.trim() || "";

    const useReference =
      Boolean(refEndpoint) &&
      Boolean(input.referenceImageUrl) &&
      !input.isCharacterSheet;

    const prompt = buildPrompt(input, useReference);
    const endpoint = useReference ? refEndpoint : textEndpoint;
    // Short, high-adherence fallback used ONLY to rescue a persistently blank story page.
    const recoveryPrompt =
      !input.isCharacterSheet && !input.isCover
        ? buildRecoveryPrompt(input)
        : undefined;

    // Blank/near-blank guard: ALWAYS on (including the character model sheet). This now
    // triggers a capped re-roll and keeps the best attempt — it never fails the page.
    const validateNonBlank = true;
    // "No empty void" guard: story pages only (covers may be centered heroes by design).
    const validateEnvironment = !input.isCharacterSheet && !input.isCover;
    // "Must be B&W line art" guard: pages + cover (hero portrait stays COLORED).
    const validateLineArt = !input.isCharacterSheet;
    // Hero cast portrait plausibility gate: the proven reference is a COLORED flat-cartoon
    // portrait. A B&W result means the model ignored the brief and drifted (the exact
    // "two generic boys" failure) → treat "not colored" as a defect and re-roll.
    const requireColored = Boolean(input.isCharacterSheet);

    const body = buildFalBody({
      prompt,
      endpoint,
      isCharacterSheet: Boolean(input.isCharacterSheet),
      negativePrompt: input.negativePrompt,
      referenceImageUrl: useReference ? input.referenceImageUrl : undefined,
    });

    try {
      const result = await this.generateWithEnvRetry({
        endpoint,
        key,
        body,
        basePrompt: prompt,
        validateNonBlank,
        validateEnvironment,
        validateLineArt,
        requireColored,
        recoveryPrompt,
        label: useReference ? "fal-ref" : "fal",
      });

      // Reference-guided Kontext sometimes keeps the hero's colors despite the B&W prompt.
      // After re-rolls, if the page/cover is still colored, fall back to text-only Ideogram.
      if (
        useReference &&
        validateLineArt &&
        (await this.isStillColored(result.url))
      ) {
        console.warn(
          "fal reference output still colored after re-rolls; falling back to text-only Ideogram"
        );
        throw new Error("reference output colored");
      }

      return result;
    } catch (err) {
      // If reference path fails after retries, fall back to text-only with same locked prompt.
      if (useReference) {
        console.warn("fal reference generation failed; falling back to text-only", err);
        const fallbackPrompt = buildPrompt(input, false);
        const fallbackBody = buildFalBody({
          prompt: fallbackPrompt,
          endpoint: textEndpoint,
          isCharacterSheet: Boolean(input.isCharacterSheet),
          negativePrompt: input.negativePrompt,
        });
        return await this.generateWithEnvRetry({
          endpoint: textEndpoint,
          key,
          body: fallbackBody,
          basePrompt: fallbackPrompt,
          validateNonBlank,
          validateEnvironment,
          validateLineArt,
          requireColored,
          recoveryPrompt,
          label: "fal-fallback",
        });
      }
      throw err;
    }
  }

  /**
   * Quality-guard policy (never permanently fails a page):
   *  - Genuine network/provider errors are retried by `withRetry`.
   *  - "blank/near-blank" and "poor environment" are QUALITY signals: we re-roll with a
   *    fresh seed + stronger environment nudge up to `FAL_QUALITY_REROLLS` extra times,
   *    tracking the best attempt. After the cap we RETURN THE BEST image and keep the page.
   *    A slightly-empty page shipping as "completed" is better than a failed page.
   */
  private async generateWithEnvRetry(params: {
    endpoint: string;
    key: string;
    body: Record<string, unknown>;
    basePrompt: string;
    validateNonBlank: boolean;
    validateEnvironment: boolean;
    validateLineArt: boolean;
    /** Hero cast portrait must be COLORED (a B&W result = model ignored the brief). */
    requireColored?: boolean;
    /** Short, high-adherence prompt used only to rescue a persistently blank page. */
    recoveryPrompt?: string;
    label: string;
  }): Promise<{ url: string; provider: string }> {
    const {
      endpoint,
      key,
      body,
      basePrompt,
      validateNonBlank,
      validateEnvironment,
      validateLineArt,
      requireColored,
      recoveryPrompt,
      label,
    } = params;

    const wantsQualityCheck =
      validateNonBlank || validateEnvironment || validateLineArt || Boolean(requireColored);
    const maxRerolls = wantsQualityCheck ? FAL_QUALITY_REROLLS : 0;

    // Lower score = better (0 = clean). Keep the best attempt so we never fail the page.
    let best:
      | {
          url: string;
          provider: string;
          score: number;
          blank: boolean;
          needsUpload: boolean;
          pngBuffer?: Buffer;
        }
      | null = null;
    let lastError: unknown = null;
    // Track the previous attempt's defects so the next re-roll nudges the right way.
    let prevBlankOrEnv = false;
    let prevColored = false;
    let prevNotColored = false;

    for (let attempt = 0; attempt <= maxRerolls; attempt++) {
      if (attempt > 0) {
        // Fresh seed (fal randomizes when unset) + a nudge targeting the last defect.
        const nudges: string[] = [];
        if (prevColored) nudges.push(LINEART_BOOST);
        if (prevNotColored) nudges.push(COLOR_SHEET_BOOST);
        if (prevBlankOrEnv || (!prevColored && !requireColored)) nudges.push(ENV_BOOST);
        body.prompt = `${basePrompt} ${nudges.join(" ")}`;
      }

      let current: {
        url: string;
        provider: string;
        bytes?: Uint8Array;
        needsUpload?: boolean;
        pngBuffer?: Buffer;
      };
      try {
        current = await withRetry(() => callFal(endpoint, key, body, wantsQualityCheck), {
          attempts: FAL_RETRY_ATTEMPTS,
          delayMs: 1200,
          label,
        });
      } catch (err) {
        // Real provider/network failure for this attempt. If we already have any image,
        // stop and keep it; otherwise try another re-roll before giving up.
        lastError = err;
        if (best) break;
        continue;
      }

      const blank =
        validateNonBlank && current.bytes ? isBlankOrTooFaint(current.bytes) : false;
      const colored =
        validateLineArt && current.bytes ? isColored(current.bytes) : false;
      const poorEnv =
        validateEnvironment && current.bytes ? hasPoorEnvironment(current.bytes) : false;
      // Hero portrait plausibility: a NON-colored result means the model drifted to a
      // degenerate B&W sheet (the "two generic boys" failure) → defect, re-roll.
      const notColored =
        requireColored && current.bytes && !blank ? !isColored(current.bytes) : false;
      // A colored page is unusable as printable line art (weighted above a sparse B&W page);
      // a blank page is the worst. Lower total = better.
      const score = (blank ? 3 : 0) + (colored ? 2 : 0) + (notColored ? 2 : 0) + (poorEnv ? 1 : 0);
      prevBlankOrEnv = blank || poorEnv;
      prevColored = colored;
      prevNotColored = notColored;

      if (!best || score < best.score) {
        best = {
          url: current.url,
          provider: current.provider,
          score,
          blank,
          needsUpload: Boolean(current.needsUpload),
          pngBuffer: current.pngBuffer,
        };
      }

      if (score === 0) break; // clean page → accept immediately
      if (attempt < maxRerolls) {
        console.warn(
          `[${label}] quality re-roll (blank=${blank}, colored=${colored}, notColored=${notColored}, poorEnv=${poorEnv}); attempt ${attempt + 1}/${maxRerolls}`
        );
      }
    }

    // Last-resort rescue: if the best attempt is STILL blank, flux likely choked on the
    // long descriptive prompt. Retry with a short, high-adherence prompt a couple times —
    // short prompts render far more reliably. Keep the first non-blank result.
    if (best && best.blank && recoveryPrompt) {
      for (let r = 0; r < 2 && best.blank; r++) {
        body.prompt = recoveryPrompt;
        try {
          const rescue = await callFal(endpoint, key, body, true);
          const stillBlank = rescue.bytes ? isBlankOrTooFaint(rescue.bytes) : false;
          if (!stillBlank) {
            console.warn(`[${label}] blank page rescued via short prompt (try ${r + 1})`);
            best = {
              url: rescue.url,
              provider: rescue.provider,
              score: 0,
              blank: false,
              needsUpload: Boolean(rescue.needsUpload),
              pngBuffer: rescue.pngBuffer,
            };
            break;
          }
        } catch (err) {
          lastError = err;
        }
      }
    }

    // Only a total inability to produce ANY image is a real failure.
    if (!best) {
      throw lastError instanceof Error
        ? lastError
        : new Error("fal.ai produced no image");
    }
    if (best.score > 0) {
      console.warn(`[${label}] keeping best available image after re-rolls (score ${best.score})`);
    }

    // The raw fal URL for webp/other formats is unusable by pdf-lib and is short-lived;
    // persist the converted PNG to Storage and return that stable URL instead.
    if (best.needsUpload && best.pngBuffer) {
      try {
        const url = await this.storage.uploadBytes(
          `generated/${randomUUID()}.png`,
          best.pngBuffer,
          "image/png"
        );
        return { url, provider: best.provider };
      } catch (err) {
        console.warn(`[${label}] PNG upload failed; returning raw fal URL`, err);
      }
    }
    return { url: best.url, provider: best.provider };
  }

  /** Final check: did the shipped image fail the B&W line-art gate? */
  private async isStillColored(url: string): Promise<boolean> {
    try {
      const raw = new Uint8Array((await fetch(url).then((r) => r.arrayBuffer())) as ArrayBuffer);
      const bytes =
        detectImageFormat(raw) === "png" ? raw : new Uint8Array(await toPngBuffer(raw));
      return isColored(bytes);
    } catch {
      return false;
    }
  }
}

/**
 * Build the fal request body per endpoint family.
 * - Kontext (reference-guided): image-to-image; sends `image_url` + `prompt` only,
 *   NO `image_size`, NO `num_inference_steps`, NO `strength` (rejected by its schema).
 * - Flux text-to-image (dev/pro/schnell): `image_size` + steps/guidance.
 * - Other img2img endpoints keep the legacy `strength` param.
 */
function buildFalBody(params: {
  prompt: string;
  endpoint: string;
  isCharacterSheet: boolean;
  negativePrompt?: string;
  referenceImageUrl?: string;
}): Record<string, unknown> {
  const { prompt, endpoint, isCharacterSheet, negativePrompt, referenceImageUrl } = params;
  const isKontext = /kontext/i.test(endpoint);
  const isIdeogram = /ideogram/i.test(endpoint);
  const useReference = Boolean(referenceImageUrl);

  // Ideogram V3: DESIGN style + expand_prompt:false (disables MagicPrompt so OUR exact
  // prompt is used) + a real negative_prompt. NO steps/guidance/output_format in schema.
  if (isIdeogram) {
    const ideoBody: Record<string, unknown> = {
      prompt,
      image_size: "square_hd",
      num_images: 1,
      rendering_speed: "QUALITY",
      style: "DESIGN",
      expand_prompt: false,
    };
    // The hero cast portrait gets its own negative (blocks cast/species drift and B&W
    // degeneration); pages/cover get the standard coloring negative.
    ideoBody.negative_prompt = isCharacterSheet
      ? CHARACTER_SHEET_NEGATIVE_PROMPT
      : buildNegativePrompt(negativePrompt);
    return ideoBody;
  }

  const body: Record<string, unknown> = {
    prompt,
    num_images: 1,
    output_format: "png",
  };

  if (isKontext) {
    // Kontext derives size from the reference image; keep the body minimal.
    body.image_url = referenceImageUrl;
    body.guidance_scale = Number(
      process.env.FAL_REF_GUIDANCE || DEFAULT_GUIDANCE_SCALE
    );
    return body;
  }

  body.image_size = "square_hd";
  body.enable_safety_checker = true;

  // Send real negative_prompt only for models that accept it (Flux ignores/rejects it).
  if (endpointSupportsNegative(endpoint)) {
    body.negative_prompt = isCharacterSheet
      ? CHARACTER_SHEET_NEGATIVE_PROMPT
      : buildNegativePrompt(negativePrompt);
  }

  // flux/dev benefits from more steps; schnell ignores or caps low
  if (!endpoint.includes("schnell")) {
    body.num_inference_steps = Number(process.env.FAL_INFERENCE_STEPS || 28);
    body.guidance_scale = DEFAULT_GUIDANCE_SCALE;
  }

  // Legacy img2img endpoints (non-Kontext) still use `strength`.
  if (useReference) {
    body.image_url = referenceImageUrl;
    body.strength = Number(process.env.FAL_REF_STRENGTH || 0.55);
  }

  return body;
}

/**
 * Very short, high-adherence prompt for rescuing a page flux rendered blank. Long
 * descriptive prompts occasionally make flux/dev output near-white; a concise scene
 * line renders far more reliably. Keep the scene gist only + minimal B&W craft.
 */
function buildRecoveryPrompt(input: ImageGenerationInput): string {
  const scene = (input.prompt || "").slice(0, 240).trim();
  return [
    "Simple black and white line-art coloring page for young children.",
    scene ? `Scene: ${scene}.` : "",
    "Bold thick black outlines, big clear shapes, plenty of detail filling the whole page, plain white inside shapes.",
    "No color, no shading, no grey, no text, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildPrompt(input: ImageGenerationInput, useReference: boolean): string {
  if (input.isCharacterSheet) {
    return buildCharacterSheetPrompt({
      characters: input.characterBible || "",
      style: input.style,
    });
  }
  if (input.isCover) {
    if (useReference) {
      return buildReferenceGuidedScenePrompt({
        scene: `Coloring book COVER: inviting centered hero composition of the main cast IN a warm colorable environment matching the story. ${input.prompt}. Keep the exact character designs from the reference sheet. ABSOLUTELY NO TEXT: no letters, no words, no title, no numbers anywhere in the image.`,
        characters: input.characterBible || "",
        style: input.style,
        world: input.worldSetting || "",
      });
    }
    return buildCoverPrompt({
      title: input.prompt,
      characters: input.characterBible || "",
      style: input.style,
      summary: input.prompt,
    });
  }
  if (useReference) {
    return buildReferenceGuidedScenePrompt({
      scene: input.prompt,
      characters: input.characterBible || "",
      style: input.style,
      world: input.worldSetting || "",
    });
  }
  return buildColoringPagePrompt({
    scene: input.prompt,
    characters: input.characterBible || "",
    style: input.style,
    world: input.worldSetting || "",
    shotType: input.shotType,
    comicBeat: input.comicBeat,
    negativePrompt: input.negativePrompt,
  });
}

async function callFal(
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
  fetchBytes = false
): Promise<{
  url: string;
  provider: string;
  /** PNG bytes for the quality guards (converted from webp/etc when needed). */
  bytes?: Uint8Array;
  /** The raw fal URL is unusable downstream (webp) → upload the PNG buffer instead. */
  needsUpload?: boolean;
  /** PNG buffer to persist when needsUpload is true. */
  pngBuffer?: Buffer;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`fal.ai timeout after ${FAL_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai error: ${text}`);
  }

  const data = (await res.json()) as {
    images?: Array<{ url: string }>;
  };

  const url = data.images?.[0]?.url;
  if (!url || typeof url !== "string") {
    throw new Error("No image returned from fal.ai (empty images array)");
  }

  // Fetch the rendered bytes so the caller's quality guard can decide whether to re-roll
  // (blank / colored / poor-environment). The guards only decode PNG and pdf-lib only
  // embeds PNG/JPG, so we normalize: PNG stays as-is; webp/other is converted to PNG and
  // flagged for upload (its raw fal webp URL is unusable downstream). JPEG is kept (usable
  // by pdf-lib) but a PNG copy is still produced so the guards can analyze it.
  // We never throw on a blank/odd result here — quality is handled by the re-roll loop.
  if (fetchBytes) {
    try {
      const raw = new Uint8Array((await fetch(url).then((r) => r.arrayBuffer())) as ArrayBuffer);
      const fmt = detectImageFormat(raw);
      if (fmt === "png") {
        return { url, provider: "fal.ai", bytes: raw, needsUpload: false };
      }
      const pngBuffer = await toPngBuffer(raw);
      const bytes = new Uint8Array(pngBuffer);
      // JPEG is directly embeddable by pdf-lib → keep the fal URL; anything else (webp,
      // gif, unknown) must be uploaded as the converted PNG.
      const needsUpload = fmt !== "jpeg";
      console.log(`[fal] image format=${fmt} → converted to PNG (needsUpload=${needsUpload})`);
      return { url, provider: "fal.ai", bytes, needsUpload, pngBuffer };
    } catch {
      // Couldn't fetch/convert bytes for analysis; ship the URL as-is.
    }
  }

  return { url, provider: "fal.ai" };
}
