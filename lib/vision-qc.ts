/**
 * Vision QC (audit fixes T4/T5/T6) — scene-level checks the pixel guards
 * (lib/image-quality.ts) cannot do: cast count/species, lineup syndrome,
 * action visibility, cover-title legibility.
 *
 * Provider: OpenAI gpt-4o-mini (vision) preferred — Groq free TPM saturates
 * mid-book and the old 9–20s 429 waits killed the Vercel 300s budget.
 * Falls back to Groq vision only when OPENAI_API_KEY is unset.
 *
 * FAIL-OPEN BY DESIGN: any provider error, timeout, 429, or unparsable answer
 * returns null ("cannot judge") and the caller MUST accept the image. Vision QC
 * is a safety net — it must never break or block a generation.
 */

const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";
const VISION_TIMEOUT_MS = Number(process.env.VISION_QC_TIMEOUT_MS || 25_000);

type VisionBackend = {
  url: string;
  key: string;
  model: string;
  /** Groq thinking models need reasoning_effort: none */
  groqThinking?: boolean;
};

function resolveVisionBackend(): VisionBackend | null {
  if (process.env.VISION_QC === "false") return null;
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      key: openaiKey,
      model: OPENAI_VISION_MODEL,
    };
  }
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    return {
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKey,
      model: GROQ_VISION_MODEL,
      groqThinking: true,
    };
  }
  return null;
}

export interface CastCheck {
  /** Number of distinct characters the model sees in the image. */
  count: number;
  /** True when count and species/kinds match the expected cast. */
  matches: boolean;
  /** Short English reason when it does not match. */
  issue?: string;
}

export interface PageCheck {
  /** True = characters standing in a row, front-facing, no action. */
  lineup: boolean;
  /** True = the requested action is actually visible in the image. */
  actionVisible: boolean;
  /** True = one continuous full-page scene, with no comic panels, gutters, bubbles or text boxes. */
  singleFullPage: boolean;
  /** Foreground + midground + background contain enough large closed shapes to color. */
  environmentRich: boolean;
  /** No malformed, duplicated or missing limbs/facial features. */
  anatomyValid: boolean;
  /** Looks like professionally illustrated children's line art, not generic clipart. */
  professionalLineArt: boolean;
  issue?: string;
}

export interface CoverCheck {
  /** True = the title text is present and clearly legible. */
  titleLegible: boolean;
  issue?: string;
}

/** Premium identity contract — covers, pages and multi-character scenes. */
export const IDENTITY_PASS_SCORE = 85;

/**
 * Pure identity threshold used by checkIdentityReferences (and unit tests).
 * A character passes only at score >= IDENTITY_PASS_SCORE.
 */
export function identityScoresPass(
  scores: Array<{ score: number }>,
  expectedCount: number
): boolean {
  return (
    scores.length === expectedCount &&
    scores.every(
      (item) =>
        Number.isFinite(item.score) && item.score >= IDENTITY_PASS_SCORE
    )
  );
}

/**
 * Cover poster QC — hard gates for anatomy/craft/safety/composition, with soft
 * lineup/action signals. Does NOT require 6 colorable environment zones (pages do).
 */
export interface CoverPosterCheck {
  lineup: boolean;
  actionVisible: boolean;
  /** One continuous cover poster — no comic panels, gutters, bubbles. */
  singleComposition: boolean;
  anatomyValid: boolean;
  professionalLineArt: boolean;
  /** Sharp, readable line art — not blurry or corrupted. */
  sharpReadable: boolean;
  orientationCorrect: boolean;
  /** Clearly related to the requested story beat / title context. */
  storyRelated: boolean;
  childSafe: boolean;
  issue?: string;
}

/**
 * Map a CoverPosterCheck into vision score deltas + verdict tags that feed
 * canSoftAcceptCover. Exported for integration tests (real gate wiring).
 */
export function applyCoverPosterVerdicts(poster: CoverPosterCheck): {
  visionScore: number;
  verdicts: string[];
} {
  let visionScore = 0;
  const verdicts: string[] = [];
  if (poster.lineup || !poster.actionVisible) {
    visionScore += poster.lineup ? 2 : 1;
    verdicts.push(
      `cover-${poster.lineup ? "lineup" : "action-missing"}:${poster.issue || ""}`
    );
  }
  if (!poster.singleComposition) {
    visionScore += 5;
    verdicts.push(
      `comic-layout:${poster.issue || "panels, bubbles or split frames on cover"}`
    );
  }
  if (!poster.anatomyValid) {
    visionScore += 4;
    verdicts.push(`anatomy:${poster.issue || "malformed anatomy or face"}`);
  }
  if (!poster.professionalLineArt) {
    visionScore += 3;
    verdicts.push(`craft:${poster.issue || "generic or non-colorable line art"}`);
  }
  if (!poster.sharpReadable) {
    visionScore += 4;
    verdicts.push(`blur:${poster.issue || "blurry or corrupted cover"}`);
  }
  if (!poster.orientationCorrect) {
    visionScore += 4;
    verdicts.push(`orientation:${poster.issue || "incorrect orientation"}`);
  }
  if (!poster.storyRelated) {
    visionScore += 4;
    verdicts.push(
      `story-mismatch:${poster.issue || "cover unrelated to the story"}`
    );
  }
  if (!poster.childSafe) {
    visionScore += 5;
    verdicts.push(`unsafe:${poster.issue || "content not suitable for children"}`);
  }
  return { visionScore, verdicts };
}

/**
 * Downscale the image to ~512px and inline it as a data URL. Full-size images
 * cost ~6-7k vision tokens each and blow free TPM quotas. 512px keeps the
 * lineup/cast signals intact at ~4x fewer tokens.
 */
async function toSmallDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const small = await sharp(buf)
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Ask one JSON question about one or more images. Returns null on ANY failure. */
async function askVisionImages<T>(
  imageUrls: string[],
  question: string
): Promise<T | null> {
  const backend = resolveVisionBackend();
  if (!backend || !imageUrls.length) return null;
  const inlined = await Promise.all(
    imageUrls.map(async (url) => (await toSmallDataUrl(url)) || url)
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `${question}\n\nImages are ordered exactly as described. Answer with ONLY a single JSON object, no markdown, no extra prose after the JSON.`,
      },
      ...inlined.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
    ];
    const body: Record<string, unknown> = {
      model: backend.model,
      temperature: 0,
      max_tokens: 500,
      messages: [{ role: "user", content }],
    };
    if (backend.groqThinking) body.reasoning_effort = "none";

    const res = await fetch(backend.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${backend.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 429) {
      console.warn("[vision-qc] 429 rate limit; no identity verdict");
      return null;
    }
    if (!res.ok) {
      console.warn(
        `[vision-qc] provider ${res.status}: ${(await res.text()).slice(0, 200)}`
      );
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || "";
    const afterThink = raw.includes("</think>")
      ? raw.slice(raw.lastIndexOf("</think>") + "</think>".length)
      : raw;
    const match = afterThink.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as T;
  } catch (err) {
    console.warn(
      "[vision-qc] unavailable",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask one JSON question about one image. */
async function askVision<T>(imageUrl: string, question: string): Promise<T | null> {
  return askVisionImages<T>([imageUrl], question);
}

export interface IdentityReference {
  name: string;
  kind: string;
  visualLock?: string;
  referenceImageUrl: string;
}

export interface IdentityCheck {
  matches: boolean;
  scores: Array<{ name: string; score: number; issue?: string }>;
  issue?: string;
}

/**
 * Compare a generated page directly with the ordered portrait references.
 * Image 1 is the candidate page; images 2..N are the character sources of truth.
 */
export async function checkIdentityReferences(
  imageUrl: string,
  references: IdentityReference[]
): Promise<IdentityCheck | null> {
  if (!references.length) return null;
  const referenceMap = references
    .map(
      (ref, index) =>
        `Image ${index + 2}: ${ref.name} (${ref.kind}); locked traits: ${(
          ref.visualLock || "preserve every visible identity trait"
        ).slice(0, 400)}`
    )
    .join("\n");
  const result = await askVisionImages<{
    matches: boolean;
    scores: Array<{ name: string; score: number; issue?: string }>;
    issue?: string;
  }>(
    [imageUrl, ...references.map((ref) => ref.referenceImageUrl)],
    `Image 1 is a generated coloring-book page. Compare every named character in Image 1 with their portrait source:
${referenceMap}
Judge identity, not just species: face/head shape, apparent age, hairstyle or fur markings, body proportions, outfit and signature accessory. Pose, camera angle and black-and-white conversion may change.
A character passes only at score >= 85/100. Every expected reference must appear exactly once and no identity may be swapped.
JSON schema: {"matches": <true only if every score is >=85 and every identity is present once>, "scores": [{"name":"...", "score":<0-100>, "issue":"..."}], "issue":"<overall mismatch>"}`
  );
  if (!result || typeof result.matches !== "boolean" || !Array.isArray(result.scores)) {
    return null;
  }
  const scores = result.scores.map((item) => ({
    name: String(item.name || "").slice(0, 80),
    score: Math.max(0, Math.min(100, Number(item.score) || 0)),
    issue: item.issue ? String(item.issue).slice(0, 180) : undefined,
  }));
  return {
    matches:
      result.matches &&
      identityScoresPass(scores, references.length),
    scores,
    issue: result.issue ? String(result.issue).slice(0, 240) : undefined,
  };
}

/**
 * T4 — cast fidelity: does the image contain EXACTLY the expected characters
 * (count + species/kind)? Used on the model sheet, the cover and pages.
 */
export async function checkCast(
  imageUrl: string,
  expected: Array<{ name: string; kind: string; visualLock?: string }>
): Promise<CastCheck | null> {
  if (!expected.length) return null;
  const castDesc = expected
    .map(
      (c) =>
        `${c.name} (${c.kind}); locked appearance: ${(c.visualLock || "distinct stable identity").slice(0, 500)}`
    )
    .join("\n");
  // HYBRIDE — la question qu'aucun juge ne posait.
  //
  // Preuve (prod gen 6c940ac6, couverture acceptée en production) : Aicha, une
  // petite fille, a été dessinée avec une QUEUE DE RENARD touffue dans le dos,
  // et Kofi le renard se tenait debout sur deux pattes, bras levés. Les deux
  // contrôles vision ont validé l'image, et le garde-fou de soft-accept n'a
  // rien vu passer d'anormal — parce qu'aucune question ne portait sur la
  // contamination d'un personnage par un autre.
  //
  // « KIND » demandait « est-ce bien une humaine ? » — oui, une humaine à
  // queue reste une humaine. « ANATOMY » demandait « des membres manquants,
  // fusionnés ou déformés ? » — une queue n'est ni l'un ni l'autre. La faille
  // n'était donc ni dans le prompt de génération ni dans le garde-fou : il
  // manquait purement et simplement la question.
  //
  // C'est le défaut nº1 rapporté par l'utilisateur, mot pour mot : « tu as un
  // enfant qui a une queue de renard ».
  const result = await askVision<{
    count: number;
    matches: boolean;
    hybrid?: boolean;
    issue?: string;
  }>(
    imageUrl,
    `This image should contain EXACTLY ${expected.length} character(s): ${castDesc} — and NOBODY else (no extra people, no extra animals).
For each expected character, verify ALL of:
- KIND: a turtle is a real turtle, a lion cub is a real young lion, never a human.
- LOCKED IDENTITY: apparent age, gender, head/face shape, hairstyle or fur markings, body proportions, outfit and signature accessory match the written lock. A generic character of the right kind is NOT enough.
- SPECIES PURITY (look carefully, this is the most commonly missed defect): no character may carry another character's body parts. A HUMAN character has NO tail, NO muzzle or snout, NO fur, NO whiskers, NO paws and NO animal ears — look specifically behind and below each human for a tail. An ANIMAL character has NO human face, NO human hands, NO human hair and wears no clothing unless its lock says so. Any blend of a human and an animal is a FAILURE even when it looks deliberate or cute.
Any ANIMAL character must keep the exact species and age stage in a natural stance — a quadruped stands/walks on ALL FOUR legs, is NOT upright on two legs like a person, and wears NO human clothes unless the locked appearance explicitly requires one simple accessory.
JSON schema: {"count": <number of distinct characters you see>, "hybrid": <true if ANY character mixes human and animal body parts, or an animal stands upright like a person>, "matches": <true only if count is exactly ${expected.length} AND hybrid is false AND every kind and locked identity trait matches>, "issue": "<short list of exact identity/species/hybrid mismatches when false>"}`
  );
  if (!result || typeof result.matches !== "boolean") return null;
  const hybride = result.hybrid === true;
  return {
    count: Number(result.count) || 0,
    // Un hybride ne passe jamais, même si le juge a coché `matches` par
    // inadvertance : les deux champs se contredisent, on tranche vers le refus.
    matches: result.matches && !hybride,
    issue: hybride
      ? `personnage hybride humain/animal — ${String(result.issue || "queue, museau, fourrure ou posture bipède sur un personnage qui ne doit pas en avoir").slice(0, 150)}`
      : result.issue
        ? String(result.issue).slice(0, 200)
        : undefined,
  };
}

/**
 * Cover poster check — hard quality/safety/anatomy gates without the interior
 * page's 6-zone environment requirement. Soft signals: lineup / action energy.
 */
export async function checkCoverAction(
  imageUrl: string,
  action: string
): Promise<CoverPosterCheck | null> {
  const result = await askVision<{
    lineup: boolean;
    action_visible: boolean;
    single_composition: boolean;
    anatomy_valid: boolean;
    professional_line_art: boolean;
    sharp_readable: boolean;
    orientation_correct: boolean;
    story_related: boolean;
    child_safe: boolean;
    issue?: string;
  }>(
    imageUrl,
    `This is a children's COLORING BOOK COVER poster (not an interior page). Requested story beat: "${action || "a clear story moment"}".
Evaluate EVERY item. Covers may use a heroic focal pose with limited scenery — do NOT fail for missing dense background props.
1. LINEUP (soft): true ONLY if characters are a static multi-character reference-sheet row with ZERO story energy. A single hero (optionally with a pet) in a readable pose is NOT a lineup.
2. ACTION (soft): is there a readable story moment related to "${action || "the adventure"}"?
3. SINGLE COMPOSITION (hard): exactly ONE continuous poster. Comic panels, gutters, split frames, speech bubbles or caption boxes FAIL.
4. ANATOMY (hard): coherent face/body; no missing, fused, duplicated or deformed limbs/features.
5. PROFESSIONAL LINE ART (hard): clean printable children's-book ink that is actually colorable — not blurry clipart, not filled photorealism.
6. SHARP/READABLE (hard): image is sharp enough to print; not corrupted, heavily blurred or unreadable.
7. ORIENTATION (hard): upright portrait cover orientation.
8. STORY RELATED (hard): the scene clearly relates to the requested story beat (not a random unrelated image).
9. CHILD SAFE (hard): gentle children's content — no gore, sexual content, terror or unsafe themes.
JSON schema: {"lineup": <boolean>, "action_visible": <boolean>, "single_composition": <boolean>, "anatomy_valid": <boolean>, "professional_line_art": <boolean>, "sharp_readable": <boolean>, "orientation_correct": <boolean>, "story_related": <boolean>, "child_safe": <boolean>, "issue": "<brief list of failed hard requirements>"}`
  );
  if (
    !result ||
    typeof result.lineup !== "boolean" ||
    typeof result.action_visible !== "boolean" ||
    typeof result.single_composition !== "boolean" ||
    typeof result.anatomy_valid !== "boolean" ||
    typeof result.professional_line_art !== "boolean" ||
    typeof result.sharp_readable !== "boolean" ||
    typeof result.orientation_correct !== "boolean" ||
    typeof result.story_related !== "boolean" ||
    typeof result.child_safe !== "boolean"
  ) {
    return null;
  }
  return {
    lineup: result.lineup,
    actionVisible: Boolean(result.action_visible),
    singleComposition: result.single_composition,
    anatomyValid: result.anatomy_valid,
    professionalLineArt: result.professional_line_art,
    sharpReadable: result.sharp_readable,
    orientationCorrect: result.orientation_correct,
    storyRelated: result.story_related,
    childSafe: result.child_safe,
    issue: result.issue ? String(result.issue).slice(0, 240) : undefined,
  };
}

/**
 * T5 — anti-lineup: are the characters just standing in a row facing the camera
 * with no action, and is the page's requested action actually visible?
 */
export async function checkPageAction(
  imageUrl: string,
  action: string
): Promise<PageCheck | null> {
  const result = await askVision<{
    lineup: boolean;
    action_visible: boolean;
    single_full_page: boolean;
    environment_rich: boolean;
    anatomy_valid: boolean;
    professional_line_art: boolean;
    issue?: string;
  }>(
    imageUrl,
    `This is a premium printable children's coloring-book page. Requested action: "${action || "a clear story action"}".
Check ALL six product requirements:
1. LINEUP: characters must not merely stand front-facing in a static row.
2. ACTION: the requested story action must be physically visible.
3. TRUE COLORING-PAGE FORMAT: exactly ONE continuous full-page scene. Any comic strip, multiple panels, split frame, panel border, gutter, storyboard grid, speech bubble, dialogue balloon, caption box or text box FAILS.
4. COLORING VALUE: the scene must have a coherent foreground, midground and background with at least 6 large CLOSED colorable objects/zones (for example trees, plants, path, houses, clouds, furniture or scene-specific props). Tiny grass marks do not count. Large blank sky/ground and portrait-only compositions fail.
5. ANATOMY: faces, eyes, hands, arms, legs and bodies must be coherent; no missing, extra, fused or duplicated parts.
6. PROFESSIONAL LINE ART: clean organic children's-book ink drawing with controlled varied line weight and readable forms; generic emoji/clipart look, huge glossy eyes, malformed shapes or careless tangencies fail.
JSON schema: {"lineup": <boolean>, "action_visible": <boolean>, "single_full_page": <boolean>, "environment_rich": <boolean>, "anatomy_valid": <boolean>, "professional_line_art": <boolean>, "issue": "<brief list of every failed requirement>"}`
  );
  if (
    !result ||
    typeof result.lineup !== "boolean" ||
    typeof result.action_visible !== "boolean" ||
    typeof result.single_full_page !== "boolean" ||
    typeof result.environment_rich !== "boolean" ||
    typeof result.anatomy_valid !== "boolean" ||
    typeof result.professional_line_art !== "boolean"
  ) {
    return null;
  }
  return {
    lineup: result.lineup,
    actionVisible: result.action_visible,
    singleFullPage: result.single_full_page,
    environmentRich: result.environment_rich,
    anatomyValid: result.anatomy_valid,
    professionalLineArt: result.professional_line_art,
    issue: result.issue ? String(result.issue).slice(0, 240) : undefined,
  };
}

/** T6 — cover title: is the exact title present and clearly legible? */
export async function checkCoverTitle(
  imageUrl: string,
  title: string
): Promise<CoverCheck | null> {
  const result = await askVision<{ title_legible: boolean; issue?: string }>(
    imageUrl,
    `This is a children's coloring book COVER that should display the title text "${title}".
Is that exact title present, correctly spelled, and clearly legible?
JSON schema: {"title_legible": <boolean>, "issue": "<short reason when false>"}`
  );
  if (!result || typeof result.title_legible !== "boolean") return null;
  return {
    titleLegible: result.title_legible,
    issue: result.issue ? String(result.issue).slice(0, 200) : undefined,
  };
}
