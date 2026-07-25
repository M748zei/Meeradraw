import { qualitySummaryCopy, type BookQualitySummary } from "@/lib/quality-score";
import { cn } from "@/lib/utils";

type Props = {
  quality: BookQualitySummary | NonNullable<import("@/types/database").Book["quality_summary"]>;
};

export function QualityScoreCard({ quality }: Props) {
  const q = quality as BookQualitySummary;
  const score = typeof q.score === "number" ? q.score : 0;
  const tone =
    score >= 90
      ? "border-mint-200 bg-mint-50 text-mint-900"
      : score >= 70
        ? "border-sky-200 bg-sky-50 text-sky-950"
        : score >= 50
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-rose-200 bg-rose-50 text-rose-950";

  const label = q.label || (score >= 70 ? "bon" : "à améliorer");
  const detail = qualitySummaryCopy({
    score,
    pages_ok: q.pages_ok ?? 0,
    pages_total: q.pages_total ?? 0,
    failed_pct: q.failed_pct ?? 0,
    lineup_pct: q.lineup_pct ?? 0,
    lineup_pages: q.lineup_pages ?? 0,
    pixel_rerolls: q.pixel_rerolls ?? 0,
    vision_rerolls: q.vision_rerolls ?? 0,
    gate_partial: Boolean(q.gate_partial),
    label: (label as BookQualitySummary["label"]) || "bon",
  });

  return (
    <div className={cn("mt-4 rounded-2xl border px-4 py-3", tone)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          Qualité du cahier · {score}/100
          <span className="ml-2 font-normal opacity-80">({label})</span>
        </p>
        {q.gate_partial ? (
          <span className="text-xs font-medium uppercase tracking-wide opacity-80">
            À vérifier avant impression
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm opacity-90">{detail}</p>
      {q.gate_partial && (q.lineup_pct ?? 0) >= 40 ? (
        <p className="mt-2 text-xs opacity-80">
          Trop de pages avec poses « alignées » — régénérez les pages concernées
          pour un meilleur résultat.
        </p>
      ) : null}
    </div>
  );
}
