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
  /** Trials currently reserved by in-flight generations (anti double-start). */
  free_trials_in_progress?: number;
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
  /** Lazy per-universe visual world contract (generation sprint 2026-07-22). */
  setting_bible?: Record<string, unknown> | null;
  /** Per-character crops of the model sheet, keyed by character id_key. */
  model_sheet_crops?: Record<string, { url?: string; path?: string | null }> | null;
  model_sheet_url?: string | null;
  model_sheet_path?: string | null;
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
  /** Canonical Storage object path used to refresh the expiring signed PDF URL. */
  pdf_path?: string | null;
  /** Storage object path of the persisted cover (signed URL in cover_image). */
  cover_image_path?: string | null;
  /** In-flight generation id while status === generating (progress deep-link). */
  active_generation_id?: string | null;
  style: string | null;
  /** Target audience (e.g. "enfants 4–8 ans"); falls back to audience_age. */
  audience?: string | null;
  audience_age?: string | null;
  /** Child first name for parent MVP — injected into bible / titles / storyText. */
  child_name?: string | null;
  /** Parent create: girl | boy | unspecified */
  child_gender?: string | null;
  /** Parent's free-text story brief (becomes original_idea). */
  parent_story?: string | null;
  /** Optional child photo URL used as identity reference for the model sheet. */
  child_photo_url?: string | null;
  /** Storage path for child photo — re-sign short-lived URLs on read. */
  child_photo_path?: string | null;
  /** "parent_create" enables the fast reliable parent pipeline. */
  source?: string | null;
  /** After a compensated failure, one controlled free restart is allowed. */
  free_retry_available?: boolean | null;
  /** Locked character descriptors injected into every image prompt. */
  character_bible?: string | null;
  character_sheet_url?: string | null;
  story_plan?: Record<string, unknown> | null;
  /** Studio-only quality telemetry (not written/shown for parent books). */
  quality_summary?: {
    score: number;
    pages_ok: number;
    pages_total: number;
    failed_pct: number;
    lineup_pct: number;
    lineup_pages?: number;
    pixel_rerolls?: number;
    vision_rerolls?: number;
    gate_partial?: boolean;
    label?: string;
  } | null;
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
  /** Storage object path of the persisted illustration. */
  illustration_path?: string | null;
  activity_type: string | null;
  generation_status: PageGenerationStatus;
  character_ids?: string[] | null;
  comic_beat?: string | null;
  shot_type?: string | null;
  character_lock?: string | null;
  /** Compact scene used for the Kontext reference pass. */
  ref_scene?: string | null;
  action?: string | null;
  camera?: string | null;
  page_setting?: string | null;
  focal_point?: string | null;
  negative_prompt?: string | null;
  /** Per-page QC telemetry (pixel/vision re-rolls, lineup flags). */
  qc_stats?: {
    pixelRerolls?: number;
    visionRerolls?: number;
    visionVerdicts?: string[];
    lineupDetected?: boolean;
    [key: string]: unknown;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface Character {
  id: string;
  universe_id: string;
  /** Stable key from the story plan (links pages.character_ids to this cast member). */
  id_key?: string;
  name: string;
  description: string | null;
  appearance: string | null;
  visual_lock?: string | null;
  personality: string | null;
  image_reference?: string | null;
  age_band?: string | null;
  skin_tone?: string | null;
  hair?: string | null;
  face?: string | null;
  body?: string | null;
  outfit?: string | null;
  signature_accessory?: string | null;
  proportions?: string | null;
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
  /** `{ is_trial: true }` for free-trial runs. */
  metadata: Record<string, unknown> | null;
  /** QC telemetry (pixel/vision re-roll counts) written at the end of a run. */
  qc_stats?: {
    images?: number;
    pixel_rerolls?: number;
    vision_rerolls?: number;
    vision_verdicts?: Record<string, string[]>;
    quality?: {
      score: number;
      pages_ok: number;
      pages_total: number;
      failed_pct: number;
      lineup_pct: number;
      gate_partial?: boolean;
      label?: string;
    };
    [key: string]: unknown;
  } | null;
  /** Set once when a delivered trial run consumed a free trial (idempotence flag). */
  trial_counted?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreditLedger {
  id: string;
  /** Present when denormalized; subcollection docs under users/{uid} omit it. */
  user_id?: string;
  operation: "credit" | "debit" | "capture";
  /** Product-facing ledger kind (reservation/capture/refund/…). */
  kind?:
    | "reservation"
    | "capture"
    | "refund"
    | "release"
    | "credit"
    | "debit"
    | null;
  amount: number;
  balance_after: number;
  reason: string;
  /** Idempotency key for the mutation (operation + reference_id). */
  reference_id?: string | null;
  created_at: string;
}

export interface GenerationProgress {
  id: string;
  book_id: string;
  status: GenerationStatus;
  progress: number;
  current_step: string | null;
  current_substep?: string | null;
  cover_image: string | null;
  pages: Array<{
    id: string;
    page_number: number;
    title: string | null;
    story_text: string | null;
    illustration_url: string | null;
    generation_status: PageGenerationStatus;
  }>;
  pages_done?: number;
  pages_total?: number;
  elapsed_ms?: number | null;
  estimated_total_ms?: number;
  taking_longer?: boolean;
  credits_reserved?: number;
  credits_state?: "reserved" | "captured" | "released";
  support_id?: string;
  free_retry_available?: boolean;
  error_message: string | null;
}
