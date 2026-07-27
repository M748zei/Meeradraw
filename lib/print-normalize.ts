/**
 * Print normalization for strict coloring pages/covers, extracted from
 * fal-provider so the pipeline can be tested and — critically — so the QC
 * gates run on the EXACT bytes produced here (prod incident 4f8980ea: QC
 * judged raw fal bytes, then this threshold step turned shaded fills into
 * black slabs that shipped unchecked).
 *
 * The candidate flow is: normalize → deterministic raster gate → (optional
 * single inversion repair on a COPY, then the FULL raster gate re-runs on the
 * repaired bytes) → only a candidate whose FINAL bytes pass is eligible for
 * the vision QC and for persistence.
 */

import {
  analyzeRasterStats,
  isInversionRepairEligible,
  rasterVerdicts,
  type RasterStats,
} from "@/lib/raster-gate";

const PRINT_PAGE_WIDTH_PX = Number(process.env.PRINT_PAGE_WIDTH_PX || 2400);
const PRINT_PAGE_HEIGHT_PX = Number(process.env.PRINT_PAGE_HEIGHT_PX || 3200);

export interface PrintCandidate {
  /** Final print PNG — the exact bytes to persist/display/embed if accepted. */
  png: Buffer;
  stats: RasterStats;
  /** Deterministic raster verdicts on the FINAL bytes (empty = printable). */
  verdicts: string[];
  /** True when an inversion was deterministically repaired (on a copy). */
  repairedInversion: boolean;
}

async function renderPrintPng(
  source: Buffer,
  opts: { negate: boolean }
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let pipeline = sharp(source)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({
      width: PRINT_PAGE_WIDTH_PX,
      height: PRINT_PAGE_HEIGHT_PX,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .grayscale();
  if (opts.negate) pipeline = pipeline.negate();
  return pipeline
    .normalize()
    .sharpen({ sigma: 0.7, m1: 0.7, m2: 1.5 })
    .threshold(Number(process.env.PRINT_LINE_THRESHOLD || 205))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Produce the final print candidate for a strict page/cover and gate it.
 * If the direct render is inverted (white lines on black), retry once with a
 * negate() repair and re-run the complete raster analysis on the repaired
 * bytes — a repaired image is only usable when its FINAL render passes.
 */
export async function prepareStrictPrintCandidate(
  rawPng: Buffer | Uint8Array
): Promise<PrintCandidate> {
  const source = Buffer.from(rawPng);
  const direct = await renderPrintPng(source, { negate: false });
  const directStats = await analyzeRasterStats(direct);
  const directVerdicts = rasterVerdicts(directStats);
  if (directVerdicts.length === 0) {
    return {
      png: direct,
      stats: directStats,
      verdicts: [],
      repairedInversion: false,
    };
  }
  // Inversion is detected on the SOURCE (white print padding hides the dark
  // border signature on the final render).
  const sourceStats = await analyzeRasterStats(source);
  if (!isInversionRepairEligible(directVerdicts, sourceStats)) {
    return {
      png: direct,
      stats: directStats,
      verdicts: directVerdicts,
      repairedInversion: false,
    };
  }

  const repaired = await renderPrintPng(source, { negate: true });
  const repairedStats = await analyzeRasterStats(repaired);
  const repairedVerdicts = rasterVerdicts(repairedStats);
  if (repairedVerdicts.length === 0) {
    return {
      png: repaired,
      stats: repairedStats,
      verdicts: [],
      repairedInversion: true,
    };
  }
  // Repair did not produce a printable page — report the ORIGINAL defects
  // (the candidate that would have shipped), never a half-repaired state.
  return {
    png: direct,
    stats: directStats,
    verdicts: directVerdicts,
    repairedInversion: false,
  };
}

/** Downscaled JPEG data URL of the FINAL bytes for the vision QC. */
export async function printCandidateVisionDataUrl(png: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const small = await sharp(png)
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
}
