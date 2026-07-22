export type SubscriptionPlan = "free" | "family" | "creator" | "studio";
export type UniverseVisibility = "private" | "public";
export type BookType = "colorbook" | "storybook" | "activitybook" | "workbook";
export type BookStatus =
  | "draft"
  | "generating"
  | "completed"
  | "partial"
  | "archived"
  | "failed";
export type PageGenerationStatus = "pending" | "generating" | "completed" | "failed";
export type GenerationStatus = "queued" | "running" | "completed" | "failed" | "partial";
export type AssetType = "image" | "pdf" | "thumbnail" | "cover" | "illustration";

export interface Profile {
  id: string;
  fullname: string | null;
  email: string;
  avatar_url: string | null;
  subscription_plan: SubscriptionPlan;
  credits: number;
  /** Free trial books consumed (successful generations without access). */
  free_trials_used?: number;
  /** Per-account trial allowance (defaults to FREE_TRIALS_MAX). */
  free_trials_max?: number;
  /** Mobile Money phone, saved at first recharge to pre-fill Chariow checkout. */
  phone?: { number: string; country_code: string } | null;
  preferred_language: string;
  created_at: string;
  updated_at: string;
}

export interface Universe {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  language: string;
  audience_age: string | null;
  cover_image: string | null;
  visibility: UniverseVisibility;
  created_at: string;
  updated_at: string;
}

export interface Book {
  id: string;
  universe_id: string;
  user_id: string;
  title: string;
  subtitle: string | null;
  type: BookType;
  status: BookStatus;
  cover_image: string | null;
  page_count: number;
  idea: string | null;
  /** Raw user idea before AI enrich (kept for pipeline / audit). */
  original_idea?: string | null;
  /** Structured enrich output (title, synopsis, beats, castHints). */
  enrichment?: {
    title?: string;
    synopsis?: string;
    castHints?: string[];
    beats?: string[];
  } | null;
  pdf_url: string | null;
  style: string | null;
  /** Target audience (e.g. "enfants 4–8 ans"); falls back to audience_age. */
  audience?: string | null;
  audience_age?: string | null;
  /** Locked character descriptors injected into every image prompt. */
  character_bible?: string | null;
  character_sheet_url?: string | null;
  story_plan?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  book_id: string;
  page_number: number;
  title: string | null;
  story_text: string | null;
  illustration_prompt: string | null;
  illustration_url: string | null;
  activity_type: string | null;
  generation_status: PageGenerationStatus;
  character_ids?: string[] | null;
  comic_beat?: string | null;
  shot_type?: string | null;
  character_lock?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Character {
  id: string;
  universe_id: string;
  name: string;
  description: string | null;
  appearance: string | null;
  visual_lock?: string | null;
  personality: string | null;
  image_reference: string | null;
  created_at: string;
}

export interface Generation {
  id: string;
  user_id: string;
  book_id: string;
  provider: string | null;
  generation_type: string;
  current_step: string | null;
  progress: number;
  tokens_used: number;
  credits_used: number;
  duration_ms: number | null;
  status: GenerationStatus;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreditLedger {
  id: string;
  user_id: string;
  operation: "credit" | "debit";
  amount: number;
  balance_after: number;
  reason: string;
  created_at: string;
}

export interface GenerationProgress {
  id: string;
  book_id: string;
  status: GenerationStatus;
  progress: number;
  current_step: string | null;
  cover_image: string | null;
  pages: Array<{
    id: string;
    page_number: number;
    title: string | null;
    story_text: string | null;
    illustration_url: string | null;
    generation_status: PageGenerationStatus;
  }>;
  error_message: string | null;
}
