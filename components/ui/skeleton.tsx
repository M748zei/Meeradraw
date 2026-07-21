import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-2xl bg-gradient-to-r from-cream-100 via-cream-50 to-cream-100",
        className
      )}
    />
  );
}
