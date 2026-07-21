/**
 * PHASE-2 end-to-end smoke test: hero cast portrait → plausibility gate → reference-guided
 * (Kontext) cover + pages, mirroring services/generation-orchestrator.ts. With
 * FAL_REF_ENDPOINT set, FalImageProvider auto-routes cover/pages through Kontext using
 * the validated hero as identity reference.
 *
 * Run:  npx tsx --env-file=.env.local scripts/gentest7.ts
 *       REUSE_PLAN=1 … reuses public/_gentest7/_plan.json (skips Groq — handy when
 *       iterating on image prompts or when the Groq daily token quota is exhausted).
 * Outputs: public/_gentest7/{hero,cover,page1..N}.png + _plan.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getImageProvider, getTextProvider } from "@/services/ai";
import type { StoryPlan } from "@/services/ai/types";
import {
  formatCharacterLock,
  formatPageCharacterLock,
  normalizeStoryPlan,
} from "@/services/ai/character-bible";
import { mapWithConcurrency } from "@/lib/async";
import {
  analyzePngColorRatio,
  analyzePngInk,
  hasPoorEnvironment,
  isBlankOrTooFaint,
  isColored,
} from "@/lib/image-quality";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";

const OUT = join(process.cwd(), "public", "_gentest7");
const IDEA = "Aïcha et son renard au marché du village";
const STYLE = "west_african";
const PAGES = 6;

async function download(url: string, file: string) {
  const raw = new Uint8Array((await fetch(url).then((r) => r.arrayBuffer())) as ArrayBuffer);
  writeFileSync(join(OUT, file), raw);
  return raw;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const text = getTextProvider();
  const image = getImageProvider();

  const planFile = join(OUT, "_plan.json");
  let plan: StoryPlan;
  if (process.env.REUSE_PLAN === "1" && existsSync(planFile)) {
    console.log("→ reusing cached story plan (_plan.json)…");
    plan = normalizeStoryPlan(JSON.parse(readFileSync(planFile, "utf8")) as StoryPlan, PAGES);
  } else {
    console.log("→ research + story plan…");
    const research = await text.buildResearchBrief(IDEA);
    plan = normalizeStoryPlan(
      await text.generateStoryPlan(IDEA, PAGES, STYLE, research, "enfants 4–8 ans"),
      PAGES
    );
    writeFileSync(planFile, JSON.stringify(plan, null, 2));
  }
  const fullBible = formatCharacterLock(plan.characters);
  const worldSetting = [plan.world?.setting, plan.world?.mood].filter(Boolean).join(" — ");
  console.log(`   title="${plan.title}" chars=${plan.characters.length}`);

  // ---- Hero cast portrait (COLORED), plausibility-gated (mirrors orchestrator) ----
  // Gate: non-blank AND colored. A B&W hero = degenerate drift (the "two boys" bug).
  console.log("→ hero cast portrait (validate non-blank + colored)…");
  let heroUrl: string | null = null;
  for (let attempt = 1; attempt <= 3 && !heroUrl; attempt++) {
    const sheet = await image.generateImage({
      prompt: "character model sheet",
      style: STYLE,
      characterBible: fullBible,
      worldSetting,
      isCharacterSheet: true,
    });
    const raw = await download(sheet.url, "hero.png");
    const png =
      detectImageFormat(raw) === "png" ? raw : new Uint8Array(await toPngBuffer(raw));
    if (isBlankOrTooFaint(png) || !isColored(png)) {
      console.warn(`   hero attempt ${attempt} implausible (blank or not colored); retrying`);
      continue;
    }
    heroUrl = sheet.url;
    console.log(
      `   hero accepted (attempt ${attempt}) fmt=${detectImageFormat(raw)} color=${analyzePngColorRatio(png)?.toFixed(4)} ink=${analyzePngInk(png)?.inkRatio?.toFixed(4)}`
    );
  }
  if (!heroUrl) console.warn("   !! no plausible hero — pages will fall back to text-only Ideogram");

  console.log("→ cover (reference-guided)…");
  const cover = await image.generateImage({
    prompt: `${plan.title}. ${plan.summary}`,
    style: STYLE,
    characterBible: fullBible,
    worldSetting,
    isCover: true,
    referenceImageUrl: heroUrl || undefined,
  });
  const coverBytes = await download(cover.url, "cover.png");
  console.log(`   cover ok fmt=${detectImageFormat(coverBytes)} (${coverBytes.length} bytes)`);

  console.log("→ pages (reference-guided)…");
  const results = await mapWithConcurrency(plan.pages, 3, async (p) => {
    const pageLock = formatPageCharacterLock(plan, p);
    const scenePrompt = [
      p.illustrationDescription || p.storyText || plan.summary,
      p.shotType ? `Shot: ${p.shotType}.` : "",
      p.comicBeat ? `Beat: ${p.comicBeat}.` : "",
      "Mandatory rich colorable environment matching the caption. No empty white void. Simplified mitten hands. Max 2 characters. Full figures inside frame with margins.",
    ]
      .filter(Boolean)
      .join(" ");
    try {
      const img = await image.generateImage({
        prompt: scenePrompt,
        style: STYLE,
        characterBible: pageLock || fullBible,
        negativePrompt: p.negativePrompt || undefined,
        worldSetting,
        isColoringPage: true,
        referenceImageUrl: heroUrl || undefined,
        shotType: p.shotType,
        comicBeat: p.comicBeat,
      });
      const bytes = await download(img.url, `page${p.pageNumber}.png`);
      const fmt = detectImageFormat(bytes);
      const s = {
        page: p.pageNumber,
        fmt,
        bytes: bytes.length,
        blank: isBlankOrTooFaint(bytes),
        colored: isColored(bytes),
        colorRatio: analyzePngColorRatio(bytes),
        inkRatio: analyzePngInk(bytes)?.inkRatio ?? null,
        poorEnv: hasPoorEnvironment(bytes),
      };
      console.log(
        `   page${p.pageNumber} ok fmt=${fmt} blank=${s.blank} colored=${s.colored} poorEnv=${s.poorEnv} ink=${s.inkRatio?.toFixed(4)}`
      );
      return s;
    } catch (e) {
      console.error(`   page${p.pageNumber} FAILED:`, e instanceof Error ? e.message : e);
      return { page: p.pageNumber, error: true };
    }
  });

  const ok = results.filter((r) => !("error" in r)).length;
  console.log(`\n✓ done in ${Math.round((Date.now() - t0) / 1000)}s → ${OUT}`);
  console.log(`   delivered ${ok}/${plan.pages.length} pages; hero=${heroUrl ? "yes" : "FALLBACK"}`);
  console.log("JSON_SUMMARY=" + JSON.stringify(results));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
