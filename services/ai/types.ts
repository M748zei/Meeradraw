export interface ResearchBrief {
  topic: string;
  subjectType:
    | "real_person"
    | "folklore"
    | "place"
    | "animal"
    | "sport"
    | "invented"
    | "other";
  facts: string[];
  childSafeAngle: string;
  culturalNotes: string[];
  westAfricanHooks: string[];
  coloringBookScenes: string[];
  characterVisualHints: string[];
  accuracyNotes: string;
  sourcesNote: string;
}

export interface StoryCharacter {
  /** Stable id used in page.characterIds (e.g. char_1). */
  id: string;
  name: string;
  description: string;
  /** French / creative description for the story. */
  appearance: string;
  /**
   * ENGLISH locked visual descriptor for the image model — MUST be identical
   * wording every page (age, skin, hair, face, body, outfit pattern, accessory).
   */
  visualLock: string;
  personality: string;
  /** Explicit semantic species/kind; never infer an animal as human from its name. */
  kind?: string;
  ageBand?: string;
  skinTone?: string;
  hair?: string;
  face?: string;
  body?: string;
  outfit?: string;
  signatureAccessory?: string;
  proportions?: string;
  /**
   * First page (1-based) where this character appears in the story. A character
   * "met" on page N must NOT be drawn on pages < N nor on the cover (spoiler),
   * unless the plan explicitly marks them as a cover hero.
   */
  introducedOnPage?: number;
}

/**
 * Per-universe visual world bible: recurring drawable elements that anchor every
 * page in the SAME world (anti "European street in an African village" drift).
 * Generated once per universe (lazily) and stored on the universe document.
 */
export interface SettingBible {
  /** One-line world identity (EN), e.g. "rural West African savanna village". */
  worldSummary: string;
  /** 8–12 concrete drawable elements of the world (EN), e.g. "giant baobab tree". */
  elements: string[];
  /** Visual elements that must NEVER appear (EN), e.g. "European suburban houses". */
  forbiddenElements: string[];
}

export type ComicBeat =
  | "establishing"
  | "action"
  | "obstacle"
  | "help"
  | "emotion"
  | "resolution";

export type ShotType = "full_body" | "mid_shot" | "wide" | "close_safe";

export interface StoryPlan {
  title: string;
  subtitle?: string;
  /** One-paragraph editorial concept / pitch (FR) — the "look & feel" of the book. */
  concept?: string;
  summary: string;
  moral?: string;
  audienceAge: string;
  characters: StoryCharacter[];
  world: {
    setting: string;
    palette: string;
    mood: string;
  };
  pages: Array<{
    pageNumber: number;
    title: string;
    storyText: string;
    /** English scene prompt; must reference only bible characters. */
    illustrationDescription: string;
    /** English negative prompt: defects/elements to avoid for this page. */
    negativePrompt?: string;
    /** Character ids from bible only. */
    characterIds: string[];
    comicBeat?: ComicBeat;
    shotType?: ShotType;
    /** ONE concrete, drawable action (EN): who does what, e.g. "Nala balances on a log over the river". */
    action?: string;
    /** Pose of EACH character present on this page (EN), keyed by character id. */
    characterPoses?: Record<string, string>;
    /** Camera angle / framing (EN), e.g. "low-angle side view", "bird's-eye view". */
    camera?: string;
    /** This page's specific setting (EN) — where the scene physically happens. */
    pageSetting?: string;
    /** The single focal element the eye should land on first (EN). */
    focalPoint?: string;
  }>;
}

export interface ImageGenerationInput {
  prompt: string;
  style: string;
  /** Full locked character bible string (identical every call). */
  characterBible?: string;
  /** Per-page negative prompt (defects/elements to avoid). */
  negativePrompt?: string;
  worldSetting?: string;
  isCover?: boolean;
  isColoringPage?: boolean;
  /** Primary character reference URL for single-reference image-to-image. */
  referenceImageUrl?: string;
  /**
   * Ordered per-character references for multi-reference generation and identity QC.
   * The order MUST match expectedCast. Multi-character pages must prefer these
   * individual portraits over a composite lineup sheet.
   */
  referenceImageUrls?: string[];
  /** When true, generate a character model sheet (not a story page). */
  isCharacterSheet?: boolean;
  shotType?: ShotType | string;
  comicBeat?: ComicBeat | string;
  /**
   * The page's ONE concrete action (EN). Drives the Kontext identity/composition
   * decoupling ("same characters, NEW poses, actively doing: <action>") and the
   * vision QC "is the action visible?" check.
   */
  action?: string;
  /**
   * COMPACT scene for the reference-guided (Kontext) path. Verified in prod:
   * the full assembled prompt (structured fields + prose + boilerplate) is so
   * long that Kontext ignores it and copies the reference lineup on a white
   * void; the short benchmark prompt produced dynamic scenes. Text-only
   * Ideogram keeps the rich `prompt` (it handles long prompts well).
   */
  refScene?: string;
  /** Book title to letter on the cover (Ideogram renders text well). */
  coverTitle?: string;
  /** 2–4 setting-bible elements relevant to THIS scene (anchors the world). */
  settingElements?: string[];
  /** Negative derived from the universe's setting bible (forbidden elements). */
  worldNegative?: string;
  /** Expected characters IN THIS IMAGE for the vision cast QC (name + species/kind). */
  expectedCast?: Array<{ name: string; kind: string; visualLock?: string }>;
  /** Collector for QC/re-roll stats (mutated by the provider; optional). */
  qcStats?: ImageQcStats;
  /** Force Ideogram text-only (no Kontext) — parent covers. */
  forceTextOnly?: boolean;
  /** Character sheet guided by a real child photo (identity). */
  identityFromPhoto?: boolean;
  /** Override default VISION_QC_REROLLS for this call. */
  maxVisionRerolls?: number;
  /**
   * Cap pixel/quality re-rolls (blank/colored/poor-env). Parent lean path uses 0–1
   * so a single book cannot storm fal.ai billing.
   */
  maxQualityRerolls?: number;
  /** Cap network/provider withRetry attempts for this call (default FAL_RETRY_ATTEMPTS). */
  maxProviderAttempts?: number;
  /** Skip short-prompt blank rescue (extra fal calls). */
  skipRecovery?: boolean;
  /**
   * Stable seed for Ideogram/Flux — same book seed family keeps line weight /
   * cartoon hand coherent across pages (parent books especially).
   */
  seed?: number;
  /**
   * Ideogram V3 style_preset (e.g. COLORING_BOOK_I). Applied identically on
   * every page of a book so heal/reroll cannot jump to another aesthetic.
   */
  stylePreset?: string;
  /** Parent hero gender for prompt/negative gender lock. */
  heroGender?: "girl" | "boy" | "unspecified" | string;
  /**
   * When true: identical series craft lock, style-preserving rerolls (seed+1),
   * recovery keeps the style contract (no aesthetic jump).
   */
  consistencyMode?: boolean;
  /**
   * Paid parent-book contract: never return a candidate that has not passed
   * semantic visual QC (cast/species, anatomy, action and colorable scenery).
   */
  strictQuality?: boolean;
}

/** Per-image QC telemetry so re-roll cost is observable (logged on generations). */
export interface ImageQcStats {
  pixelRerolls?: number;
  visionRerolls?: number;
  /** CUMULATIVE verdict history across attempts — telemetry ONLY, never a decision input. */
  visionVerdicts?: string[];
  /** Per-attempt telemetry (id, score, verdicts) in chronological order. */
  attemptHistory?: Array<{
    attemptId: string;
    score: number;
    verdicts: string[];
  }>;
  /** Attempt selected as best — the ONLY attempt the final decision was made on. */
  bestAttemptId?: string;
  bestScore?: number;
  bestVerdicts?: string[];
  /** Raster stats of the accepted FINAL print render (lib/raster-gate). */
  finalRaster?: Record<string, number>;
  /** True when an inverted render was deterministically repaired + re-gated. */
  rasterRepairedInversion?: boolean;
  /** True when vision QC confirmed lineup syndrome at least once. */
  lineupDetected?: boolean;
  /** True when a delivered candidate diverged from its visual reference. */
  identityMismatchDetected?: boolean;
}

/** Short creative brief shown on the new-book step (before full generation). */
export interface EnrichedIdea {
  title: string;
  synopsis: string;
  castHints: string[];
  beats: string[];
  /** Combined brief fed into the generation pipeline as `book.idea`. */
  creativeBrief: string;
}

export interface EnrichIdeaOptions {
  style?: string;
  childName?: string;
  audience?: string;
}

export interface TextAIProvider {
  enrichIdea(rawIdea: string, opts?: EnrichIdeaOptions): Promise<EnrichedIdea>;
  buildResearchBrief(idea: string): Promise<ResearchBrief>;
  generateStoryPlan(
    idea: string,
    pageCount: number,
    style: string,
    research?: ResearchBrief,
    audience?: string,
    opts?: {
      originalIdea?: string;
      childName?: string;
      childGender?: string;
      parentMode?: boolean;
    }
  ): Promise<StoryPlan>;
  /** Visual world bible for a universe (lazy, cached on the universe doc). */
  generateSettingBible(params: {
    universeTitle: string;
    universeDescription?: string;
    worldSetting?: string;
    style?: string;
  }): Promise<SettingBible>;
}

export interface ImageAIProvider {
  generateImage(input: ImageGenerationInput): Promise<{ url: string; provider: string }>;
}
