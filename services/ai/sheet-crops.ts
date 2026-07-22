import sharp from "sharp";
import { StorageService } from "@/services/storage-service";
import type { StoryCharacter } from "@/services/ai/types";

/**
 * Per-character crops of the hero model sheet (benchmark winner for SOLO pages,
 * audit T2.3): with the FULL lineup as Kontext reference, absent characters
 * leak into solo pages and recreate the "standing in a row" syndrome. A crop of
 * just the page's character keeps identity AND removes the leak.
 *
 * Assumption (validated in the benchmark): the sheet draws characters side by
 * side in the order they were listed in the prompt → equal vertical slices.
 * A bad slice is caught downstream by the vision cast QC.
 *
 * Fail-open: returns {} on any failure — pages then use the full sheet.
 */
export async function buildSheetCrops(
  sheetUrl: string,
  characters: StoryCharacter[],
  universeId: string,
  storage: StorageService
): Promise<Record<string, { url: string; path: string }>> {
  if (characters.length < 2) return {}; // solo cast: full sheet is already solo
  try {
    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`fetch sheet ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height) throw new Error("no sheet dimensions");

    const slice = Math.floor(width / characters.length);
    const crops: Record<string, { url: string; path: string }> = {};
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      const png = await sharp(buf)
        .extract({
          left: i * slice,
          top: 0,
          width: i === characters.length - 1 ? width - i * slice : slice,
          height,
        })
        .png()
        .toBuffer();
      const path = `universes/${universeId}/model_sheet_${c.id}.png`;
      const url = await storage.uploadBytes(path, png, "image/png");
      crops[c.id] = { url, path };
    }
    return crops;
  } catch (err) {
    console.warn("sheet crops unavailable (fail-open, full sheet used)", err);
    return {};
  }
}
