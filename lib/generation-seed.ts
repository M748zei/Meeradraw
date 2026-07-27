/**
 * Deterministic seed family for image generation.
 *
 * Root cause of prod gens 7af5818f / b13a8320 (book 4f356812, "Khadidja"):
 * seeds were derived from bookId only (lib/book-style-seed.ts), so a paid run
 * and its free retry replayed the EXACT same seed family and failed the same
 * way (identity=80, action missing) twice.
 *
 * Contract:
 *  - same (bookId, generationId, assetType, index, reroll) → same seed
 *    (idempotent workflow step resume renders the same expected image);
 *  - a NEW generationId → a different seed family (fresh compositions);
 *  - distinct assetType/index/reroll → distinct seeds (no collisions between
 *    cover, portraits and pages of the same run);
 *  - never Math.random() — determinism is the idempotency foundation.
 */

export type GenerationAssetType =
  | "cover"
  | "sheet"
  | "portrait"
  | "page";

/** Bump when the prompt/seed strategy changes enough to invalidate old families. */
export const SEED_STRATEGY_VERSION = 2;

const SEED_MODULUS = 2147483647;

/** FNV-1a over a string, folded into the positive int31 seed space. */
function fnv1a(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = h >>> 0;
  return n % SEED_MODULUS || 42;
}

/**
 * Stable seed for one asset of one generation run.
 * `index` distinguishes characters (portrait) or page numbers (page);
 * `reroll` distinguishes bounded quality/vision re-rolls within the run.
 */
export function generationSeed(params: {
  bookId: string;
  generationId: string;
  assetType: GenerationAssetType;
  index?: number;
  reroll?: number;
}): number {
  const { bookId, generationId, assetType, index = 0, reroll = 0 } = params;
  return fnv1a(
    [
      "v" + SEED_STRATEGY_VERSION,
      bookId,
      generationId,
      assetType,
      String(index),
      String(reroll),
    ].join("|")
  );
}

/**
 * Derive a distinct-but-stable seed for re-roll `attempt` of a base seed.
 * Used inside the provider re-roll loop where only the numeric base is known.
 * attempt 0 returns the base seed unchanged.
 */
export function seedForReroll(baseSeed: number, attempt: number): number {
  if (!Number.isFinite(baseSeed)) return 42;
  if (attempt <= 0) return Math.abs(Math.floor(baseSeed)) % SEED_MODULUS || 42;
  return fnv1a(`${Math.floor(baseSeed)}#reroll#${Math.floor(attempt)}`);
}
