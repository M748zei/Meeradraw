import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** A4 portrait (pts). Print-safe kids coloring book layout. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const SAFE = 36;

export class PDFService {
  async buildBookPdf(input: {
    title: string;
    subtitle?: string | null;
    coverUrl?: string | null;
    pages: Array<{
      pageNumber: number;
      title?: string | null;
      storyText?: string | null;
      illustrationUrl?: string | null;
    }>;
  }): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // —— Cover ——
    const cover = pdf.addPage([PAGE_W, PAGE_H]);
    cover.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: PAGE_H,
      color: rgb(0.97, 0.95, 0.9),
    });

    const coverImgMaxW = PAGE_W - MARGIN * 2;
    const coverImgMaxH = PAGE_H * 0.52;
    let coverImgBottom = PAGE_H * 0.42;

    if (input.coverUrl) {
      const embedded = await embedRemoteImage(pdf, input.coverUrl);
      if (embedded) {
        const { image } = embedded;
        const scale = Math.min(
          coverImgMaxW / image.width,
          coverImgMaxH / image.height
        );
        const w = image.width * scale;
        const h = image.height * scale;
        const x = (PAGE_W - w) / 2;
        const y = PAGE_H - MARGIN - 24 - h;
        cover.drawImage(image, { x, y, width: w, height: h });
        coverImgBottom = y - 28;
      }
    }

    const titleLines = wrapText(input.title.slice(0, 72), 28);
    let titleY = Math.min(coverImgBottom, 160);
    for (const line of titleLines.slice(0, 3)) {
      const tw = bold.widthOfTextAtSize(line, 22);
      cover.drawText(line, {
        x: Math.max(MARGIN, (PAGE_W - tw) / 2),
        y: titleY,
        size: 22,
        font: bold,
        color: rgb(0, 0, 0),
      });
      titleY -= 28;
    }
    if (input.subtitle) {
      const sub = input.subtitle.slice(0, 90);
      const sw = font.widthOfTextAtSize(sub, 12);
      cover.drawText(sub, {
        x: Math.max(MARGIN, (PAGE_W - sw) / 2),
        y: titleY - 4,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
    }

    // —— Interior pages ——
    for (const page of input.pages) {
      const p = pdf.addPage([PAGE_W, PAGE_H]);

      // Soft page frame (print margin guide, not a heavy card)
      p.drawRectangle({
        x: SAFE,
        y: SAFE,
        width: PAGE_W - SAFE * 2,
        height: PAGE_H - SAFE * 2,
        borderColor: rgb(0.88, 0.9, 0.92),
        borderWidth: 0.5,
      });

      p.drawText(`Page ${page.pageNumber}`, {
        x: MARGIN,
        y: PAGE_H - MARGIN,
        size: 9,
        font,
        color: rgb(0.55, 0.58, 0.62),
      });

      let cursorY = PAGE_H - MARGIN - 22;
      if (page.title) {
        p.drawText(page.title.slice(0, 70), {
          x: MARGIN,
          y: cursorY,
          size: 14,
          font: bold,
          color: rgb(0, 0, 0),
          maxWidth: PAGE_W - MARGIN * 2,
        });
        cursorY -= 28;
      } else {
        cursorY -= 8;
      }

      // Caption band reserved at bottom; image fills the middle without clipping
      const captionReserve = 110;
      const imgTop = cursorY;
      const imgBottom = MARGIN + captionReserve;
      const maxW = PAGE_W - MARGIN * 2;
      const maxH = Math.max(200, imgTop - imgBottom);

      if (page.illustrationUrl) {
        const embedded = await embedRemoteImage(pdf, page.illustrationUrl);
        if (embedded) {
          const { image } = embedded;
          const scale = Math.min(maxW / image.width, maxH / image.height);
          const w = image.width * scale;
          const h = image.height * scale;
          p.drawImage(image, {
            x: (PAGE_W - w) / 2,
            y: imgBottom + (maxH - h) / 2,
            width: w,
            height: h,
          });
        } else {
          p.drawRectangle({
            x: MARGIN,
            y: imgBottom,
            width: maxW,
            height: maxH,
            borderColor: rgb(0.8, 0.85, 0.9),
            borderWidth: 1,
          });
        }
      }

      if (page.storyText) {
        const lines = wrapText(page.storyText, 62);
        let y = MARGIN + captionReserve - 28;
        for (const line of lines.slice(0, 5)) {
          p.drawText(line, {
            x: MARGIN,
            y,
            size: 11,
            font,
            color: rgb(0, 0, 0),
            maxWidth: PAGE_W - MARGIN * 2,
          });
          y -= 16;
        }
      }
    }

    return pdf.save();
  }
}

async function embedRemoteImage(
  pdf: PDFDocument,
  url: string
): Promise<{ image: Awaited<ReturnType<PDFDocument["embedPng"]>> } | null> {
  try {
    const imgBytes = await fetch(url).then((r) => r.arrayBuffer());
    const lower = url.toLowerCase();
    const isPng =
      lower.includes(".png") ||
      lower.includes("png?") ||
      lower.includes("image/png");
    const image = isPng
      ? await pdf.embedPng(imgBytes)
      : await pdf.embedJpg(imgBytes);
    return { image };
  } catch {
    // Try the other format if sniff failed
    try {
      const imgBytes = await fetch(url).then((r) => r.arrayBuffer());
      try {
        return { image: await pdf.embedPng(imgBytes) };
      } catch {
        return { image: await pdf.embedJpg(imgBytes) };
      }
    } catch {
      return null;
    }
  }
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
