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
import { buildCompositionBlueprint } from "@/services/ai/composition-templates";
import {
  createAttemptTracker,
  recordAttempt,
  strictGateOutcome,
} from "@/lib/qc-attempts";
import { seedForReroll } from "@/lib/generation-seed";
import {
  COLOR_SHEET_BOOST,
  LINEART_BOOST,
  ENV_BOOST,
  EYES_BOOST,
  STYLE_PRESERVE_BOOST,
  routeBoostsForVerdicts,
  type BoostRoutingContext,
} from "@/services/ai/qc-boosts";
import { withRetry } from "@/lib/async";
import { isBlankOrTooFaint, hasPoorEnvironment, isColored } from "@/lib/image-quality";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";
import {
  checkCast,
  applyCoverPosterVerdicts,
  checkCoverAction,
  checkCoverTitle,
  checkIdentityReferences,
  checkPageAction,
} from "@/lib/vision-qc";
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
 * Interior PAGES and the COVER default to Ideogram V3 (COLORING_BOOK preset + style AUTO +
 * expand_prompt:false + negative_prompt). fal rejects style=DESIGN when style_preset is set.
 * Character sheets stay DESIGN without a coloring preset (colored cast portrait).
 * Override with FAL_PAGE_ENDPOINT (or legacy FAL_IMAGE_ENDPOINT).
 * When FAL_REF_ENDPOINT (Kontext) is set AND a validated hero portrait exists, pages+cover
 * are redrawn reference-guided from the hero for character consistency (phase-2 pipeline);
 * Ideogram remains the hero generator and the text-only fallback.
 */
const DEFAULT_PAGE_ENDPOINT = "https://fal.run/fal-ai/ideogram/v3";
/** Legacy flux/dev endpoint — kept available for override/fallback experiments. */
const DEFAULT_IMAGE_ENDPOINT = "https://fal.run/fal-ai/flux/dev";
const DEFAULT_MULTI_REF_ENDPOINT = "https://fal.run/fal-ai/flux-2-pro/edit";
const DEFAULT_CONTROLLED_PAGE_ENDPOINT = "https://fal.run/fal-ai/flux-general";
const FAL_TIMEOUT_MS = Number(process.env.FAL_TIMEOUT_MS || 90_000);
const FAL_RETRY_ATTEMPTS = Number(process.env.FAL_RETRY_ATTEMPTS || 2);
/** Default guidance raised for stronger prompt adherence (environment + line weight). */
const DEFAULT_GUIDANCE_SCALE = Number(process.env.FAL_GUIDANCE_SCALE || 4.5);
/**
 * Extra quality re-rolls (fresh seed + stronger env instruction) when a page comes back
 * blank/near-blank OR as a subject floating on an empty background. Capped: after the
 * cap we KEEP THE BEST attempt (never fail the page — an empty page beats a failed one).
 */
/** Default quality re-rolls — keep lean; studio/parent override via input caps. */
const FAL_QUALITY_REROLLS = Number(process.env.FAL_QUALITY_REROLLS ?? 1);
/**
 * Extra re-rolls triggered by the VISION QC (lineup detected, action missing,
 * wrong cast, illegible cover title). Separate cap from the pixel re-rolls:
 * vision only runs on pixel-clean images, and after the cap the image is
 * ACCEPTED (fail-open — a static page beats a failed page). Each re-roll is an
 * internal fal cost — real $ on the fal key, not Meeradraw credits.
 * Default 1 to avoid retry storms; override with VISION_QC_REROLLS.
 */
const VISION_QC_REROLLS = Number(process.env.VISION_QC_REROLLS ?? 1);
const PRINT_PAGE_WIDTH_PX = Number(process.env.PRINT_PAGE_WIDTH_PX || 2400);
const PRINT_PAGE_HEIGHT_PX = Number(process.env.PRINT_PAGE_HEIGHT_PX || 3200);

/** Permanent fal failures — never retry (wastes wall-clock; some may still bill). */
export class NonRetryableFalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableFalError";
  }
}

export function isNonRetryableFalError(err: unknown): boolean {
  if (err instanceof NonRetryableFalError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /feature_not_supported|cannot be 'DESIGN'|style_preset|Exhausted balance|User is locked|invalid_request|422/i.test(
      msg
    ) ||
    /strict visual quality gate|Premium character reference failed|Premium cover|Premium book is missing/i.test(
      msg
    ) ||
    /fal\.ai error:.*"type"\s*:\s*"feature_not_supported"/i.test(msg)
  );
}
// Boost texts + verdict-driven routing live in services/ai/qc-boosts.ts so the
// reliability suite can test the routing decisions against the real strings.

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
    const controlledColoring =
      process.env.FAL_CONTROLLED_COLORING_ENABLED === "true" &&
      Boolean(process.env.FAL_COLORING_LORA_URL?.trim());
    const controlledEndpoint =
      process.env.FAL_CONTROLLED_PAGE_ENDPOINT?.trim() ||
      DEFAULT_CONTROLLED_PAGE_ENDPOINT;
    const multiRefEndpoint =
      process.env.FAL_MULTI_REF_ENDPOINT?.trim() || DEFAULT_MULTI_REF_ENDPOINT;
    const orderedReferenceUrls = Array.from(
      new Set(
        (input.referenceImageUrls?.length
          ? input.referenceImageUrls
          : input.referenceImageUrl
            ? [input.referenceImageUrl]
            : []
        ).filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
      )
    ).slice(0, 9);
    const strictInterior =
      Boolean(input.strictQuality) && !input.isCharacterSheet && !input.isCover;
    if (strictInterior && !orderedReferenceUrls.length) {
      throw new NonRetryableFalError(
        "Strict coloring page requires ordered character references"
      );
    }
    if (
      strictInterior &&
      orderedReferenceUrls.length === 1 &&
      !refEndpoint &&
      !controlledColoring
    ) {
      throw new NonRetryableFalError(
        "Missing FAL_REF_ENDPOINT for strict single-reference generation"
      );
    }
    if (strictInterior && orderedReferenceUrls.length > 1 && !multiRefEndpoint) {
      throw new NonRetryableFalError(
        "Missing FAL_MULTI_REF_ENDPOINT for strict multi-reference generation"
      );
    }

    const referenceAllowed =
      !input.forceTextOnly &&
      !(input.isCover && input.coverTitle) &&
      (!input.isCharacterSheet || Boolean(input.identityFromPhoto));
    const useMultiReference =
      referenceAllowed && orderedReferenceUrls.length > 1 && Boolean(multiRefEndpoint);
    const useReference =
      referenceAllowed &&
      orderedReferenceUrls.length > 0 &&
      (useMultiReference || Boolean(refEndpoint) || controlledColoring);

    const prompt = buildPrompt(input, useReference);
    const endpoint = useMultiReference
      ? multiRefEndpoint
      : useReference
        ? controlledColoring && orderedReferenceUrls.length === 1
          ? controlledEndpoint
          : refEndpoint
        : textEndpoint;
    const visionCap =
      typeof input.maxVisionRerolls === "number" && input.maxVisionRerolls >= 0
        ? input.maxVisionRerolls
        : VISION_QC_REROLLS;
    const qualityCap =
      typeof input.maxQualityRerolls === "number" && input.maxQualityRerolls >= 0
        ? input.maxQualityRerolls
        : FAL_QUALITY_REROLLS;
    const providerAttempts =
      typeof input.maxProviderAttempts === "number" &&
      input.maxProviderAttempts >= 1
        ? Math.floor(input.maxProviderAttempts)
        : FAL_RETRY_ATTEMPTS;
    // Short, high-adherence fallback used ONLY to rescue a persistently blank story page.
    const recoveryPrompt =
      !input.skipRecovery && !input.isCharacterSheet && !input.isCover
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
      referenceImageUrl:
        useReference && !useMultiReference ? orderedReferenceUrls[0] : undefined,
      referenceImageUrls: useMultiReference ? orderedReferenceUrls : undefined,
      seed: input.seed,
      stylePreset: input.stylePreset,
      heroGender: input.heroGender,
      consistencyMode: input.consistencyMode,
      coloringLoraUrl:
        !input.isCharacterSheet ? process.env.FAL_COLORING_LORA_URL?.trim() : undefined,
      coloringLoraScale: Number(process.env.FAL_COLORING_LORA_SCALE || 0.8),
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
        label: useMultiReference ? "fal-multi-ref" : useReference ? "fal-ref" : "fal",
        input,
        maxVisionRerolls: visionCap,
        maxQualityRerolls: qualityCap,
        maxProviderAttempts: providerAttempts,
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
      if (useReference && !input.strictQuality) {
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
          maxQualityRerolls: qualityCap,
          maxProviderAttempts: providerAttempts,
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
    maxQualityRerolls?: number;
    maxProviderAttempts?: number;
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
      maxQualityRerolls = FAL_QUALITY_REROLLS,
      maxProviderAttempts = FAL_RETRY_ATTEMPTS,
      consistencyMode = false,
      baseSeed,
    } = params;

    const wantsQualityCheck =
      validateNonBlank || validateEnvironment || validateLineArt || Boolean(requireColored);
    // Vision re-rolls extend the loop but keep their own (smaller) cap.
    const maxRerolls = wantsQualityCheck
      ? maxQualityRerolls + maxVisionRerolls
      : 0;
    let visionRerollsUsed = 0;
    let pixelRerollsUsed = 0;
    const qcStats: ImageQcStats = input?.qcStats ?? {};
    if (input) input.qcStats = qcStats;

    // Best-attempt decision state (lib/qc-attempts): attemptHistory is pure
    // telemetry; every accept / soft-accept / reject decision below reads the
    // BEST attempt exclusively — earlier attempts can never contaminate it.
    const tracker = createAttemptTracker();
    /** Provider payload (url/buffer) of the attempt that owns tracker.best. */
    let bestPayload:
      | {
          url: string;
          provider: string;
          needsUpload: boolean;
          pngBuffer?: Buffer;
        }
      | null = null;
    let lastError: unknown = null;
    // Previous attempt's defects → targeted nudges for the next re-roll.
    let prevBlankOrEnv = false;
    let prevColored = false;
    let prevNotColored = false;
    let prevVerdicts: string[] = [];
    const boostCtx: BoostRoutingContext = {
      action: input?.action,
      storySummary: input?.prompt,
      cast: input?.expectedCast,
      multiReference: (input?.referenceImageUrls?.length || 0) > 1,
    };

    for (let attempt = 0; attempt <= maxRerolls; attempt++) {
      // Deterministic re-roll family: seedForReroll keeps the same run stable
      // (idempotent resume) while making each re-roll a genuinely distinct seed.
      if (typeof baseSeed === "number" && Number.isFinite(baseSeed)) {
        body.seed = seedForReroll(baseSeed, attempt);
      } else if (attempt > 0 && !consistencyMode) {
        delete body.seed; // legacy: fresh random seed on reroll
      }

      if (attempt > 0) {
        // Verdict-driven targeted boosts (story/action, identity-reference,
        // anti-lineup, cast, anatomy…) from the PREVIOUS attempt's verdicts.
        const nudges: string[] = routeBoostsForVerdicts(prevVerdicts, boostCtx);
        if (prevColored) nudges.push(LINEART_BOOST);
        if (prevNotColored) nudges.push(COLOR_SHEET_BOOST);
        if (
          prevBlankOrEnv ||
          (!prevColored && !requireColored && !prevVerdicts.length)
        ) {
          nudges.push(ENV_BOOST);
          nudges.push(EYES_BOOST);
        }
        if (consistencyMode) nudges.push(STYLE_PRESERVE_BOOST);
        body.prompt = `${basePrompt} ${[...new Set(nudges)].join(" ")}`;
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
          attempts: maxProviderAttempts,
          delayMs: 1200,
          label,
          shouldRetry: (err) => !isNonRetryableFalError(err),
        });
      } catch (err) {
        // Real provider/network failure for this attempt. If we already have any image,
        // stop and keep it; otherwise try another re-roll before giving up.
        lastError = err;
        if (isNonRetryableFalError(err)) break;
        if (tracker.best) break;
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
      const analysisUnavailable = wantsQualityCheck && !current.bytes;
      const score =
        (analysisUnavailable ? 5 : 0) +
        (blank ? 3 : 0) +
        (colored ? 2 : 0) +
        (notColored ? 2 : 0) +
        (poorEnv ? 3 : 0);
      prevBlankOrEnv = blank || poorEnv;
      prevColored = colored;
      prevNotColored = notColored;

      // VISION QC (audit T4/T5/T6): only on pixel-clean images (score 0), with its
      // own re-roll cap. Fail-open: null verdict = cannot judge = accept.
      // Verdict tags are the single signal — targeted boosts for the NEXT
      // attempt are routed from these tags (routeBoostsForVerdicts).
      let visionScore = 0;
      let attemptVerdicts: string[] = [];
      if (score === 0 && input && visionRerollsUsed < maxVisionRerolls + 1) {
        const verdicts: string[] = [];
        if (input.isCharacterSheet && input.expectedCast?.length) {
          const cast = await checkCast(current.url, input.expectedCast);
          if (!cast && input.strictQuality && process.env.STRICT_VISION_REQUIRED === "true") {
            visionScore += 4;
            verdicts.push("cast:vision-unavailable");
          } else if (cast && !cast.matches) {
            visionScore += 4;
            verdicts.push(`cast:${cast.issue || `saw ${cast.count}`}`);
          }
        } else if (input.isCover) {
          if (input.coverTitle) {
            const title = await checkCoverTitle(current.url, input.coverTitle);
            if (!title && input.strictQuality && process.env.STRICT_VISION_REQUIRED === "true") {
              visionScore += 4;
              verdicts.push("title:vision-unavailable");
            } else if (title && !title.titleLegible) {
              visionScore += 2;
              verdicts.push(`title:${title.issue || "illegible"}`);
            }
          }
          if (input.expectedCast?.length) {
            const cast = await checkCast(current.url, input.expectedCast);
            if (!cast && input.strictQuality && process.env.STRICT_VISION_REQUIRED === "true") {
              visionScore += 4;
              verdicts.push("cast:vision-unavailable");
            } else if (cast && !cast.matches) {
              visionScore += 4;
              verdicts.push(`cast:${cast.issue || `saw ${cast.count}`}`);
            }
          }
          // Cover poster check (NOT the interior-page 6-zone environment gate).
          // Hard defects (anatomy/craft/comic/blur/safety/…) feed canSoftAcceptCover's
          // blocklist; soft lineup/action alone may soft-accept after re-rolls.
          if (input.action) {
            const poster = await checkCoverAction(current.url, input.action);
            if (!poster && input.strictQuality && process.env.STRICT_VISION_REQUIRED === "true") {
              visionScore += 4;
              verdicts.push("cover-quality:vision-unavailable");
            } else if (poster) {
              const applied = applyCoverPosterVerdicts(poster);
              if (applied.verdicts.length) {
                visionScore += applied.visionScore;
                verdicts.push(...applied.verdicts);
              }
            }
          }
        } else if (input.isColoringPage) {
          if (input.expectedCast?.length) {
            const cast = await checkCast(current.url, input.expectedCast);
            if (!cast && input.strictQuality && process.env.STRICT_VISION_REQUIRED === "true") {
              visionScore += 4;
              verdicts.push("cast:vision-unavailable");
            } else if (cast && !cast.matches) {
              visionScore += 4;
              verdicts.push(`cast:${cast.issue || `saw ${cast.count}`}`);
            }
          }
          const page = await checkPageAction(current.url, input.action || "");
          if (!page && input.strictQuality && process.env.STRICT_VISION_REQUIRED === "true") {
            visionScore += 4;
            verdicts.push("page-quality:vision-unavailable");
          } else if (page) {
            if (!page.singleFullPage) {
              visionScore += 5;
              verdicts.push(`comic-layout:${page.issue || "panels, bubbles or split frames detected"}`);
            }
            if (page.lineup || !page.actionVisible) {
              visionScore += page.lineup ? 3 : 1;
              verdicts.push(
                `${page.lineup ? "lineup" : "action-missing"}:${page.issue || input.action?.slice(0, 60) || ""}`
              );
              if (page.lineup) qcStats.lineupDetected = true;
            }
            if (!page.environmentRich) {
              visionScore += 4;
              verdicts.push(`environment:${page.issue || "not enough colorable scenery"}`);
            }
            if (!page.anatomyValid) {
              visionScore += 4;
              verdicts.push(`anatomy:${page.issue || "malformed anatomy"}`);
            }
            if (!page.professionalLineArt) {
              visionScore += 3;
              verdicts.push(`craft:${page.issue || "generic or careless line art"}`);
            }
          }
        }
        const identityUrls = input.referenceImageUrls || [];
        if (
          !input.isCharacterSheet &&
          identityUrls.length > 0 &&
          input.expectedCast?.length === identityUrls.length
        ) {
          const identity = await checkIdentityReferences(
            current.url,
            input.expectedCast.map((character, index) => ({
              ...character,
              referenceImageUrl: identityUrls[index],
            }))
          );
          if (!identity && input.strictQuality && process.env.STRICT_VISION_REQUIRED === "true") {
            visionScore += 5;
            verdicts.push("identity:vision-unavailable");
          } else if (identity && !identity.matches) {
            visionScore += 5;
            qcStats.identityMismatchDetected = true;
            const scores = identity.scores
              .map((item) => `${item.name}=${item.score}`)
              .join(",");
            verdicts.push(
              `identity:${scores || identity.issue || "reference mismatch"}`
            );
          }
        }
        if (verdicts.length) {
          attemptVerdicts = verdicts;
          qcStats.visionVerdicts = [...(qcStats.visionVerdicts || []), ...verdicts];
        }
      }

      // Pixel-only defects (blank/colored/env) with no vision tags still need a signal
      // for soft-accept decisions (covers with pure chroma use repairableColorOnly).
      if (blank) attemptVerdicts = [...attemptVerdicts, "corrupt:blank-or-unreadable"];
      if (analysisUnavailable) {
        attemptVerdicts = [...attemptVerdicts, "corrupt:bytes-unavailable"];
      }

      const totalScore = score + visionScore;
      const record = recordAttempt(tracker, {
        score: totalScore,
        verdicts: attemptVerdicts,
        blank,
        colored,
      });
      if (tracker.best === record) {
        bestPayload = {
          url: current.url,
          provider: current.provider,
          needsUpload: Boolean(current.needsUpload),
          pngBuffer: current.pngBuffer,
        };
      }
      prevVerdicts = record.verdicts;

      if (totalScore === 0) break; // clean page → accept immediately

      // Budget the next re-roll against the right cap.
      if (score > 0) {
        if (pixelRerollsUsed >= maxQualityRerolls) break;
        pixelRerollsUsed++;
        qcStats.pixelRerolls = pixelRerollsUsed;
      } else {
        if (visionRerollsUsed >= maxVisionRerolls) break;
        visionRerollsUsed++;
        qcStats.visionRerolls = visionRerollsUsed;
      }
      if (attempt < maxRerolls) {
        console.warn(
          `[${label}] quality re-roll (attempt=${record.attemptId}, blank=${blank}, colored=${colored}, notColored=${notColored}, poorEnv=${poorEnv}, vision=${attemptVerdicts.length > 0}); pixel ${pixelRerollsUsed}/${maxQualityRerolls}, vision ${visionRerollsUsed}/${maxVisionRerolls}`
        );
      }
    }

    // Last-resort rescue: if the best attempt is STILL blank, flux likely choked on the
    // long descriptive prompt. Retry with a short, high-adherence prompt a couple times —
    // short prompts render far more reliably. Keep the first non-blank result.
    if (tracker.best?.blank && recoveryPrompt && !input?.strictQuality) {
      for (let r = 0; r < 2 && tracker.best.blank; r++) {
        body.prompt = recoveryPrompt;
        try {
          const rescue = await callFal(endpoint, key, body, true);
          const stillBlank = rescue.bytes ? isBlankOrTooFaint(rescue.bytes) : false;
          if (!stillBlank) {
            console.warn(`[${label}] blank page rescued via short prompt (try ${r + 1})`);
            const rescueRecord = recordAttempt(tracker, {
              score: 0,
              verdicts: [],
              blank: false,
              colored: false,
            });
            if (tracker.best === rescueRecord) {
              bestPayload = {
                url: rescue.url,
                provider: rescue.provider,
                needsUpload: Boolean(rescue.needsUpload),
                pngBuffer: rescue.pngBuffer,
              };
            }
            break;
          }
        } catch (err) {
          lastError = err;
        }
      }
    }

    // Strict delivery never lets a short-prompt rescue or uninspected provider
    // response bypass the complete pixel + semantic quality gate.
    // Only a total inability to produce ANY image is a real failure.
    const best = tracker.best;
    if (!best || !bestPayload) {
      throw lastError instanceof Error
        ? lastError
        : new Error("fal.ai produced no image");
    }
    // Telemetry: full attempt history + explicit best attempt (observability
    // only — decisions below already came from `best`).
    qcStats.attemptHistory = tracker.attemptHistory.map((a) => ({
      attemptId: a.attemptId,
      score: a.score,
      verdicts: a.verdicts.slice(0, 8),
    }));
    qcStats.bestAttemptId = best.attemptId;
    qcStats.bestScore = best.score;
    qcStats.bestVerdicts = best.verdicts;
    // Lineup still present on the BEST attempt of a reference path → force
    // text-only Ideogram fallback (composition bleed from the model sheet).
    const isRefPath = label === "fal-ref" || /kontext/i.test(endpoint);
    if (
      isRefPath &&
      input?.isColoringPage &&
      best.score > 0 &&
      best.verdicts.some((v) => v.startsWith("lineup"))
    ) {
      throw new Error("lineup after vision re-rolls");
    }
    // Final gate over the SELECTED best attempt only (lib/qc-attempts):
    // clean / repairable-color / closed-allowlist soft-cover accept; otherwise
    // strict → terminal error describing ONLY the best attempt.
    const outcome = strictGateOutcome({
      strictQuality: Boolean(input?.strictQuality),
      isCover: Boolean(input?.isCover),
      best,
    });
    if (!outcome.accept) {
      throw new NonRetryableFalError(outcome.errorMessage);
    }
    if (outcome.mode === "soft-cover") {
      console.warn(
        `[${label}] accepting cover after soft QC (allowlist lineup/action only; attempt ${best.attemptId}, score ${best.score})`
      );
    }
    if (best.score > 0) {
      console.warn(
        `[${label}] keeping best available image after re-rolls (attempt ${best.attemptId}, score ${best.score})`
      );
    }

    // Normalize strict interior pages to a real print canvas (3:4 portrait,
    // 2400×3200 by default). This preserves aspect ratio with white padding,
    // removes residual chroma, and avoids stretching a 1024px square in the PDF.
    if ((input?.isColoringPage || input?.isCover) && bestPayload.pngBuffer) {
      try {
        const sharp = (await import("sharp")).default;
        const printPng = await sharp(bestPayload.pngBuffer)
          .resize({
            width: PRINT_PAGE_WIDTH_PX,
            height: PRINT_PAGE_HEIGHT_PX,
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .grayscale()
          .normalize()
          .sharpen({ sigma: 0.7, m1: 0.7, m2: 1.5 })
          .threshold(Number(process.env.PRINT_LINE_THRESHOLD || 205))
          .png({ compressionLevel: 9 })
          .toBuffer();
        const url = await this.storage.uploadBytes(
          `generated/${randomUUID()}-print.png`,
          printPng,
          "image/png"
        );
        return { url, provider: bestPayload.provider };
      } catch (err) {
        if (input.strictQuality) {
          throw new Error(
            `Print normalization failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        console.warn(`[${label}] print normalization failed`, err);
      }
    }

    // The raw fal URL for webp/other formats is unusable by pdf-lib and is short-lived;
    // persist the converted PNG to Storage and return that stable URL instead.
    if (bestPayload.needsUpload && bestPayload.pngBuffer) {
      try {
        const url = await this.storage.uploadBytes(
          `generated/${randomUUID()}.png`,
          bestPayload.pngBuffer,
          "image/png"
        );
        return { url, provider: bestPayload.provider };
      } catch (err) {
        console.warn(`[${label}] PNG upload failed; returning raw fal URL`, err);
      }
    }
    return { url: bestPayload.url, provider: bestPayload.provider };
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
export function buildFalBody(params: {
  prompt: string;
  endpoint: string;
  isCharacterSheet: boolean;
  negativePrompt?: string;
  worldNegative?: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  seed?: number;
  stylePreset?: string;
  heroGender?: string;
  consistencyMode?: boolean;
  coloringLoraUrl?: string;
  coloringLoraScale?: number;
}): Record<string, unknown> {
  const {
    prompt,
    endpoint,
    isCharacterSheet,
    negativePrompt,
    worldNegative,
    referenceImageUrl,
    referenceImageUrls,
    seed,
    stylePreset,
    heroGender,
    consistencyMode,
    coloringLoraUrl,
    coloringLoraScale,
  } = params;
  const isKontext = /kontext/i.test(endpoint);
  const isMultiReferenceEdit = /flux-2(?:-pro)?\/edit/i.test(endpoint);
  const isIdeogram = /ideogram/i.test(endpoint);
  const isFluxGeneral = /fal-ai\/flux-general(?:\/?$)/i.test(endpoint);
  const useReference =
    Boolean(referenceImageUrl) || Boolean(referenceImageUrls?.length);
  const pageNegative = isCharacterSheet
    ? CHARACTER_SHEET_NEGATIVE_PROMPT
    : buildNegativePrompt(negativePrompt, worldNegative, heroGender);

  if (isMultiReferenceEdit) {
    const refs = Array.from(new Set(referenceImageUrls || [])).slice(0, 9);
    if (refs.length < 2) {
      throw new NonRetryableFalError(
        "Multi-reference endpoint requires at least two ordered images"
      );
    }
    const multiBody: Record<string, unknown> = {
      prompt,
      image_urls: refs,
      image_size: "portrait_4_3",
      output_format: "png",
      enable_safety_checker: true,
    };
    if (typeof seed === "number" && Number.isFinite(seed)) {
      multiBody.seed = seed % 2147483647;
    }
    // FLUX.2 dev exposes tuning fields; Pro intentionally does not.
    if (/fal-ai\/flux-2\/edit/i.test(endpoint)) {
      multiBody.num_images = 1;
      multiBody.guidance_scale = Number(process.env.FAL_MULTI_REF_GUIDANCE || 2.5);
      multiBody.num_inference_steps = Number(
        process.env.FAL_MULTI_REF_STEPS || 28
      );
    }
    return multiBody;
  }

  if (isFluxGeneral) {
    const controlledBody: Record<string, unknown> = {
      prompt,
      image_size: "portrait_4_3",
      num_images: 1,
      num_inference_steps: Number(process.env.FAL_CONTROLLED_STEPS || 30),
      guidance_scale: Number(process.env.FAL_CONTROLLED_GUIDANCE || 3.5),
      output_format: "png",
      enable_safety_checker: true,
      negative_prompt: pageNegative,
      scheduler: "dpmpp_2m",
    };
    if (coloringLoraUrl) {
      controlledBody.loras = [{
        path: coloringLoraUrl,
        scale:
          typeof coloringLoraScale === "number" && Number.isFinite(coloringLoraScale)
            ? coloringLoraScale
            : 0.8,
      }];
    }
    if (referenceImageUrl) {
      controlledBody.reference_image_url = referenceImageUrl;
      controlledBody.reference_strength = Number(
        process.env.FAL_IDENTITY_REFERENCE_STRENGTH || 0.55
      );
      controlledBody.reference_start = 0;
      controlledBody.reference_end = Number(
        process.env.FAL_IDENTITY_REFERENCE_END || 0.8
      );
    }
    if (typeof seed === "number" && Number.isFinite(seed)) {
      controlledBody.seed = seed % 2147483647;
    }
    return controlledBody;
  }

  // Ideogram V3: expand_prompt:false (disables MagicPrompt so OUR exact prompt is used)
  // + a real negative_prompt. NO steps/guidance/output_format in schema.
  // Pages/covers: COLORING_BOOK preset requires style AUTO|GENERAL (DESIGN is rejected).
  // Character sheets stay colored DESIGN without a coloring preset.
  if (isIdeogram) {
    const preset = !isCharacterSheet
      ? stylePreset || DEFAULT_PAGE_STYLE_PRESET
      : undefined;
    const ideoBody: Record<string, unknown> = {
      prompt,
      image_size: "square_hd",
      num_images: 1,
      rendering_speed: "QUALITY",
      style: preset ? "AUTO" : "DESIGN",
      expand_prompt: false,
      negative_prompt: pageNegative,
    };
    if (preset) {
      ideoBody.style_preset = preset;
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
  const composition = input.isColoringPage
    ? buildCompositionBlueprint({
        comicBeat: input.comicBeat,
        shotType: input.shotType,
        action: input.action,
        settingElements: input.settingElements,
      })
    : "";
  const referenceMap = (input.referenceImageUrls || [])
    .map((_, index) => {
      const character = input.expectedCast?.[index];
      return `@image${index + 1} is the immutable identity source for ${character?.name || `character ${index + 1}`} (${character?.kind || "character"}). Preserve that exact identity once.`;
    })
    .join(" ");
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
      return [
        referenceMap,
        buildReferenceGuidedScenePrompt({
          scene: `Coloring book COVER poster: ${input.refScene || input.action || input.prompt}. Keep the top third visually calm (simple sky) as a title band. ABSOLUTELY NO TEXT anywhere in the image.`,
          characters: input.characterBible || "",
          style: input.style,
          world: input.worldSetting || "",
          action: input.action,
          settingElements: input.settingElements,
        }),
      ]
        .filter(Boolean)
        .join(" ");
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
    return [
      referenceMap,
      composition,
      buildReferenceGuidedScenePrompt({
        // Compact scene for reference editing: identity maps stay explicit while
        // the scene remains short enough to avoid copying portrait composition.
        scene: input.refScene || input.prompt,
        characters: input.characterBible || "",
        style: input.style,
        world: input.worldSetting || "",
        action: input.action,
        settingElements: input.settingElements,
      }),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return buildColoringPagePrompt({
    scene: `${composition} ${input.prompt}`.trim(),
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
    const msg = `fal.ai error: ${text}`;
    if (
      res.status === 422 ||
      res.status === 402 ||
      /feature_not_supported|cannot be 'DESIGN'|Exhausted balance|User is locked/i.test(
        text
      )
    ) {
      throw new NonRetryableFalError(msg);
    }
    throw new Error(msg);
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
        return {
          url,
          provider: "fal.ai",
          bytes: raw,
          needsUpload: false,
          pngBuffer: Buffer.from(raw),
        };
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
