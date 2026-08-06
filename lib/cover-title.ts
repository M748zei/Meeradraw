import sharp from "sharp";

/**
 * Server-side cover title overlay (benchmark winner, audit T6): the Kontext
 * reference cover nails IDENTITY but cannot letter text; Ideogram letters text
 * but loses species identity without a reference. So the reference cover is
 * generated text-free with a calm top band, and the title is composited here —
 * bold white letters with a black outline (colorable, always legible).
 */
export async function overlayCoverTitle(
  pngBytes: Buffer | Uint8Array,
  title: string
): Promise<Buffer> {
  const img = sharp(Buffer.from(pngBytes));
  const meta = await img.metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;
  const clean = title.trim().slice(0, 60);
  // Long titles on one line came out tiny and hard to read — wrap to up to two
  // balanced lines so the lettering stays big and picture-book friendly.
  const lines = wrapTitle(clean);
  const longest = Math.max(...lines.map((l) => l.length), 6);
  const fontSize = Math.min(
    Math.floor(height * (lines.length > 1 ? 0.065 : 0.08)),
    Math.floor((width * 0.92) / (longest * 0.62))
  );
  const bandHeight = Math.floor(height * 0.18);
  const lineHeight = Math.floor(fontSize * 1.15);
  const startY = Math.floor(bandHeight / 2 - ((lines.length - 1) * lineHeight) / 2);
  const strokeW = Math.max(3, Math.floor(fontSize / 14));
  const textLines = lines
    .map(
      (l, i) =>
        `<text x="50%" y="${startY + i * lineHeight}" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial Rounded MT Bold, Arial, Helvetica, DejaVu Sans, sans-serif"
    font-size="${fontSize}" font-weight="800" fill="white" stroke="black"
    stroke-width="${strokeW}" paint-order="stroke">${escapeXml(l)}</text>`
    )
    .join("\n  ");
  const svg = `<svg width="${width}" height="${bandHeight}" xmlns="http://www.w3.org/2000/svg">
  ${textLines}
</svg>`;
  return img
    .composite([
      { input: Buffer.from(svg), top: Math.floor(height * 0.02), left: 0 },
    ])
    .png()
    .toBuffer();
}

/** Split a long title into up to two balanced lines at a word boundary. */
function wrapTitle(title: string): string[] {
  if (title.length <= 24) return [title];
  const words = title.split(/\s+/);
  let best = [title];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [a, b];
    }
  }
  return best;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
