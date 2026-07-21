"use client";

import Image from "next/image";
import { motion } from "framer-motion";

const SHOTS = [
  "/_gentest7/cover.jpg",
  "/_gentest7/page1.jpg",
  "/_gentest7/page2.jpg",
  "/_gentest7/page3.jpg",
  "/_gentest7/page4.jpg",
];

/** Responsive gallery of real generated pages, each rising in on scroll. */
export function PageGallery() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {SHOTS.map((src, i) => (
        <motion.div
          key={src}
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.45, delay: (i % 4) * 0.08, ease: "easeOut" }}
          whileHover={{ y: -6, scale: 1.03 }}
          className={i === 0 ? "col-span-2 row-span-2 sm:col-span-2 sm:row-span-2" : ""}
        >
          <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-soft transition-shadow hover:shadow-lift">
            <Image
              src={src}
              alt="Page de coloriage générée par Meeradraw"
              width={500}
              height={500}
              className="aspect-square h-full w-full object-cover"
            />
          </div>
        </motion.div>
      ))}
    </div>
  );
}
