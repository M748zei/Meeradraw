/**
 * Targeted QC re-roll boosts + verdict-driven routing.
 *
 * Root cause of prod gens 7af5818f / b13a8320: every failure family received a
 * generic nudge — identity<85 got CAST_FIX_BOOST (which never designates the
 * reference image) and story-mismatch never re-injected the exact planned
 * action. Re-rolls therefore repeated the same mistakes.
 *
 * Routing (per the CURRENT attempt's verdicts only):
 *  - story-mismatch            → COVER_STORY_ACTION boost (story variant)
 *  - cover-action-missing /
 *    action-missing            → COVER_STORY_ACTION boost (action variant)
 *  - identity                  → IDENTITY_REFERENCE boost
 *  - cover-lineup / lineup     → anti-lineup
 *  - cast                      → cast fix
 *  - anatomy                   → anatomy fix
 *  - comic-layout              → single-composition fix
 *  - craft                     → coloring-craft fix
 *  - environment               → environment fix
 *  - title                     → title overlay/lettering fix
 *  - blur / corrupt / orientation → sharp-print fix
 *
 * NEVER: lower the 85 identity threshold, soft-accept identity/story, drop a
 * reference to get a prettier image, or swap the character to game the score.
 */

export const ANTI_LINEUP_BOOST =
  "CRITICAL: the characters must be IN MOTION doing the described action with distinct dynamic poses and a non-frontal camera angle — ABSOLUTELY NOT standing in a row, NOT front-facing side by side, NOT a static group photo, NOT a model sheet.";

export const CAST_FIX_BOOST =
  "CRITICAL: draw EXACTLY the listed characters — correct number of figures, correct species for each (an animal character is a REAL animal of its species, never a human) — no extra characters, no missing characters.";

export const TITLE_FIX_BOOST =
  "CRITICAL: the title text must be rendered LARGE, PERFECTLY LEGIBLE and CORRECTLY SPELLED in bold playful hand-lettering in the top band.";

export const ENV_BOOST =
  "CRITICAL ENVIRONMENT: fill AT LEAST 70% of the page with colorable scenery that matches THIS scene — ground, sky, trees, buildings, furniture, props reaching the edges. The child is SMALLER in the frame. Absolutely NO empty white void, NO floating character on blank paper, NO portrait-only composition. Do NOT invent a market unless the scene is a market.";

export const EYES_BOOST =
  "CRITICAL FACE: draw BOTH eyes with a dark pupil circle AND iris inside each eye outline — never blank white eyes, never empty ovals. Natural round child head, not elongated or deformed.";

export const LINEART_BOOST =
  "STRICT BLACK AND WHITE LINE ART ONLY: pure black outlines on white paper, absolutely NO color, no colored fills, no shading, no grey — a printable coloring page, NOT a colored illustration. No artist signature, no watermark, no text in the corners.";

export const STYLE_PRESERVE_BOOST =
  "CRITICAL STYLE PRESERVE: keep the EXACT same organic ink hand, character identities, proportions and coloring-book aesthetic as the rest of this book — do not switch artists or line styles.";

export const PREMIUM_PAGE_BOOST =
  "PREMIUM PRODUCT GATE: ONE SINGLE FULL-PAGE CONTINUOUS COLORING SCENE — absolutely NO comic panels, split frames, grids, gutters, panel borders, speech bubbles, captions or text boxes. Coherent foreground, midground and background with at least 6 LARGE CLOSED scene-specific colorable objects; correct anatomy with no missing/extra/fused limbs; professional organic children's-book ink with gently varied line weight; no generic clipart and no giant glossy emoji eyes.";

export const COLOR_SHEET_BOOST =
  "IMPORTANT: render the characters in soft flat COLORS (colored skin, hair, outfits and fur) with bold cartoon outlines — this reference portrait must NOT be black-and-white line art.";

export const ANATOMY_FIX_BOOST =
  "CRITICAL ANATOMY: every face and body must be coherent — two symmetric eyes with pupils, one nose, one mouth, two arms with five-finger hands, two legs; NO missing, extra, fused, duplicated or deformed limbs or facial features.";

export const SINGLE_COMPOSITION_BOOST =
  "CRITICAL COMPOSITION: ONE single continuous full-bleed illustration — absolutely NO comic panels, split frames, storyboard grids, gutters, borders, speech bubbles, captions or inset boxes.";

export const SHARP_PRINT_BOOST =
  "CRITICAL PRINT QUALITY: sharp, high-contrast, perfectly readable upright PORTRAIT-orientation artwork — no blur, no noise, no corruption, no sideways or upside-down framing.";

export const CHILD_SAFE_BOOST =
  "CRITICAL CHILD SAFETY: gentle, joyful, reassuring children's-book content only — absolutely no scary, violent, dark, injured or distressing imagery of any kind.";

export const RASTER_LINE_ART_BOOST =
  "CRITICAL PRINT RENDERING: PURE WHITE background with THIN, clean, continuous BLACK OUTLINES only. Every enclosed region stays WHITE and open for a child to color. ABSOLUTELY NO solid black areas, NO filled black shapes or silhouettes, NO black background, NO white-lines-on-black negative/inverted rendering, NO shading, NO grayscale tones, NO fully painted zones. Large friendly open shapes suitable for ages 6–8. NO text, letters, glyphs, musical notes, decorative symbols, signature or watermark anywhere in the image.";

/**
 * COVER_STORY_ACTION_BOOST — re-injects the exact planned action and a short
 * story summary so the re-roll shows the story instead of a generic pose.
 */
export function buildCoverStoryActionBoost(params: {
  action?: string;
  storySummary?: string;
}): string {
  const action = (params.action || "").trim().slice(0, 300);
  const summary = (params.storySummary || "").trim().slice(0, 240);
  return [
    "CRITICAL STORY COVER:",
    action
      ? `The cover MUST physically SHOW this exact story action, mid-movement: "${action}". Subject, verb, object and setting of that action must all be visible.`
      : "The cover MUST physically show the story's key action mid-movement.",
    summary ? `Story context: ${summary}.` : "",
    "ABSOLUTELY NO generic standing pose, NO static character lineup, NO neutral portrait — the story requires a visible action.",
    "Keep ONE single unique cover composition (no comic panels, split frames or bubbles) and keep the top title band visually calm and unobstructed.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * IDENTITY_REFERENCE_BOOST — designates the reference image(s) as the immutable
 * identity source. Only pose, compatible expression and scenery may change.
 */
export function buildIdentityReferenceBoost(params: {
  cast?: Array<{ name: string; kind?: string }>;
  multiReference?: boolean;
}): string {
  const cast = params.cast || [];
  const castLine = cast.length
    ? `The EXACT cast is: ${cast
        .map((c) => `${c.name}${c.kind ? ` (${c.kind})` : ""}`)
        .join(", ")} — nobody else.`
    : "";
  const refWord = params.multiReference
    ? "Each provided reference image is"
    : "The provided reference image is";
  return [
    `CRITICAL IDENTITY: ${refWord} the IMMUTABLE source of truth for its character.`,
    "Reproduce the SAME face shape, apparent age, skin tone, hairstyle, body proportions, distinctive marks and defined outfit as the reference.",
    "Change ONLY the pose, a compatible expression and the scenery.",
    "Do NOT reinterpret, genericize, age up, age down or 'beautify' the character — any drift from the reference identity is a failure.",
    castLine,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface BoostRoutingContext {
  /** The planned action for this image (cover beat or page action). */
  action?: string;
  /** Short story summary (title + synopsis) for story re-injection. */
  storySummary?: string;
  /** Expected cast for identity/cast boosts. */
  cast?: Array<{ name: string; kind?: string }>;
  /** More than one ordered reference image in play. */
  multiReference?: boolean;
}

/**
 * Map the CURRENT attempt's verdict tags to targeted boosts (deduped, stable
 * order). Pure and side-effect free — decision-tested by the reliability suite.
 */
export function routeBoostsForVerdicts(
  verdicts: string[],
  ctx: BoostRoutingContext
): string[] {
  const boosts: string[] = [];
  const push = (b: string) => {
    if (b && !boosts.includes(b)) boosts.push(b);
  };
  for (const raw of verdicts) {
    const tag = String(raw || "").toLowerCase();
    if (tag.startsWith("story-mismatch:")) {
      push(buildCoverStoryActionBoost(ctx));
    } else if (
      tag.startsWith("cover-action-missing:") ||
      tag.startsWith("action-missing:")
    ) {
      push(buildCoverStoryActionBoost(ctx));
    } else if (tag.startsWith("identity:")) {
      push(
        buildIdentityReferenceBoost({
          cast: ctx.cast,
          multiReference: ctx.multiReference,
        })
      );
    } else if (tag.startsWith("cover-lineup:") || tag.startsWith("lineup:")) {
      push(ANTI_LINEUP_BOOST);
    } else if (tag.startsWith("cast:")) {
      push(CAST_FIX_BOOST);
    } else if (tag.startsWith("anatomy:")) {
      push(ANATOMY_FIX_BOOST);
    } else if (tag.startsWith("comic-layout:")) {
      push(SINGLE_COMPOSITION_BOOST);
    } else if (tag.startsWith("craft:")) {
      push(PREMIUM_PAGE_BOOST);
    } else if (tag.startsWith("environment:")) {
      push(ENV_BOOST);
      push(PREMIUM_PAGE_BOOST);
    } else if (tag.startsWith("title:")) {
      push(TITLE_FIX_BOOST);
    } else if (
      tag.startsWith("blur:") ||
      tag.startsWith("orientation:") ||
      tag.startsWith("corrupt:")
    ) {
      push(SHARP_PRINT_BOOST);
    } else if (
      tag.startsWith("cover-quality:") ||
      tag.startsWith("page-quality:")
    ) {
      push(PREMIUM_PAGE_BOOST);
    } else if (tag.startsWith("unsafe:")) {
      push(CHILD_SAFE_BOOST);
    } else if (tag.startsWith("raster-")) {
      // Deterministic final-render defects (black flood, inversion,
      // silhouette, empty, no white background) — see lib/raster-gate.ts.
      push(RASTER_LINE_ART_BOOST);
    }
  }
  return boosts;
}
