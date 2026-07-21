import sharp from "sharp";

export type ImageFormat = "png" | "jpeg" | "webp" | "gif" | "unknown";

/**
 * Detect a raster image format from its magic bytes. Fal image models return
 * different formats (flux → png, ideogram/recraft → webp); the PDF pipeline
 * (pdf-lib) only embeds PNG/JPG, and our quality guards only decode PNG — so we
 * need to know the format to decide whether a conversion is required.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  )
    return "webp";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "gif";
  return "unknown";
}

/**
 * Convert any raster bytes to an 8-bit PNG, flattened onto a white background so
 * transparent regions become white paper (coloring pages) and the ink-ratio guards
 * read strong black lines correctly.
 */
export async function toPngBuffer(bytes: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(bytes))
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}
