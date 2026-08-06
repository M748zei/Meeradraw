import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 font-display text-lg text-white shadow-soft"
      >
        G
      </span>
      <span className="font-display text-lg tracking-tight text-ink">
        Griot<span className="text-amber-600">.</span>
      </span>
    </Link>
  );
}
