import { inflateSync } from "zlib";

/**
 * Dependency-free PNG "ink ratio" analysis to detect blank / near-blank pages.
 * Flux occasionally returns an (almost) empty white image with a valid URL;
 * without this guard those blanks would ship as "completed" coloring pages.
 *
 * Supports the common Flux output: 8-bit, non-interlaced, colorType 0/2/4/6.
 * Returns null when the PNG can't be analyzed safely (caller then treats it as OK).
 */
interface DecodedPng {
  recon: Buffer;
  width: number;
  height: number;
  bpp: number;
  channels: number;
  stride: number;
}

/** Decode a (non-interlaced, 8-bit, colorType 0/2/4/6) PNG to raw pixels. */
function decodePng(bytes: Uint8Array): DecodedPng | null {
  try {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;

    let pos = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idatParts: Uint8Array[] = [];

    const readU32 = (o: number) =>
      ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;

    while (pos + 8 <= bytes.length) {
      const len = readU32(pos);
      const type = String.fromCharCode(
        bytes[pos + 4],
        bytes[pos + 5],
        bytes[pos + 6],
        bytes[pos + 7]
      );
      const dataStart = pos + 8;
      if (type === "IHDR") {
        width = readU32(dataStart);
        height = readU32(dataStart + 4);
        bitDepth = bytes[dataStart + 8];
        colorType = bytes[dataStart + 9];
        interlace = bytes[dataStart + 12];
      } else if (type === "IDAT") {
        idatParts.push(bytes.subarray(dataStart, dataStart + len));
      } else if (type === "IEND") {
        break;
      }
      pos = dataStart + len + 4; // skip data + CRC
    }

    if (!width || !height) return null;
    if (bitDepth !== 8 || interlace !== 0) return null; // unsupported → skip check

    const channels =
      colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
    if (channels === 0) return null; // palette (3) not handled → skip

    const totalIdat = idatParts.reduce((n, p) => n + p.length, 0);
    if (totalIdat === 0) return null;
    const compressed = Buffer.concat(
      idatParts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length))
    );
    const raw = inflateSync(compressed);

    const bpp = channels; // bytes per pixel (8-bit)
    const stride = width * bpp;
    const expected = (stride + 1) * height;
    if (raw.length < expected) return null;

    const recon = Buffer.alloc(stride * height);
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      if (pb <= pc) return b;
      return c;
    };

    let inPos = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[inPos++];
      const rowStart = y * stride;
      const prevStart = (y - 1) * stride;
      for (let x = 0; x < stride; x++) {
        const rawVal = raw[inPos++];
        const a = x >= bpp ? recon[rowStart + x - bpp] : 0;
        const b = y > 0 ? recon[prevStart + x] : 0;
        const c = y > 0 && x >= bpp ? recon[prevStart + x - bpp] : 0;
        let val: number;
        switch (filter) {
          case 1:
            val = rawVal + a;
            break;
          case 2:
            val = rawVal + b;
            break;
          case 3:
            val = rawVal + ((a + b) >> 1);
            break;
          case 4:
            val = rawVal + paeth(a, b, c);
            break;
          default:
            val = rawVal;
        }
        recon[rowStart + x] = val & 0xff;
      }
    }

    return { recon, width, height, bpp, channels, stride };
  } catch {
    return null;
  }
}

/** Luminance + alpha at a pixel from decoded PNG data. */
function lumAlphaAt(d: DecodedPng, x: number, y: number): { lum: number; alpha: number } {
  const idx = y * d.stride + x * d.bpp;
  const { recon, channels } = d;
  if (channels === 1) return { lum: recon[idx], alpha: 255 };
  if (channels === 2) return { lum: recon[idx], alpha: recon[idx + 1] };
  const r = recon[idx];
  const g = recon[idx + 1];
  const bl = recon[idx + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
  return { lum, alpha: channels === 4 ? recon[idx + 3] : 255 };
}

export function analyzePngInk(
  bytes: Uint8Array
): { inkRatio: number; width: number; height: number } | null {
  try {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;

    let pos = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idatParts: Uint8Array[] = [];

    const readU32 = (o: number) =>
      ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;

    while (pos + 8 <= bytes.length) {
      const len = readU32(pos);
      const type = String.fromCharCode(
        bytes[pos + 4],
        bytes[pos + 5],
        bytes[pos + 6],
        bytes[pos + 7]
      );
      const dataStart = pos + 8;
      if (type === "IHDR") {
        width = readU32(dataStart);
        height = readU32(dataStart + 4);
        bitDepth = bytes[dataStart + 8];
        colorType = bytes[dataStart + 9];
        interlace = bytes[dataStart + 12];
      } else if (type === "IDAT") {
        idatParts.push(bytes.subarray(dataStart, dataStart + len));
      } else if (type === "IEND") {
        break;
      }
      pos = dataStart + len + 4; // skip data + CRC
    }

    if (!width || !height) return null;
    if (bitDepth !== 8 || interlace !== 0) return null; // unsupported → skip check

    const channels =
      colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
    if (channels === 0) return null; // palette (3) not handled → skip

    const totalIdat = idatParts.reduce((n, p) => n + p.length, 0);
    if (totalIdat === 0) return null;
    const compressed = Buffer.concat(
      idatParts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length))
    );
    const raw = inflateSync(compressed);

    const bpp = channels; // bytes per pixel (8-bit)
    const stride = width * bpp;
    const expected = (stride + 1) * height;
    if (raw.length < expected) return null;

    const recon = Buffer.alloc(stride * height);
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      if (pb <= pc) return b;
      return c;
    };

    let inPos = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[inPos++];
      const rowStart = y * stride;
      const prevStart = (y - 1) * stride;
      for (let x = 0; x < stride; x++) {
        const rawVal = raw[inPos++];
        const a = x >= bpp ? recon[rowStart + x - bpp] : 0;
        const b = y > 0 ? recon[prevStart + x] : 0;
        const c = y > 0 && x >= bpp ? recon[prevStart + x - bpp] : 0;
        let val: number;
        switch (filter) {
          case 1:
            val = rawVal + a;
            break;
          case 2:
            val = rawVal + b;
            break;
          case 3:
            val = rawVal + ((a + b) >> 1);
            break;
          case 4:
            val = rawVal + paeth(a, b, c);
            break;
          default:
            val = rawVal;
        }
        recon[rowStart + x] = val & 0xff;
      }
    }

    // Sample pixels (step to keep it fast on big images) and count "ink".
    const step = Math.max(1, Math.floor((width * height) / 200_000));
    let sampled = 0;
    let ink = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = y * stride + x * bpp;
        let lum: number;
        let alpha = 255;
        if (channels === 1) {
          lum = recon[idx];
        } else if (channels === 2) {
          lum = recon[idx];
          alpha = recon[idx + 1];
        } else {
          const r = recon[idx];
          const g = recon[idx + 1];
          const bl = recon[idx + 2];
          lum = 0.299 * r + 0.587 * g + 0.114 * bl;
          if (channels === 4) alpha = recon[idx + 3];
        }
        sampled++;
        // Strong, printable ink: reasonably dark AND opaque.
        if (alpha > 32 && lum < 128) ink++;
      }
    }
    if (sampled === 0) return null;
    return { inkRatio: ink / sampled, width, height };
  } catch {
    return null;
  }
}

/**
 * A page is "blank/too faint" when its strong-ink coverage is negligible.
 * Real coloring line art is well above this; truly empty Flux outputs are ~0.
 */
export function isBlankOrTooFaint(bytes: Uint8Array): boolean {
  const res = analyzePngInk(bytes);
  if (!res) return false; // can't analyze → don't reject
  return res.inkRatio < 0.004;
}

/**
 * Split a page into an outer "background/margin band" and an inner center box and
 * measure strong-ink coverage in each. A coloring page with a real environment has
 * meaningful ink in the outer band (props/nature/architecture reaching the edges);
 * a "floating character on an empty white void" has almost no outer ink while the
 * center still carries the subject.
 */
export function analyzePngRegions(
  bytes: Uint8Array
): { inkRatio: number; borderInkRatio: number; centerInkRatio: number } | null {
  const d = decodePng(bytes);
  if (!d) return null;
  const { width, height } = d;

  // Outer band = 20% margin on each side; center = the inner 60% box.
  const mx = Math.floor(width * 0.2);
  const my = Math.floor(height * 0.2);
  const step = Math.max(1, Math.floor((width * height) / 200_000));

  let sampled = 0;
  let ink = 0;
  let borderSampled = 0;
  let borderInk = 0;
  let centerSampled = 0;
  let centerInk = 0;

  for (let y = 0; y < height; y += step) {
    const inYBorder = y < my || y >= height - my;
    for (let x = 0; x < width; x += step) {
      const { lum, alpha } = lumAlphaAt(d, x, y);
      const isInk = alpha > 32 && lum < 128;
      sampled++;
      if (isInk) ink++;
      const inBorder = inYBorder || x < mx || x >= width - mx;
      if (inBorder) {
        borderSampled++;
        if (isInk) borderInk++;
      } else {
        centerSampled++;
        if (isInk) centerInk++;
      }
    }
  }
  if (sampled === 0 || borderSampled === 0 || centerSampled === 0) return null;
  return {
    inkRatio: ink / sampled,
    borderInkRatio: borderInk / borderSampled,
    centerInkRatio: centerInk / centerSampled,
  };
}

/**
 * True when the page looks like a subject floating on an empty background: the
 * center carries real ink but the outer margin/background band is nearly empty.
 * Tuned to catch "character-only" coloring pages with almost nothing to color.
 */
export function hasPoorEnvironment(bytes: Uint8Array): boolean {
  const res = analyzePngRegions(bytes);
  if (!res) return false; // can't analyze → don't reject
  if (res.inkRatio < 0.004) return false; // blank page handled by the blank guard
  // Character floating on near-white void (few grass tufts still count as poor).
  if (res.centerInkRatio > 0.015 && res.borderInkRatio < 0.008) return true;
  // Very low total ink with most of it in the center = portrait on empty page.
  if (res.inkRatio < 0.035 && res.centerInkRatio > res.borderInkRatio * 3) return true;
  return false;
}

/**
 * Measure the fraction of the page covered by saturated COLOR pixels.
 * Real coloring pages are pure black line art on white paper → near-zero chroma.
 * Flux sometimes returns a fully COLORED cartoon (like a cover) for an interior page;
 * those pages are unusable as printable line art and must be re-rolled.
 */
export function analyzePngColorRatio(bytes: Uint8Array): number | null {
  const d = decodePng(bytes);
  if (!d) return null;
  // Grayscale sources (colorType 0/4) carry no color information at all.
  if (d.channels < 3) return 0;

  const { width, height } = d;
  const step = Math.max(1, Math.floor((width * height) / 200_000));
  let sampled = 0;
  let colored = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = y * d.stride + x * d.bpp;
      const r = d.recon[idx];
      const g = d.recon[idx + 1];
      const b = d.recon[idx + 2];
      const alpha = d.channels === 4 ? d.recon[idx + 3] : 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      sampled++;
      // "Colored content": opaque, not near-white, not near-black, clearly saturated.
      if (alpha > 32 && lum < 245 && lum > 12 && chroma > 48) colored++;
    }
  }
  if (sampled === 0) return null;
  return colored / sampled;
}

/**
 * True when an interior page came back as a colored illustration instead of clean
 * black-and-white line art. Triggers a re-roll (never a hard fail). Threshold is
 * conservative: faint anti-aliasing fringes on black lines stay well below it.
 */
export function isColored(bytes: Uint8Array): boolean {
  const ratio = analyzePngColorRatio(bytes);
  if (ratio === null) return false; // can't analyze → don't reject
  return ratio > 0.02;
}
