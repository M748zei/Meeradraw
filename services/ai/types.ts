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
  ageBand?: string;
  skinTone?: string;
  hair?: string;
  face?: string;
  body?: string;
  outfit?: string;
  signatureAccessory?: string;
  proportions?: string;
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
  /** Character model / reference sheet URL for img2img / Kontext. */
  referenceImageUrl?: string;
  /** When true, generate a character model sheet (not a story page). */
  isCharacterSheet?: boolean;
  shotType?: ShotType | string;
  comicBeat?: ComicBeat | string;
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

export interface TextAIProvider {
  enrichIdea(rawIdea: string): Promise<EnrichedIdea>;
  buildResearchBrief(idea: string): Promise<ResearchBrief>;
  generateStoryPlan(
    idea: string,
    pageCount: number,
    style: string,
    research?: ResearchBrief,
    audience?: string
  ): Promise<StoryPlan>;
}

export interface ImageAIProvider {
  generateImage(input: ImageGenerationInput): Promise<{ url: string; provider: string }>;
}
