/**
 * Closed allowlist for soft-accepting a cover after quality re-rolls.
 *
 * Soft-accept is ONLY for light composition/energy defects on an otherwise
 * usable cover poster. Identity, cast, anatomy, safety and corruption always
 * hard-reject — never a global `score <= N` rule.
 */

export type CoverQcResult = {
  /** True when this candidate is a book cover (not an interior page). */
  isCover: boolean;
  /** Pixel blank / near-blank / unreadable bytes. */
  blank: boolean;
  /** Colored when line-art was required (pixel defect). */
  colored?: boolean;
  /** Aggregate QC score (lower is better). Informational only — not the gate. */
  score: number;
  /** Vision/pixel verdict tags accumulated for this candidate (and recent attempts). */
  verdicts: string[];
};

/** Soft composition tags the cover gate may forgive after re-rolls. */
const SOFT_COVER_VERDICT_ALLOWLIST: readonly RegExp[] = [
  /^cover-lineup:/i,
  /^cover-action-missing:/i,
  // Legacy / alternate prefixes sometimes emitted by older prompts.
  /^lineup:/i,
  /^action-missing:/i,
];

/**
 * Hard defects that must NEVER soft-accept a cover, regardless of numeric score.
 * Keep this list closed and explicit.
 */
const HARD_COVER_VERDICT_BLOCKLIST: readonly RegExp[] = [
  /^identity:/i,
  /^cast:/i,
  /^comic-layout:/i,
  /^anatomy:/i,
  /^craft:/i,
  /^environment:/i,
  /^title:/i,
  /^cover-quality:vision-unavailable/i,
  /^page-quality:/i,
  // Explicit safety / corruption / orientation tags (present or future).
  /^unsafe:/i,
  /^nsfw:/i,
  /^dangerous:/i,
  /^corrupt:/i,
  /^blur:/i,
  /^orientation:/i,
  /^off-topic:/i,
  /^story-mismatch:/i,
  /^hero-missing:/i,
  /^parasite-text:/i,
  /^illegible-text:/i,
];

function isSoftCoverVerdict(tag: string): boolean {
  return SOFT_COVER_VERDICT_ALLOWLIST.some((re) => re.test(tag));
}

function isHardCoverVerdict(tag: string): boolean {
  return HARD_COVER_VERDICT_BLOCKLIST.some((re) => re.test(tag));
}

/**
 * Whether a cover candidate may be soft-accepted after re-rolls are exhausted.
 *
 * Allowlist-only: every non-empty verdict must match a soft composition pattern,
 * and none may match a hard blocklist pattern. Blank / corrupt images always fail.
 */
export function canSoftAcceptCover(qc: CoverQcResult): boolean {
  if (!qc.isCover) return false;
  if (qc.blank) return false;

  // Prefer the most recent verdicts (re-roll loop appends chronologically).
  const verdicts = (qc.verdicts || [])
    .filter((v) => typeof v === "string" && v.trim().length > 0)
    .slice(-8);

  if (verdicts.some(isHardCoverVerdict)) return false;

  // Soft-accept requires at least one soft composition signal, and ONLY soft signals.
  // An empty verdict list with score>0 is a pixel/unknown defect → do not soft-accept
  // (repairableColorOnly handles pure chroma leakage separately).
  if (verdicts.length === 0) return false;

  return verdicts.every(isSoftCoverVerdict);
}

/** Test/helper exports — closed lists for documentation and regression locks. */
export const COVER_SOFT_ACCEPT_ALLOWLIST = SOFT_COVER_VERDICT_ALLOWLIST;
export const COVER_SOFT_ACCEPT_BLOCKLIST = HARD_COVER_VERDICT_BLOCKLIST;
