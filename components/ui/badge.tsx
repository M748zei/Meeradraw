import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700",
        className
      )}
    >
      {children}
    </span>
  );
}
