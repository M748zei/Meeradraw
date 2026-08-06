/**
 * Deterministic raster gate for FINAL print bytes (prod incident, book
 * 55237586 / gen 4f8980ea): pages shipped with 70–95% solid black because the
 * strict gate judged the RAW fal image while threshold(205) print
 * normalization turned colored/shaded fills into black slabs — nothing ever
 * re-checked the bytes that were persisted, shown and put in the PDF.
 *
 * This module analyzes the EXACT bytes that will ship. It is pixel-math only
 * (sharp), independent from the Vision LLM QC, and must reject at minimum:
 * mostly-black pages, black/white inversion, massive solid fills
 * (silhouettes), missing white background, and near-empty pages.
 *
 * Threshold calibration (see runRasterGateTests fixtures — synthetic good
 * line art measures ~2–20% dark, white ≥ 70%, border dark ≈ 0, largest dark
 * blob « 5% of page):
 *  - DARK_FLOOD  0.45 : good dense line art stays < 0.35 even with detailed
 *    scenes; the incident pages measured 0.70–0.95.
 *  - INVERTED    border dark > 0.55 with white < 0.40 : white-on-black pages
 *    have dark margins everywhere; legit pages keep white margins.
 *  - SILHOUETTE  largest connected dark blob > 0.18 of the page : dark hair
 *    or a filled accessory is ≈ 1–5%; a filled character/background slab is
 *    far larger. Chosen not to reject dark skin tones or hair.
 *  - EMPTY       dark < 0.004 : a real scene always inks more than 0.4%.
 *  - NO_WHITE    white < 0.35 : a colorable page is majority open white.
 */

const ANALYZE_SIZE = 128;
const DARK_LEVEL = 64; // gray value < 64 → "dark ink"
const WHITE_LEVEL = 224; // gray value > 224 → "open white"

export interface RasterStats {
  width: number;
  height: number;
  /** Share of analyzed pixels darker than DARK_LEVEL. */
  darkRatio: number;
  /** Share of analyzed pixels lighter than WHITE_LEVEL. */
  whiteRatio: number;
  /** Dark share of the 8%-wide border band (all four edges). */
  borderDarkRatio: number;
  /** Largest 4-connected dark component as a share of the page. */
  largestDarkBlobRatio: number;
}

/** Downscale to a fixed grid and measure ink/white/border/blob statistics. */
export async function analyzeRasterStats(
  png: Buffer | Uint8Array
): Promise<RasterStats> {
  const sharp = (await import("sharp")).default;
  const image = sharp(Buffer.from(png));
  const meta = await image.metadata();
  const { data, info } = await image
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .grayscale()
    .resize(ANALYZE_SIZE, ANALYZE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const total = w * h;
  const dark = new Uint8Array(total);
  let darkCount = 0;
  let whiteCount = 0;
  for (let i = 0; i < total; i++) {
    const v = data[i];
    if (v < DARK_LEVEL) {
      dark[i] = 1;
      darkCount++;
    } else if (v > WHITE_LEVEL) {
      whiteCount++;
    }
  }

  const band = Math.max(1, Math.round(w * 0.08));
  let borderTotal = 0;
  let borderDark = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      borderTotal++;
      if (dark[y * w + x]) borderDark++;
    }
  }

  // Largest 4-connected dark component (iterative flood fill on the grid).
  const seen = new Uint8Array(total);
  let largest = 0;
  const stack: number[] = [];
  for (let start = 0; start < total; start++) {
    if (!dark[start] || seen[start]) continue;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      size++;
      const x = idx % w;
      const y = (idx / w) | 0;
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && dark[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (size > largest) largest = size;
  }

  return {
    width: meta.width || w,
    height: meta.height || h,
    darkRatio: darkCount / total,
    whiteRatio: whiteCount / total,
    borderDarkRatio: borderTotal ? borderDark / borderTotal : 0,
    largestDarkBlobRatio: largest / total,
  };
}

export const RASTER_LIMITS = {
  DARK_FLOOD: 0.45,
  INVERTED_BORDER_DARK: 0.55,
  INVERTED_MAX_WHITE: 0.4,
  SILHOUETTE_BLOB: 0.18,
  EMPTY_DARK: 0.004,
  MIN_WHITE: 0.35,
} as const;

/**
 * Deterministic verdict tags for a final coloring-page/cover raster.
 * Empty array = printable. Tags reuse the `raster-` prefix so the boost
 * router and the soft-accept blocklist treat them as hard defects.
 */
export function rasterVerdicts(stats: RasterStats): string[] {
  const verdicts: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (stats.darkRatio > RASTER_LIMITS.DARK_FLOOD) {
    verdicts.push(`raster-black-flood:${pct(stats.darkRatio)} dark`);
  }
  if (
    stats.borderDarkRatio > RASTER_LIMITS.INVERTED_BORDER_DARK &&
    stats.whiteRatio < RASTER_LIMITS.INVERTED_MAX_WHITE
  ) {
    verdicts.push(
      `raster-inverted:${pct(stats.borderDarkRatio)} dark border, ${pct(stats.whiteRatio)} white`
    );
  }
  if (stats.largestDarkBlobRatio > RASTER_LIMITS.SILHOUETTE_BLOB) {
    verdicts.push(
      `raster-silhouette:largest solid dark shape ${pct(stats.largestDarkBlobRatio)} of page`
    );
  }
  if (stats.darkRatio < RASTER_LIMITS.EMPTY_DARK) {
    verdicts.push(`raster-empty:${pct(stats.darkRatio)} ink`);
  } else if (stats.whiteRatio < RASTER_LIMITS.MIN_WHITE) {
    verdicts.push(`raster-no-white:${pct(stats.whiteRatio)} white background`);
  }
  return verdicts;
}

/**
 * Inversion signature on the SOURCE image (before the white 3:4 print
 * padding, which dilutes the border band and hides the signature): dark
 * borders everywhere and almost no open white.
 */
export function hasInversionSignature(stats: RasterStats): boolean {
  return (
    stats.borderDarkRatio > RASTER_LIMITS.INVERTED_BORDER_DARK &&
    stats.whiteRatio < RASTER_LIMITS.INVERTED_MAX_WHITE
  );
}

/**
 * Whether a failed print render may attempt the deterministic negate-repair:
 * the source must carry the inversion signature, and the render's defects
 * must all be inversion consequences (flood / giant dark blob / missing
 * white / inverted). A genuine silhouette on a white page has no inversion
 * signature and can never sneak into a repair.
 */
export function isInversionRepairEligible(
  renderVerdicts: string[],
  sourceStats: RasterStats
): boolean {
  return (
    renderVerdicts.length > 0 &&
    hasInversionSignature(sourceStats) &&
    renderVerdicts.every(
      (v) =>
        v.startsWith("raster-inverted:") ||
        v.startsWith("raster-black-flood:") ||
        v.startsWith("raster-silhouette:") ||
        v.startsWith("raster-no-white:")
    )
  );
}
