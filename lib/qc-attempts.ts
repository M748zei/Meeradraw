/**
 * Best-attempt QC decision state — the ONLY input to the final strict gate.
 *
 * Root cause of prod gens 7af5818f / b13a8320: the terminal error and the
 * repairable-color decision read `qcStats.visionVerdicts`, the CUMULATIVE
 * verdict history of every attempt. Attempt 1's identity/story failures
 * contaminated the decision about attempt 2's image, identity tags showed up
 * twice, and the reported score belonged to a different attempt than the
 * reported reasons.
 *
 * This module keeps the two concerns separate:
 *  - attemptHistory: full per-attempt telemetry (observability only);
 *  - best attempt (id + score + verdicts): the single source of truth for
 *    accept / soft-accept / repair / terminal-error decisions.
 */

import { canSoftAcceptCover } from "@/lib/cover-soft-accept";

export interface QcAttemptRecord {
  /** Stable per-run attempt id, e.g. "a1", "a2" (1-based loop order). */
  attemptId: string;
  /** Aggregate defect score for THIS attempt (lower is better, 0 = clean). */
  score: number;
  /** Verdict tags observed on THIS attempt only (deduped). */
  verdicts: string[];
  blank: boolean;
  colored: boolean;
}

export interface QcAttemptTracker {
  /** Telemetry of every attempt, in chronological order. */
  attemptHistory: QcAttemptRecord[];
  /** The attempt currently owning the best (lowest) score, or null. */
  best: QcAttemptRecord | null;
}

/** Drop exact-duplicate tags while preserving first-seen order. */
export function dedupeVerdicts(verdicts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of verdicts) {
    const key = String(v || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function createAttemptTracker(): QcAttemptTracker {
  return { attemptHistory: [], best: null };
}

/**
 * Record one attempt and update the best pick. Strictly better score wins;
 * ties keep the earlier attempt (stable, avoids churning bestVerdicts).
 */
export function recordAttempt(
  tracker: QcAttemptTracker,
  attempt: Omit<QcAttemptRecord, "attemptId" | "verdicts"> & { verdicts: string[] }
): QcAttemptRecord {
  const record: QcAttemptRecord = {
    attemptId: `a${tracker.attemptHistory.length + 1}`,
    score: attempt.score,
    verdicts: dedupeVerdicts(attempt.verdicts),
    blank: attempt.blank,
    colored: attempt.colored,
  };
  tracker.attemptHistory.push(record);
  if (!tracker.best || record.score < tracker.best.score) {
    tracker.best = record;
  }
  return record;
}

export type StrictGateOutcome =
  | { accept: true; mode: "clean" | "soft-cover" | "non-strict" }
  | { accept: false; errorMessage: string };

/**
 * Final gate over the SELECTED best attempt only. attemptHistory must never
 * influence this decision — it exists for telemetry.
 *
 *  - clean: score 0;
 *  - soft-cover: closed allowlist (lineup / action-energy) via
 *    canSoftAcceptCover, hard tags always reject;
 *  - otherwise strict → terminal error describing ONLY the best attempt.
 *
 * There is deliberately NO "repairable color" acceptance anymore: prod gen
 * 4f8980ea shipped 70–95%-black pages because colored candidates were
 * accepted on the promise that print normalization would fix them, and the
 * destroyed post-threshold bytes were never re-checked. Strict candidates are
 * now normalized FIRST and judged on their final bytes (lib/print-normalize),
 * so a defect on the best attempt is always a real defect of what would ship.
 */
export function strictGateOutcome(params: {
  strictQuality: boolean;
  isCover: boolean;
  best: QcAttemptRecord;
}): StrictGateOutcome {
  const { strictQuality, isCover, best } = params;
  if (best.score === 0) return { accept: true, mode: "clean" };
  if (!strictQuality) return { accept: true, mode: "non-strict" };

  if (
    canSoftAcceptCover({
      isCover,
      blank: best.blank,
      colored: best.colored,
      score: best.score,
      verdicts: best.verdicts,
    })
  ) {
    return { accept: true, mode: "soft-cover" };
  }

  return { accept: false, errorMessage: strictRejectionMessage(best) };
}

/**
 * Terminal technical message — best attempt only, deduped tags, and the
 * attempt id so score/verdicts/reason provably describe the same image.
 */
export function strictRejectionMessage(best: QcAttemptRecord): string {
  const tags = dedupeVerdicts(best.verdicts).slice(0, 6);
  return (
    `strict visual quality gate rejected image ` +
    `(attempt ${best.attemptId}, score ${best.score}): ` +
    (tags.join("; ") || "pixel quality defect")
  );
}
