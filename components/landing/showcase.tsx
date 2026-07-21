"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Sparkles, Star } from "lucide-react";

/**
 * Animated fan of real generated coloring pages (public/_gentest7/*).
 * Used on the landing hero as living proof of output quality.
 */
const PAGES = [
  { src: "/_gentest7/page3.jpg", rotate: -8, x: -18, y: 14, z: 10 },
  { src: "/_gentest7/cover.jpg", rotate: 0, x: 0, y: 0, z: 30 },
  { src: "/_gentest7/page5.jpg", rotate: 8, x: 18, y: 14, z: 10 },
];

export function HeroShowcase() {
  return (
    <div className="relative mx-auto flex h-[300px] w-full max-w-md items-center justify-center sm:h-[360px]">
      {PAGES.map((p, i) => (
        <motion.div
          key={p.src}
          initial={{ opacity: 0, y: 40, rotate: p.rotate * 2, scale: 0.9 }}
          animate={{ opacity: 1, y: p.y, rotate: p.rotate, scale: 1 }}
          transition={{ delay: 0.15 * i, type: "spring", stiffness: 90, damping: 14 }}
          whileHover={{ y: p.y - 12, rotate: p.rotate * 0.5, scale: 1.04, zIndex: 40 }}
          style={{ zIndex: p.z, translateX: p.x }}
          className="absolute"
        >
          <div className="overflow-hidden rounded-2xl border-4 border-white bg-white shadow-lift">
            <Image
              src={p.src}
              alt="Exemple de page de coloriage générée par Meeradraw"
              width={230}
              height={230}
              className="h-44 w-44 object-cover sm:h-56 sm:w-56"
            />
          </div>
        </motion.div>
      ))}

      {/* Floating sparkle accents */}
      <motion.div
        aria-hidden
        animate={{ y: [0, -10, 0], rotate: [0, 15, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -right-2 top-4 text-yellow-300 sm:-right-6"
      >
        <Sparkles className="h-8 w-8 fill-yellow-300" />
      </motion.div>
      <motion.div
        aria-hidden
        animate={{ y: [0, 10, 0], rotate: [0, -20, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute -left-2 bottom-6 text-sky-400 sm:-left-4"
      >
        <Star className="h-6 w-6 fill-sky-300" />
      </motion.div>
    </div>
  );
}
