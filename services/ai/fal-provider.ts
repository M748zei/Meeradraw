import type { ImageAIProvider, ImageGenerationInput, ImageQcStats } from "@/services/ai/types";
import {
  BOOK_SERIES_STYLE_LOCK,
  buildCharacterSheetPrompt,
  buildColoringPagePrompt,
  buildCoverPrompt,
  buildNegativePrompt,
  buildReferenceGuidedScenePrompt,
  CHARACTER_SHEET_NEGATIVE_PROMPT,
  heroGenderPromptBits,
} from "@/services/ai/prompts";
import { styleImageCraftLine } from "@/services/ai/style-contracts";
import { withRetry } from "@/lib/async";
import { isBlankOrTooFaint, hasPoorEnvironment, isColored } from "@/lib/image-quality";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";
import { checkCast, checkCoverTitle, checkPageAction } from "@/lib/vision-qc";
import { StorageService } from "@/services/storage-service";
import { randomUUID } from "crypto";

/** Default Ideogram preset for pages/covers — locks coloring-book aesthetic book-wide. */
const DEFAULT_PAGE_STYLE_PRESET =
  process.env.FAL_IDEOGRAM_STYLE_PRESET?.trim() || "COLORING_BOOK_I";

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
const FAL_QUALITY_REROLLS = Number(process.env.FAL_QUALITY_REROLLS ?? 2);
/**
 * Extra re-rolls triggered by the VISION QC (lineup detected, action missing,
 * wrong cast, illegible cover title). Separate cap from the pixel re-rolls:
 * vision only runs on pixel-clean images, and after the cap the image is
 * ACCEPTED (fail-open — a static page beats a failed page). Each re-roll is an
 * internal fal cost, never billed to the customer.
 */
const VISION_QC_REROLLS = Number(process.env.VISION_QC_REROLLS ?? 2);
const ANTI_LINEUP_BOOST =
  "CRITICAL: the characters must be IN MOTION doing the described action with distinct dynamic poses and a non-frontal camera angle — ABSOLUTELY NOT standing in a row, NOT front-facing side by side, NOT a static group photo, NOT a model sheet.";
const CAST_FIX_BOOST =
  "CRITICAL: draw EXACTLY the listed characters — correct number of figures, correct species for each (an animal character is a REAL animal of its species, never a human) — no extra characters, no missing characters.";
const TITLE_FIX_BOOST =
  "CRITICAL: the title text must be rendered LARGE, PERFECTLY LEGIBLE and CORRECTLY SPELLED in bold playful hand-lettering in the top band.";
const ENV_BOOST =
  "CRITICAL ENVIRONMENT: fill AT LEAST 70% of the page with colorable scenery that matches THIS scene — ground, sky, trees, buildings, furniture, props reaching the edges. The child is SMALLER in the frame. Absolutely NO empty white void, NO floating character on blank paper, NO portrait-only composition. Do NOT invent a market unless the scene is a market.";
const EYES_BOOST =
  "CRITICAL FACE: draw BOTH eyes with a dark pupil circle AND iris inside each eye outline — never blank white eyes, never empty ovals. Natural round child head, not elongated or deformed.";
const LINEART_BOOST =
  "STRICT BLACK AND WHITE LINE ART ONLY: pure black outlines on white paper, absolutely NO color, no colored fills, no shading, no grey — a printable coloring page, NOT a colored illustration. No artist signature, no watermark, no text in the corners.";
const STYLE_PRESERVE_BOOST =
  "CRITICAL STYLE PRESERVE: keep the EXACT same outline weight, cartoon hand, and coloring-book aesthetic as the rest of this book — do not switch artists or line styles.";
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

    // Cover WITH lettered title always goes text-only Ideogram: Kontext cannot
    // render reliable lettering, and Ideogram's is the whole point (audit T6).
    // Character sheets normally text-only, except photo-identity sheets.
    const useReference =
      Boolean(refEndpoint) &&
      Boolean(input.referenceImageUrl) &&
      !input.forceTextOnly &&
      !(input.isCover && input.coverTitle) &&
      (!input.isCharacterSheet || Boolean(input.identityFromPhoto));

    const prompt = buildPrompt(input, useReference);
    const endpoint = useReference ? refEndpoint : textEndpoint;
    const visionCap =
      typeof input.maxVisionRerolls === "number" && input.maxVisionRerolls >= 0
        ? input.maxVisionRerolls
        : VISION_QC_REROLLS;
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
      worldNegative: input.worldNegative,
      referenceImageUrl: useReference ? input.referenceImageUrl : undefined,
      seed: input.seed,
      stylePreset: input.stylePreset,
      heroGender: input.heroGender,
      consistencyMode: input.consistencyMode,
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
        input,
        maxVisionRerolls: visionCap,
        consistencyMode: Boolean(input.consistencyMode),
        baseSeed: typeof input.seed === "number" ? input.seed : undefined,
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
          worldNegative: input.worldNegative,
          seed: input.seed,
          stylePreset: input.stylePreset || DEFAULT_PAGE_STYLE_PRESET,
          heroGender: input.heroGender,
          consistencyMode: true,
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
          input,
          maxVisionRerolls: visionCap,
          consistencyMode: true,
          baseSeed: typeof input.seed === "number" ? input.seed : undefined,
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
    /** Original input — drives the vision QC (action / expected cast / cover title). */
    input?: ImageGenerationInput;
    maxVisionRerolls?: number;
    /** Parent books: keep seed family + style lock on rerolls. */
    consistencyMode?: boolean;
    baseSeed?: number;
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
      input,
      maxVisionRerolls = VISION_QC_REROLLS,
      consistencyMode = false,
      baseSeed,
    } = params;

    const wantsQualityCheck =
      validateNonBlank || validateEnvironment || validateLineArt || Boolean(requireColored);
    // Vision re-rolls extend the loop but keep their own (smaller) cap.
    const maxRerolls = wantsQualityCheck
      ? FAL_QUALITY_REROLLS + maxVisionRerolls
      : 0;
    let visionRerollsUsed = 0;
    let pixelRerollsUsed = 0;
    const qcStats: ImageQcStats = input?.qcStats ?? {};
    if (input) input.qcStats = qcStats;

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
    let prevVisionNudges: string[] = [];

    for (let attempt = 0; attempt <= maxRerolls; attempt++) {
      // Consistency mode: keep seed in the same family (seed+attempt) so rerolls
      // fix defects without jumping to a different artist aesthetic.
      if (typeof baseSeed === "number" && Number.isFinite(baseSeed)) {
        body.seed = (baseSeed + attempt) % 2147483647;
      } else if (attempt > 0 && !consistencyMode) {
        delete body.seed; // legacy: fresh random seed on reroll
      }

      if (attempt > 0) {
        const nudges: string[] = [...prevVisionNudges];
        if (prevColored) nudges.push(LINEART_BOOST);
        if (prevNotColored) nudges.push(COLOR_SHEET_BOOST);
        if (
          prevBlankOrEnv ||
          (!prevColored && !requireColored && !prevVisionNudges.length)
        ) {
          nudges.push(ENV_BOOST);
          nudges.push(EYES_BOOST);
        }
        if (consistencyMode) nudges.push(STYLE_PRESERVE_BOOST);
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
      // Blank / empty-void pages are severe; poor environment is almost as bad for
      // a coloring book (nothing to color). Weight it high so we re-roll hard.
      const score =
        (blank ? 3 : 0) +
        (colored ? 2 : 0) +
        (notColored ? 2 : 0) +
        (poorEnv ? 3 : 0);
      prevBlankOrEnv = blank || poorEnv;
      prevColored = colored;
      prevNotColored = notColored;

      // VISION QC (audit T4/T5/T6): only on pixel-clean images (score 0), with its
      // own re-roll cap. Fail-open: null verdict = cannot judge = accept.
      let visionScore = 0;
      prevVisionNudges = [];
      if (score === 0 && input && visionRerollsUsed < maxVisionRerolls + 1) {
        const verdicts: string[] = [];
        if (input.isCharacterSheet && input.expectedCast?.length) {
          const cast = await checkCast(current.url, input.expectedCast);
          if (cast && !cast.matches) {
            visionScore += 3;
            prevVisionNudges.push(CAST_FIX_BOOST);
            verdicts.push(`cast:${cast.issue || `saw ${cast.count}`}`);
          }
        } else if (input.isCover) {
          if (input.coverTitle) {
            const title = await checkCoverTitle(current.url, input.coverTitle);
            if (title && !title.titleLegible) {
              visionScore += 2;
              prevVisionNudges.push(TITLE_FIX_BOOST);
              verdicts.push(`title:${title.issue || "illegible"}`);
            }
          }
          if (input.expectedCast?.length) {
            const cast = await checkCast(current.url, input.expectedCast);
            if (cast && !cast.matches) {
              visionScore += 3;
              prevVisionNudges.push(CAST_FIX_BOOST);
              verdicts.push(`cast:${cast.issue || `saw ${cast.count}`}`);
            }
          }
          // A cover is a POSTER: a static lineup on an empty background is the
          // audit's #1 sin there too (verified: Kontext covers regress to the
          // reference lineup when this check is missing).
          if (input.action) {
            const poster = await checkPageAction(current.url, input.action);
            if (poster && (poster.lineup || !poster.actionVisible)) {
              visionScore += poster.lineup ? 2 : 1;
              prevVisionNudges.push(ANTI_LINEUP_BOOST);
              verdicts.push(
                `cover-${poster.lineup ? "lineup" : "action-missing"}:${poster.issue || ""}`
              );
            }
          }
        } else if (input.isColoringPage && input.action) {
          const page = await checkPageAction(current.url, input.action);
          if (page && (page.lineup || !page.actionVisible)) {
            // Lineup when vision responds = mandatory defect (score 3), never silent accept.
            visionScore += page.lineup ? 3 : 1;
            prevVisionNudges.push(ANTI_LINEUP_BOOST);
            verdicts.push(
              `${page.lineup ? "lineup" : "action-missing"}:${page.issue || input.action.slice(0, 60)}`
            );
            if (page.lineup) {
              qcStats.lineupDetected = true;
            }
          }
        }
        if (verdicts.length) {
          qcStats.visionVerdicts = [...(qcStats.visionVerdicts || []), ...verdicts];
        }
      }

      const totalScore = score + visionScore;
      if (!best || totalScore < best.score) {
        best = {
          url: current.url,
          provider: current.provider,
          score: totalScore,
          blank,
          needsUpload: Boolean(current.needsUpload),
          pngBuffer: current.pngBuffer,
        };
      }

      if (totalScore === 0) break; // clean page → accept immediately

      // Budget the next re-roll against the right cap.
      if (score > 0) {
        if (pixelRerollsUsed >= FAL_QUALITY_REROLLS) break;
        pixelRerollsUsed++;
        qcStats.pixelRerolls = pixelRerollsUsed;
      } else {
        if (visionRerollsUsed >= maxVisionRerolls) break;
        visionRerollsUsed++;
        qcStats.visionRerolls = visionRerollsUsed;
      }
      if (attempt < maxRerolls) {
        console.warn(
          `[${label}] quality re-roll (blank=${blank}, colored=${colored}, notColored=${notColored}, poorEnv=${poorEnv}, vision=${prevVisionNudges.length > 0}); pixel ${pixelRerollsUsed}/${FAL_QUALITY_REROLLS}, vision ${visionRerollsUsed}/${maxVisionRerolls}`
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
    // Lineup still present after vision re-rolls on a reference path → force
    // text-only Ideogram fallback (composition bleed from the model sheet).
    const isRefPath = label === "fal-ref" || /kontext/i.test(endpoint);
    if (
      isRefPath &&
      input?.isColoringPage &&
      qcStats.lineupDetected &&
      best.score > 0 &&
      (qcStats.visionVerdicts || []).some((v) => v.startsWith("lineup"))
    ) {
      throw new Error("lineup after vision re-rolls");
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
  worldNegative?: string;
  referenceImageUrl?: string;
  seed?: number;
  stylePreset?: string;
  heroGender?: string;
  consistencyMode?: boolean;
}): Record<string, unknown> {
  const {
    prompt,
    endpoint,
    isCharacterSheet,
    negativePrompt,
    worldNegative,
    referenceImageUrl,
    seed,
    stylePreset,
    heroGender,
    consistencyMode,
  } = params;
  const isKontext = /kontext/i.test(endpoint);
  const isIdeogram = /ideogram/i.test(endpoint);
  const useReference = Boolean(referenceImageUrl);
  const pageNegative = isCharacterSheet
    ? CHARACTER_SHEET_NEGATIVE_PROMPT
    : buildNegativePrompt(negativePrompt, worldNegative, heroGender);

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
      negative_prompt: pageNegative,
    };
    // Pages/covers: lock COLORING_BOOK preset so every page shares one aesthetic.
    // Character sheets stay colored DESIGN (no coloring preset).
    if (!isCharacterSheet) {
      ideoBody.style_preset = stylePreset || DEFAULT_PAGE_STYLE_PRESET;
    }
    if (typeof seed === "number" && Number.isFinite(seed)) {
      ideoBody.seed = seed % 2147483647;
    }
    // Keep unused vars referenced for API clarity / future style_codes path.
    void consistencyMode;
    return ideoBody;
  }

  const body: Record<string, unknown> = {
    prompt,
    num_images: 1,
    output_format: "png",
  };

  if (isKontext) {
    // Kontext derives size from the reference image. Lower guidance (~3) softens
    // composition lock to the reference lineup; identity still comes from image_url.
    // Do NOT send `strength` — Kontext schema rejects it.
    body.image_url = referenceImageUrl;
    body.guidance_scale = Number(process.env.FAL_REF_GUIDANCE || 3.0);
    if (typeof seed === "number" && Number.isFinite(seed)) {
      body.seed = seed % 2147483647;
    }
    return body;
  }

  body.image_size = "square_hd";
  body.enable_safety_checker = true;

  // Send real negative_prompt only for models that accept it (Flux ignores/rejects it).
  if (endpointSupportsNegative(endpoint)) {
    body.negative_prompt = pageNegative;
  }

  // flux/dev benefits from more steps; schnell ignores or caps low
  if (!endpoint.includes("schnell")) {
    body.num_inference_steps = Number(process.env.FAL_INFERENCE_STEPS || 28);
    body.guidance_scale = DEFAULT_GUIDANCE_SCALE;
  }

  if (typeof seed === "number" && Number.isFinite(seed)) {
    body.seed = seed % 2147483647;
  }

  // Legacy img2img endpoints (non-Kontext) still use `strength`.
  if (useReference) {
    body.image_url = referenceImageUrl;
    body.strength = Number(process.env.FAL_REF_STRENGTH || 0.3);
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
  const craft = styleImageCraftLine(input.style || "cute").slice(0, 220);
  const gender = heroGenderPromptBits(input.heroGender).positive;
  return [
    input.consistencyMode ? BOOK_SERIES_STYLE_LOCK : "",
    craft,
    "Simple black and white line-art coloring page for young children.",
    gender,
    scene ? `Scene: ${scene}.` : "",
    "Bold thick black outlines, big clear shapes, plenty of detail filling the whole page, plain white inside shapes.",
    "No color, no shading, no grey, no text, no watermark. Same outline weight as the rest of the book.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildPrompt(input: ImageGenerationInput, useReference: boolean): string {
  if (input.isCharacterSheet) {
    return buildCharacterSheetPrompt({
      characters: input.characterBible || "",
      style: input.style,
      castCount: input.expectedCast?.length,
      identityFromPhoto: Boolean(input.identityFromPhoto),
    });
  }
  if (input.isCover) {
    if (useReference) {
      return buildReferenceGuidedScenePrompt({
        scene: `Coloring book COVER poster: ${input.refScene || input.action || input.prompt}. Keep the top third visually calm (simple sky) as a title band. ABSOLUTELY NO TEXT anywhere in the image.`,
        characters: input.characterBible || "",
        style: input.style,
        world: input.worldSetting || "",
        action: input.action,
        settingElements: input.settingElements,
      });
    }
    return buildCoverPrompt({
      title: input.coverTitle || input.prompt,
      characters: input.characterBible || "",
      style: input.style,
      summary: input.prompt,
      action: input.action,
      settingElements: input.settingElements,
      renderTitle: Boolean(input.coverTitle),
    });
  }
  if (useReference) {
    return buildReferenceGuidedScenePrompt({
      // Compact scene for Kontext — the full assembled prompt makes it copy the
      // reference lineup (see ImageGenerationInput.refScene).
      scene: input.refScene || input.prompt,
      characters: input.characterBible || "",
      style: input.style,
      world: input.worldSetting || "",
      action: input.action,
      settingElements: input.settingElements,
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
    settingElements: input.settingElements,
    heroGender: input.heroGender,
    consistencyMode: input.consistencyMode,
  });
}

export { bookStyleSeed, pageStyleSeed } from "@/lib/book-style-seed";

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
