/**
 * Post-generation quality score from page delivery + QC telemetry.
 * Used to display a parent-facing score and gate "completed" vs "partial".
 */

import type { ImageQcStats } from "@/services/ai/types";

/** Lineup share above this → book stays `partial` even if every page rendered. */
export const LINEUP_PARTIAL_THRESHOLD = 0.4;

/** Minimum score (0–100) required to mark the book fully completed. */
export const QUALITY_COMPLETED_MIN = 70;

export type BookQualitySummary = {
  score: number;
  pages_ok: number;
  pages_total: number;
  failed_pct: number;
  lineup_pct: number;
  lineup_pages: number;
  pixel_rerolls: number;
  vision_rerolls: number;
  /** True when score/lineup warrants a partial gate. */
  gate_partial: boolean;
  label: "excellent" | "bon" | "à améliorer" | "faible";
};

function hasLineupSignal(stats: ImageQcStats | null | undefined): boolean {
  if (!stats) return false;
  if (stats.lineupDetected) return true;
  return (stats.visionVerdicts || []).some((v) =>
    String(v).toLowerCase().startsWith("lineup")
  );
}

export function labelForScore(score: number): BookQualitySummary["label"] {
  if (score >= 90) return "excellent";
  if (score >= 70) return "bon";
  if (score >= 50) return "à améliorer";
  return "faible";
}

/**
 * Build a parent-facing quality summary from delivered pages + per-image QC.
 */
export function buildBookQualitySummary(input: {
  pagesTotal: number;
  pagesOk: number;
  pageQc: Array<ImageQcStats | null | undefined>;
  pixelRerolls?: number;
  visionRerolls?: number;
}): BookQualitySummary {
  const total = Math.max(0, input.pagesTotal);
  const ok = Math.max(0, Math.min(input.pagesOk, total || input.pagesOk));
  const failedPct = total > 0 ? (total - ok) / total : 1;

  let lineupPages = 0;
  for (const s of input.pageQc) {
    if (hasLineupSignal(s)) lineupPages += 1;
  }
  // Lineup % over pages that actually rendered (failed pages aren't "lineup").
  const lineupBase = Math.max(ok, 1);
  const lineupPct = ok > 0 ? lineupPages / lineupBase : 0;

  // Score: delivery first, then lineup penalty (up to −40), light re-roll noise (−5 max).
  const delivery = total > 0 ? (ok / total) * 100 : 0;
  const lineupPenalty = Math.min(40, lineupPct * 100 * 0.8);
  const rerollNoise = Math.min(
    5,
    ((input.pixelRerolls || 0) + (input.visionRerolls || 0)) * 0.15
  );
  const score = Math.max(
    0,
    Math.min(100, Math.round(delivery - lineupPenalty - rerollNoise))
  );

  const gatePartial =
    ok < total ||
    lineupPct >= LINEUP_PARTIAL_THRESHOLD ||
    score < QUALITY_COMPLETED_MIN;

  return {
    score,
    pages_ok: ok,
    pages_total: total,
    failed_pct: Math.round(failedPct * 1000) / 10,
    lineup_pct: Math.round(lineupPct * 1000) / 10,
    lineup_pages: lineupPages,
    pixel_rerolls: input.pixelRerolls || 0,
    vision_rerolls: input.visionRerolls || 0,
    gate_partial: gatePartial,
    label: labelForScore(score),
  };
}

/** French one-liner for the book detail card. */
export function qualitySummaryCopy(q: BookQualitySummary): string {
  if (q.pages_ok === 0) {
    return "Aucune page illustrée — régénérez le cahier.";
  }
  const parts = [
    `${q.pages_ok}/${q.pages_total} pages OK`,
    q.lineup_pct > 0 ? `${q.lineup_pct}% poses type « alignement »` : null,
    q.failed_pct > 0 ? `${q.failed_pct}% manquantes` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
