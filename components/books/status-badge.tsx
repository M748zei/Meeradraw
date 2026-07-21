import { cn } from "@/lib/utils";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: "Brouillon", className: "bg-cream-100 text-ink-muted" },
  generating: { label: "En création…", className: "bg-sky-100 text-sky-700" },
  completed: { label: "Terminé", className: "bg-mint-100 text-mint-800" },
  partial: { label: "Partiel", className: "bg-yellow-100 text-yellow-700" },
  failed: { label: "Échec", className: "bg-rose-100 text-rose-700" },
};

export function StatusBadge({ status, className }: { status?: string; className?: string }) {
  const meta = STATUS_MAP[status ?? "draft"] ?? STATUS_MAP.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        meta.className,
        className
      )}
    >
      {status === "generating" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {meta.label}
    </span>
  );
}
