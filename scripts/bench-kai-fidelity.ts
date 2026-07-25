/**
 * Phase 1 exit criteria (logic bench): Kai + West African fidelity & style contracts.
 * Run: npx tsx scripts/bench-kai-fidelity.ts
 */
import { assertPlanFidelity, assertPoseDiversity } from "../lib/plan-fidelity";
import {
  getStyleContract,
  normalizeStyleId,
  styleImageCraftLine,
  styleKontextCue,
  styleContractSystemBlock,
} from "../services/ai/style-contracts";
import { STYLE_OPTIONS } from "../config/book-types";
import { resolveParentStyle } from "../config/parent-create";
import {
  buildBookQualitySummary,
  LINEUP_PARTIAL_THRESHOLD,
  QUALITY_COMPLETED_MIN,
} from "../lib/quality-score";
import type { StoryPlan } from "../services/ai/types";
import {
  buildColoringPagePrompt,
  buildCharacterSheetPrompt,
  buildCoverPrompt,
  buildReferenceGuidedScenePrompt,
  buildStorySystemPrompt,
} from "../services/ai/prompts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const IDEA =
  "Kai, enfant aux pouvoirs magiques, vit une aventure en Afrique de l'Ouest.";

const goodPlan: StoryPlan = {
  title: "Kai et la magie du baobab",
  summary:
    "Kai découvre ses pouvoirs magiques près d'un baobab et aide son village avec des sorts doux.",
  concept: "Magie visible, héros Kai, décors ouest-africains.",
  audienceAge: "6-8",
  moral: "La gentillesse guide la magie.",
  characters: [
    {
      id: "char_1",
      name: "Kai",
      description: "Enfant aux pouvoirs magiques",
      appearance: "garçon peau brune, magie douce",
      visualLock:
        "boy ~7, deep brown skin, short black coils, warm eyes, pagne shorts, glowing orb accessory",
      personality: "courageux",
      introducedOnPage: 1,
    },
  ],
  world: {
    setting: "West African village with baobab and market",
    palette: "warm earth",
    mood: "joyful",
  },
  pages: [
    {
      pageNumber: 1,
      title: "Éveil",
      storyText: "Kai sent sa magie s'éveiller.",
      action: "Kai raises glowing hands toward the baobab",
      camera: "low angle side view",
      shotType: "full_body",
      characterIds: ["char_1"],
      comicBeat: "establishing",
      illustrationDescription: "Kai awakens magic under baobab",
    },
    {
      pageNumber: 2,
      title: "Marché",
      storyText: "Kai aide au marché avec un sort léger.",
      action: "Kai lifts a basket with a soft magic spark",
      camera: "eye level three-quarter",
      shotType: "mid_shot",
      characterIds: ["char_1"],
      comicBeat: "action",
      illustrationDescription: "Kai at market using magic",
    },
    {
      pageNumber: 3,
      title: "Tempête",
      storyText: "Kai calme le vent.",
      action: "Kai pushes against the wind with both arms",
      camera: "high angle looking down",
      shotType: "wide",
      characterIds: ["char_1"],
      comicBeat: "obstacle",
      illustrationDescription: "Kai battles wind",
    },
    {
      pageNumber: 4,
      title: "Aide",
      storyText: "Un ami aide Kai.",
      action: "Kai climbs the baobab while a friend steadies the rope",
      camera: "side view climbing",
      shotType: "full_body",
      characterIds: ["char_1"],
      comicBeat: "help",
      illustrationDescription: "Kai climbs",
    },
  ],
};

const badPlan: StoryPlan = {
  ...goodPlan,
  title: "Aventure générique",
  summary: "Un enfant joue dans un parc européen.",
  concept: "Une journée au parc sans magie.",
  characters: [
    {
      ...goodPlan.characters[0],
      name: "Léo",
      description: "garçon quelconque",
      visualLock: "pale boy blond hair hoodie",
    },
  ],
  pages: goodPlan.pages.map((p) => ({
    ...p,
    storyText: "Un enfant sourit.",
    action: "standing and smiling",
    illustrationDescription: "park",
  })),
};

const clonePoses: StoryPlan = {
  ...goodPlan,
  pages: goodPlan.pages.map((p, i) => ({
    ...p,
    pageNumber: i + 1,
    action: "standing facing camera smiling",
    camera: "front view eye level facing camera",
    shotType: "full_body" as const,
  })),
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}:`, e instanceof Error ? e.message : e);
    failed++;
  }
}

test("fidelity OK for Kai + magie", () => {
  const r = assertPlanFidelity(IDEA, goodPlan);
  assert(r.ok, JSON.stringify(r));
});

test("fidelity FAILS when Kai/magie missing", () => {
  const r = assertPlanFidelity(IDEA, badPlan);
  assert(!r.ok, "expected fidelity failure");
});

test("pose diversity OK on varied plan", () => {
  const r = assertPoseDiversity(goodPlan);
  assert(r.ok, JSON.stringify(r));
});

test("pose diversity FAILS on clone poses", () => {
  const r = assertPoseDiversity(clonePoses);
  assert(!r.ok, "expected diversity failure");
});

test("every STYLE_OPTIONS has a hard contract", () => {
  for (const s of STYLE_OPTIONS) {
    const c = getStyleContract(s.id);
    assert(normalizeStyleId(s.id) === s.id, s.id);
    assert(c.imageCraft.length > 40, `${s.id} imageCraft`);
    assert(c.kontextCue.length > 10 && c.kontextCue.length < 200, `${s.id} kontextCue`);
    assert(c.visualLockRules.length > 20, `${s.id} visualLock`);
    assert(styleContractSystemBlock(s.id).includes("CONTRAT STYLE"), s.id);
    assert(styleImageCraftLine(s.id).includes("BLACK") || styleImageCraftLine(s.id).includes("outline") || styleImageCraftLine(s.id).length > 40, s.id);
    assert(styleKontextCue(s.id).length > 0, s.id);
  }
});

test("story system prompt embeds style contract for all styles", () => {
  for (const s of STYLE_OPTIONS) {
    const p = buildStorySystemPrompt(8, s.id, "enfants 6–8 ans");
    assert(p.includes("CONTRAT STYLE"), s.id);
    assert(p.includes("FIDÉLITÉ IDÉE"), s.id);
  }
});

test("image prompts include style craft (page/cover/sheet/kontext)", () => {
  for (const s of ["simple", "kawaii", "cartoon", "cute", "adventure", "fantasy", "west_african", "folklore_wa"]) {
    const page = buildColoringPagePrompt({
      scene: "hero leaps over a log",
      characters: "Kai deep brown skin coils pagne",
      style: s,
      world: "village courtyard",
    });
    assert(page.length > 80, `${s} page`);
    const cover = buildCoverPrompt({
      title: "Kai",
      characters: "Kai",
      style: s,
      summary: "magic adventure",
      action: "Kai leaps",
    });
    assert(cover.length > 80, `${s} cover`);
    const sheet = buildCharacterSheetPrompt({
      characters: "Kai deep brown skin",
      style: s,
      castCount: 1,
    });
    assert(sheet.length > 80, `${s} sheet`);
    const ref = buildReferenceGuidedScenePrompt({
      scene: "Kai climbs baobab CAMERA: side view",
      characters: "Kai",
      style: s,
      world: "village",
      action: "Kai climbs",
    });
    assert(ref.length < 900, `${s} kontext should stay compact: ${ref.length}`);
    assert(/identity|IDENTITY|B&W|line art/i.test(ref), `${s} kontext identity`);
  }
});

test("west_african craft forbids European-default", () => {
  const craft = styleImageCraftLine("west_african");
  assert(/European-default|deep|brown|pagne|baobab/i.test(craft), craft.slice(0, 120));
});

test("quality score gates partial on high lineup %", () => {
  const good = buildBookQualitySummary({
    pagesTotal: 8,
    pagesOk: 8,
    pageQc: Array(8).fill({}),
  });
  assert(good.score >= QUALITY_COMPLETED_MIN, `score ${good.score}`);
  assert(!good.gate_partial, "clean book should complete");

  const lineupHeavy = buildBookQualitySummary({
    pagesTotal: 8,
    pagesOk: 8,
    pageQc: Array(8).fill({ lineupDetected: true }),
  });
  assert(lineupHeavy.lineup_pct >= LINEUP_PARTIAL_THRESHOLD * 100, String(lineupHeavy.lineup_pct));
  assert(lineupHeavy.gate_partial, "lineup-heavy must gate partial");
  assert(lineupHeavy.score < QUALITY_COMPLETED_MIN, `score ${lineupHeavy.score}`);
});

test("parent style: 3-5 uses simple unless WA theme", () => {
  assert(resolveParentStyle("3-5", "magic") === "simple", "3-5 magic → simple");
  assert(resolveParentStyle("3-5", "africa") === "west_african", "3-5 africa keeps WA");
  assert(resolveParentStyle("6-8", "magic") === "fantasy", "6-8 magic → fantasy");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
