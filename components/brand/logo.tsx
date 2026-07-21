import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5", className)}>
      <Image
        src="/meeradraw-logo.png"
        alt="Meeradraw"
        width={40}
        height={40}
        className="h-10 w-10 rounded-2xl object-cover shadow-soft transition group-hover:scale-105"
        priority
      />
      <span className="font-display text-lg tracking-tight text-ink">
        Meera<span className="text-sky-600">draw</span>
      </span>
    </Link>
  );
}
