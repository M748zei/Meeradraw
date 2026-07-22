"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

gsap.registerPlugin(useGSAP, DrawSVGPlugin);

/**
 * « Le coloriage qui se dessine » — a hand-drawn coloring page (inline SVG,
 * ~3 KB) whose strokes draw themselves, then get colored in, crayon-style.
 *
 * Perf notes (mobile Afrique first):
 * - Pure SVG + GSAP core, no WebGL, no images. Loaded lazily (see
 *   hero-drawing-lazy.tsx) so gsap never blocks the landing render.
 * - prefers-reduced-motion → the finished, colored page is shown instantly.
 */
export function HeroDrawing() {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        gsap.set(".hd-stroke", { drawSVG: "100%" });
        gsap.set(".hd-fill", { opacity: 0.9 });
        gsap.set(".hd-caption", { opacity: 1, y: 0 });
        return;
      }

      const tl = gsap.timeline({ defaults: { ease: "power1.inOut" } });
      // 1. The pencil draws the scene, group by group.
      tl.from(".hd-scene", { drawSVG: 0, duration: 1.1, stagger: 0.12 })
        .from(".hd-fox", { drawSVG: 0, duration: 1.3, stagger: 0.14 }, "-=0.35")
        .from(".hd-face", { drawSVG: 0, duration: 0.55, stagger: 0.1 }, "-=0.2")
        // 2. The crayons color it in.
        .to(".hd-fill", { opacity: 0.9, duration: 0.5, stagger: 0.09 }, "+=0.15")
        // 3. The caption pops.
        .to(".hd-caption", { opacity: 1, y: 0, duration: 0.45, ease: "back.out(1.6)" }, "-=0.2");
    },
    { scope }
  );

  return (
    <div
      ref={scope}
      className="relative mx-auto w-full max-w-md"
      aria-hidden="true"
    >
      <div className="rotate-1 rounded-3xl border-4 border-white bg-white p-4 shadow-lift">
        <svg viewBox="0 0 420 330" fill="none" className="h-auto w-full">
          {/* ---- fills (colored-in layer, revealed after drawing) ---- */}
          <g className="hd-fill" opacity="0">
            <circle cx="352" cy="58" r="30" fill="#FFD75E" />
          </g>
          <g className="hd-fill" opacity="0">
            <path d="M60 96c-26 4-40 26-30 46 8 18 34 26 58 18 24-8 34-30 22-48-10-14-30-20-50-16Z" fill="#8FD694" />
          </g>
          <g className="hd-fill" opacity="0">
            <path d="M0 292c60-22 130-30 210-24s150 18 210 30v32H0Z" fill="#C8ECC4" />
          </g>
          <g className="hd-fill" opacity="0">
            <path d="M208 140c-30 0-56 24-58 58-2 30 16 60 52 64 40 4 66-22 66-58 0-36-26-64-60-64Z" fill="#F7A85C" />
            <path d="M172 150c-9-14-12-30-3-42 11 7 19 22 21 40Z" fill="#F7A85C" />
            <path d="M244 150c9-14 12-30 3-42-11 7-19 22-21 40Z" fill="#F7A85C" />
            <path d="M262 206c22-4 40 6 44 22-16 8-36 6-48-6Z" fill="#F9C78E" />
          </g>
          <g className="hd-fill" opacity="0">
            <path d="M188 214c8 10 32 10 40 0 2 14-8 24-20 24s-22-10-20-24Z" fill="#FDE6CE" />
          </g>
          <g className="hd-fill" opacity="0">
            <circle cx="110" cy="266" r="7" fill="#F49AC1" />
            <circle cx="318" cy="272" r="7" fill="#F49AC1" />
          </g>

          {/* ---- strokes (the drawing itself) ---- */}
          <g
            stroke="#2F2A26"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* sun */}
            <circle className="hd-stroke hd-scene" cx="352" cy="58" r="30" />
            <path className="hd-stroke hd-scene" d="M352 12v-8M352 112v-8M398 58h8M306 58h-8M385 25l6-6M313 91l-6 6M385 91l6 6M313 25l-6-6" />
            {/* baobab */}
            <path className="hd-stroke hd-scene" d="M62 160c2 30-2 60-8 88M74 160c4 30 10 58 20 86" />
            <path className="hd-stroke hd-scene" d="M60 96c-26 4-40 26-30 46 8 18 34 26 58 18 24-8 34-30 22-48-10-14-30-20-50-16Z" />
            {/* ground */}
            <path className="hd-stroke hd-scene" d="M0 292c60-22 130-30 210-24s150 18 210 30" />
            <path className="hd-stroke hd-scene" d="M138 276c6-8 14-8 20 0M282 282c6-8 14-8 20 0" />
            {/* clouds */}
            <path className="hd-stroke hd-scene" d="M120 52c4-12 20-14 26-4 10-8 24 0 22 12 8 2 10 12 2 16-12 6-40 6-50-2-6-6-4-16 0-22Z" />
            {/* flowers */}
            <path className="hd-stroke hd-scene" d="M110 296v-22M318 300v-20" />
            <circle className="hd-stroke hd-scene" cx="110" cy="266" r="7" />
            <circle className="hd-stroke hd-scene" cx="318" cy="272" r="7" />

            {/* fox body */}
            <path className="hd-stroke hd-fox" d="M208 140c-30 0-56 24-58 58-2 30 16 60 52 64 40 4 66-22 66-58 0-36-26-64-60-64Z" />
            {/* ears */}
            <path className="hd-stroke hd-fox" d="M172 150c-9-14-12-30-3-42 11 7 19 22 21 40" />
            <path className="hd-stroke hd-fox" d="M244 150c9-14 12-30 3-42-11 7-19 22-21 40" />
            {/* tail */}
            <path className="hd-stroke hd-fox" d="M262 206c22-4 40 6 44 22-16 8-36 6-48-6" />
            {/* legs */}
            <path className="hd-stroke hd-fox" d="M182 258c-2 12-2 22 0 32M234 258c2 12 2 22 0 32" />
            {/* muzzle */}
            <path className="hd-stroke hd-fox" d="M188 214c8 10 32 10 40 0 2 14-8 24-20 24s-22-10-20-24Z" />

            {/* face */}
            <path className="hd-face hd-stroke" d="M186 192c4-4 10-4 14 0M216 192c4-4 10-4 14 0" />
            <path className="hd-face hd-stroke" d="M202 212c2 4 10 4 12 0" />
            <circle className="hd-face hd-stroke" cx="208" cy="210" r="3" fill="#2F2A26" />
          </g>
        </svg>

        <div className="hd-caption translate-y-3 pt-2 text-center opacity-0">
          <p className="font-display text-lg text-ink">« Le renard des sables »</p>
          <p className="text-xs text-ink-muted">
            Dessiné, colorié et mis en page par Meeradraw
          </p>
        </div>
      </div>
    </div>
  );
}
