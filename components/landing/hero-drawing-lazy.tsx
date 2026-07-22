"use client";

import dynamic from "next/dynamic";

/**
 * Lazy shell for the animated hero: gsap + the SVG scene only load after the
 * landing shell is interactive (mobile 3G first). The placeholder reserves the
 * space so nothing jumps.
 */
const HeroDrawing = dynamic(
  () => import("./hero-drawing").then((m) => m.HeroDrawing),
  {
    ssr: false,
    loading: () => (
      <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
        <div className="rotate-1 rounded-3xl border-4 border-white bg-white p-4 shadow-lift">
          <div className="aspect-[420/330] w-full" />
          <div className="pt-2 text-center">
            <p className="font-display text-lg text-transparent">…</p>
            <p className="text-xs text-transparent">…</p>
          </div>
        </div>
      </div>
    ),
  }
);

export function HeroDrawingLazy() {
  return <HeroDrawing />;
}
