import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-cream-200/80 bg-white/80 p-6 shadow-soft backdrop-blur-sm",
        className
      )}
    >
      {children}
    </div>
  );
}
