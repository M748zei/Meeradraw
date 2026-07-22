import type { StoryPlan, StoryCharacter } from "@/services/ai/types";

/** Max named cast for short/medium coloring books (kids readability). */
export function maxCastForPageCount(pageCount: number): number {
  if (pageCount <= 8) return 3;
  if (pageCount <= 12) return 4;
  return 5;
}

/** Stable English lock string injected identically into every image prompt. */
export function formatCharacterLock(characters: StoryCharacter[]): string {
  return characters
    .map((c) => {
      const lock =
        c.visualLock?.trim() ||
        [
          c.ageBand,
          c.skinTone,
          c.hair,
          c.face,
          c.body,
          c.outfit,
          c.signatureAccessory,
          c.proportions,
        ]
          .filter(Boolean)
          .join("; ") ||
        c.appearance;
      return `[${c.id || c.name}] ${c.name} — ALWAYS DRAW EXACTLY: ${lock}`;
    })
    .join(" | ");
}

export function charactersForPage(
  plan: StoryPlan,
  page: StoryPlan["pages"][number]
): StoryCharacter[] {
  const byId = new Map(plan.characters.map((c) => [c.id || c.name, c]));
  const byName = new Map(
    plan.characters.map((c) => [c.name.toLowerCase(), c])
  );
  const ids = page.characterIds?.length
    ? page.characterIds
    : plan.characters.slice(0, 2).map((c) => c.id || c.name);

  const resolved: StoryCharacter[] = [];
  for (const raw of ids) {
    const hit =
      byId.get(raw) ||
      byName.get(String(raw).toLowerCase()) ||
      plan.characters.find((c) => c.name === raw);
    if (hit && !resolved.some((r) => r.name === hit.name)) {
      resolved.push(hit);
    }
  }
  return resolved.slice(0, 2);
}

export function formatPageCharacterLock(
  plan: StoryPlan,
  page: StoryPlan["pages"][number]
): string {
  const chars = charactersForPage(plan, page);
  return formatCharacterLock(chars.length ? chars : plan.characters.slice(0, 2));
}

/**
 * Normalize LLM story plans: ids, cast size, page cast lists, visual locks.
 */
export function normalizeStoryPlan(plan: StoryPlan, pageCount: number): StoryPlan {
  const maxCast = maxCastForPageCount(pageCount);
  let characters = (plan.characters || []).slice(0, maxCast).map((c, i) => {
    const id = (c.id || `char_${i + 1}`).replace(/\s+/g, "_").toLowerCase();
    const visualLock = sanitizeAnimalLock(
      c.visualLock?.trim() ||
        buildVisualLockFromParts(c) ||
        c.appearance ||
        "distinct child-friendly silhouette, consistent costume"
    );
    return {
      ...c,
      id,
      visualLock,
      appearance: c.appearance || visualLock,
    };
  });

  if (characters.length === 0) {
    characters = [
      {
        id: "char_1",
        name: "Héros",
        description: "Protagoniste principal",
        appearance:
          "small child hero, short curly hair, simple tunic, bare feet, big curious eyes",
        visualLock:
          "small child ~5 years, warm brown skin, short tight curls, round friendly face, big almond eyes, short sturdy legs, plain short tunic with V-neck, bare feet, tiny braided bracelet on left wrist; same face and outfit every page",
        personality: "brave and kind",
        ageBand: "child ~5",
        skinTone: "warm brown",
        hair: "short tight curls",
        face: "round friendly face, big almond eyes",
        body: "small sturdy child proportions",
        outfit: "plain short tunic V-neck",
        signatureAccessory: "tiny braided bracelet left wrist",
        proportions: "large head, short limbs, child proportions",
      },
    ];
  }

  const validIds = new Set(characters.map((c) => c.id));

  // First appearance map (audit fix T1.3): trust the plan's introducedOnPage when
  // sane, else derive it from the first page whose characterIds mention the id.
  // A character must NEVER be drawn before their introduction page.
  const rawPages = (plan.pages || []).slice(0, pageCount);
  const firstSeen = new Map<string, number>();
  rawPages.forEach((p, i) => {
    const n = p.pageNumber || i + 1;
    for (const raw of p.characterIds || []) {
      const id = String(raw).replace(/\s+/g, "_").toLowerCase();
      if (validIds.has(id) && !firstSeen.has(id)) firstSeen.set(id, n);
    }
  });
  characters = characters.map((c) => {
    const declared = Number(c.introducedOnPage);
    const derived = firstSeen.get(c.id) ?? 1;
    const intro =
      Number.isFinite(declared) && declared >= 1
        ? Math.min(Math.floor(declared), pageCount)
        : derived;
    return { ...c, introducedOnPage: intro };
  });
  const introOf = new Map(characters.map((c) => [c.id, c.introducedOnPage ?? 1]));

  const pages = rawPages.map((p, i) => {
    const pageNumber = p.pageNumber || i + 1;
    let characterIds = (p.characterIds || [])
      .map((id) => String(id).replace(/\s+/g, "_").toLowerCase())
      .filter((id) => validIds.has(id))
      // Intro-order enforcement: no character on a page before they are met.
      .filter((id) => (introOf.get(id) ?? 1) <= pageNumber);
    if (characterIds.length === 0) {
      characterIds = characters
        .filter((c) => (c.introducedOnPage ?? 1) <= pageNumber)
        .slice(0, Math.min(2, characters.length))
        .map((c) => c.id);
      if (characterIds.length === 0) {
        characterIds = characters.slice(0, 1).map((c) => c.id);
      }
    }
    characterIds = characterIds.slice(0, 2);

    const beat =
      p.comicBeat ||
      inferComicBeat(i, Math.max(plan.pages?.length || pageCount, pageCount));

    // Structured composition fields (audit fix T1.1) — keep poses only for
    // characters actually on the page.
    const poses: Record<string, string> = {};
    if (p.characterPoses && typeof p.characterPoses === "object") {
      for (const [rawId, pose] of Object.entries(p.characterPoses)) {
        const id = String(rawId).replace(/\s+/g, "_").toLowerCase();
        if (characterIds.includes(id) && typeof pose === "string" && pose.trim()) {
          poses[id] = pose.trim();
        }
      }
    }

    return {
      ...p,
      pageNumber,
      characterIds,
      comicBeat: beat,
      shotType: p.shotType || (beat === "establishing" ? "wide" : "full_body"),
      action: (p.action || "").trim() || undefined,
      characterPoses: Object.keys(poses).length ? poses : undefined,
      camera: (p.camera || "").trim() || undefined,
      pageSetting: (p.pageSetting || "").trim() || undefined,
      focalPoint: (p.focalPoint || "").trim() || undefined,
      storyText: clampStoryText(p.storyText),
      // The canned-environment injector predates the structured storyboard and
      // can hijack the world (verified: a generic "indoor kitchen with tiled
      // wall" turned an African village page into a modern European kitchen).
      // When the model provided its own pageSetting, trust it — only pages
      // WITHOUT a structured setting get the legacy environment inference.
      illustrationDescription: (p.pageSetting || "").trim()
        ? `${ensureSceneMentionsCast(p.illustrationDescription, characters, characterIds)} No empty white void. No floating characters. Simplified mitten-style kid hands or hands holding objects. Max 2 characters.`
        : ensureRichEnvironment(
            ensureSceneMentionsCast(
              p.illustrationDescription,
              characters,
              characterIds
            ),
            p.storyText,
            plan.world?.setting
          ),
      negativePrompt: (p.negativePrompt || "").trim() || DEFAULT_PAGE_NEGATIVE,
    };
  });

  return {
    ...plan,
    concept: (plan.concept || plan.summary || "").trim() || undefined,
    characters,
    pages,
  };
}

/**
 * Definitive per-page scene prompt assembled SERVER-SIDE from the structured
 * storyboard fields (audit fix T1.2): the page's OWN action/poses/camera/setting
 * dominate — never the global synopsis. Falls back to illustrationDescription
 * when the model omitted the structured fields.
 */
export function buildPageScene(
  plan: StoryPlan,
  page: StoryPlan["pages"][number]
): string {
  const chars = charactersForPage(plan, page);
  const nameOf = (id: string) => chars.find((c) => c.id === id)?.name || id;

  const poseLines = Object.entries(page.characterPoses || {})
    .map(([id, pose]) => `${nameOf(id)}: ${pose}`)
    .join("; ");

  const parts = [
    page.action ? `ACTION (must be clearly visible): ${page.action}.` : "",
    poseLines ? `POSES: ${poseLines}.` : "",
    page.camera ? `CAMERA: ${page.camera}.` : "",
    page.pageSetting ? `THIS PAGE'S SETTING: ${page.pageSetting}.` : "",
    page.focalPoint ? `FOCAL POINT: ${page.focalPoint}.` : "",
  ].filter(Boolean);

  // Structured fields present → they lead; the prose description adds texture.
  if (parts.length >= 2) {
    return [parts.join(" "), page.illustrationDescription].filter(Boolean).join(" ");
  }
  return page.illustrationDescription || page.storyText || plan.summary;
}

/**
 * COMPACT scene for the Kontext reference path — structured fields only, no
 * prose, no boilerplate (long prompts make Kontext copy the reference lineup).
 */
export function buildCompactScene(
  plan: StoryPlan,
  page: StoryPlan["pages"][number]
): string {
  const chars = charactersForPage(plan, page);
  const nameOf = (id: string) => chars.find((c) => c.id === id)?.name || id;
  const poseLines = Object.entries(page.characterPoses || {})
    .map(([id, pose]) => `${nameOf(id)}: ${pose}`)
    .join("; ");
  const parts = [
    page.action || "",
    poseLines ? `POSES: ${poseLines}.` : "",
    page.camera ? `CAMERA: ${page.camera}.` : "",
    page.pageSetting ? `SETTING: ${page.pageSetting}.` : "",
  ].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return (page.illustrationDescription || page.storyText || plan.summary).slice(0, 300);
}

/** Cover cast (audit fix T1.3): only characters known from page 1 — no spoilers. */
export function coverCharacters(plan: StoryPlan): StoryCharacter[] {
  const fromStart = plan.characters.filter((c) => (c.introducedOnPage ?? 1) <= 1);
  return fromStart.length ? fromStart : plan.characters;
}

const ANIMAL_WORDS: Array<[RegExp, string]> = [
  [/\b(fox|renard)\b/i, "fox"],
  [/\b(wolf|loup)\b/i, "wolf"],
  [/\b(dog|chien)\b/i, "dog"],
  [/\b(cat|chat)\b/i, "cat"],
  [/\b(rabbit|lapin|hare)\b/i, "rabbit"],
  [/\b(lion)\b/i, "lion"],
  [/\b(tiger|tigre)\b/i, "tiger"],
  [/\b(bear|ours)\b/i, "bear"],
  [/\b(monkey|singe)\b/i, "monkey"],
  [/\b(elephant|éléphant)\b/i, "elephant"],
  [/\b(bird|oiseau)\b/i, "bird"],
  [/\b(turtle|tortue)\b/i, "turtle"],
  [/\b(frog|grenouille)\b/i, "frog"],
  [/\b(mouse|souris)\b/i, "mouse"],
  [/\b(goat|chèvre)\b/i, "goat"],
  [/\b(sheep|mouton)\b/i, "sheep"],
  [/\b(donkey|âne)\b/i, "donkey"],
  [/\b(hyena|hyène)\b/i, "hyena"],
  [/\b(lizard|lézard|gecko)\b/i, "lizard"],
  [/\b(snake|serpent)\b/i, "snake"],
  [/\b(fish|poisson)\b/i, "fish"],
  [/\b(zebra|zèbre)\b/i, "zebra"],
  [/\b(giraffe|girafe)\b/i, "giraffe"],
  [/\b(hippo|hippopotame)\b/i, "hippo"],
  [/\b(crocodile)\b/i, "crocodile"],
];

/**
 * Species/kind of a character for the vision cast QC (a turtle must be a TURTLE).
 * Derived from the locked descriptors; defaults to "human".
 */
export function characterKind(c: StoryCharacter): string {
  const hay = `${c.visualLock || ""} ${c.appearance || ""} ${c.description || ""}`;
  for (const [re, kind] of ANIMAL_WORDS) {
    if (re.test(hay)) return kind;
  }
  return "human";
}

/** Vision-QC expected cast for a set of characters. */
export function expectedCastFor(
  characters: StoryCharacter[]
): Array<{ name: string; kind: string }> {
  return characters.map((c) => ({ name: c.name, kind: characterKind(c) }));
}

/**
 * Pick the 2–4 setting-bible elements most relevant to THIS scene (audit T3.2):
 * word-overlap scoring against the scene text, topped up with the bible's
 * leading (most iconic) elements.
 */
export function settingElementsForScene(
  elements: string[] | undefined,
  sceneText: string,
  max = 3
): string[] {
  const pool = (elements || []).map((e) => e.trim()).filter(Boolean);
  if (!pool.length) return [];
  const hay = sceneText.toLowerCase();
  const scored = pool.map((el, i) => {
    const words = el.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const hits = words.filter((w) => hay.includes(w)).length;
    return { el, i, hits };
  });
  const relevant = scored
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .map((s) => s.el);
  const picked = [...relevant];
  for (const s of scored) {
    if (picked.length >= max) break;
    if (!picked.includes(s.el)) picked.push(s.el);
  }
  return picked.slice(0, max);
}

/** Reasonable per-page negative used when the model omits one. */
const DEFAULT_PAGE_NEGATIVE =
  "color, grayscale, shading, gradients, filled black areas, photorealism, blurry, text, watermark, extra fingers, fused fingers, floating head, cropped limbs, extra people, duplicate characters, inconsistent character design, empty white void";

/**
 * Animal characters must stay REAL quadrupeds. The LLM occasionally writes bipedal
 * phrasing into an animal's visualLock ("standing on hind legs with front paws
 * together", "wearing a collar") and every image then faithfully renders an upright,
 * anthropomorphic animal. Strip/repair those phrases; humans are left untouched.
 */
function sanitizeAnimalLock(lock: string): string {
  const isAnimal =
    /\b(fox|renard|wolf|loup|dog|chien|cat|chat|rabbit|lapin|hare|lion|tiger|tigre|bear|ours|monkey|singe|elephant|éléphant|bird|oiseau|turtle|tortue|frog|grenouille|mouse|souris|goat|chèvre|sheep|mouton|donkey|âne|hyena|hyène)\b/i.test(
      lock
    );
  if (!isAnimal) return lock;
  return lock
    .replace(
      /,?\s*(standing|walking|sitting)\s+(on|upright on)?\s*(its |his |her )?(hind|two|back)\s+legs(\s+with[^,.;]*)?/gi,
      ", standing on all four paws"
    )
    .replace(/,?\s*(standing|walking)\s+upright[^,.;]*/gi, ", on all four paws")
    .replace(/,?\s*wearing\s+(a\s+)?(collar|clothes|shirt|dress|backpack|vest|hat)[^,.;]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildVisualLockFromParts(c: StoryCharacter): string {
  const parts = [
    c.ageBand,
    c.skinTone,
    c.hair,
    c.face,
    c.body,
    c.outfit,
    c.signatureAccessory,
    c.proportions,
  ].filter(Boolean);
  return parts.join("; ");
}

function inferComicBeat(
  index: number,
  total: number
): NonNullable<StoryPlan["pages"][number]["comicBeat"]> {
  const t = Math.max(total, 1);
  const r = index / (t - 1 || 1);
  if (index === 0) return "establishing";
  if (r < 0.35) return "action";
  if (r < 0.55) return "obstacle";
  if (r < 0.75) return "help";
  if (index >= t - 2) return "resolution";
  return "emotion";
}

function clampStoryText(text: string | undefined): string {
  const t = (text || "").trim();
  if (!t) return "Une belle aventure continue.";
  // Keep captions short for kids coloring books (1–3 sentences).
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return sentences.slice(0, 3).join(" ").slice(0, 280);
}

function ensureSceneMentionsCast(
  scene: string | undefined,
  characters: StoryCharacter[],
  characterIds: string[]
): string {
  const base = (scene || "Simple children's coloring book scene").trim();
  const names = characterIds
    .map((id) => characters.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(" and ");
  if (!names) return base;
  if (new RegExp(names.split(" and ")[0] || "", "i").test(base)) return base;
  return `${base}. Characters in scene: ${names} only — no extra people.`;
}

/**
 * Ensure every page prompt demands a colorable environment (not empty void).
 * Infers props from caption/setting keywords when the LLM omitted them.
 */
function ensureRichEnvironment(
  scene: string,
  storyText: string | undefined,
  worldSetting: string | undefined
): string {
  // Derive the environment from THIS page's scene FIRST, then fall back to the story
  // world setting. The world setting is authoritative for the book's theme (e.g. a
  // market stays a market) and must NOT be overridden by incidental words in the
  // caption (a passing "fleur" or "pluie" used to hijack a market into a garden/storm).
  const sceneHay = `${scene} ${storyText || ""}`.toLowerCase();
  const worldHay = (worldSetting || "").toLowerCase();

  const envFor = (hay: string): string => {
    if (!hay.trim()) return "";
    // Market first: it is the most commonly mis-detected setting.
    if (/marché|market|étal|etal|stall|bazaar|souk|boutique|shop|marchand|vendor/i.test(hay)) {
      return "ENVIRONMENT: busy open-air market with rows of stalls, hanging fabrics, baskets of produce, awnings, pots and goods, simple buildings behind — large colorable shapes.";
    }
    if (/cuisine|kitchen|cook|fourneau|casserole/i.test(hay)) {
      return "ENVIRONMENT: indoor kitchen with stove, hanging pots, tiled wall, wooden table, window — large colorable shapes.";
    }
    if (/tempête|storm|orage|thunder|pluie battante/i.test(hay)) {
      return "ENVIRONMENT: outdoor storm with big rain clouds, slanted rain lines, wind-bent trees, house silhouette, puddles — large colorable shapes.";
    }
    if (/jardin|garden|verger|orchard|parc\b|park\b/i.test(hay)) {
      return "ENVIRONMENT: garden with trees, flower beds, fence, winding path, bushes — large colorable shapes.";
    }
    if (/rue|street|ville|city|town|village/i.test(hay)) {
      return "ENVIRONMENT: village/town street with simple houses, doors, windows, a path and a few trees — large colorable shapes.";
    }
    if (/chambre|bedroom|lit\b|bed\b|maison|house|home/i.test(hay)) {
      return "ENVIRONMENT: cozy room or house exterior with door, windows, furniture or porch — large colorable shapes.";
    }
    if (/plage|beach|mer\b|sea|ocean|rivière|river|fleuve|lac|lake/i.test(hay)) {
      return "ENVIRONMENT: water setting (river/beach) with water, banks, a few plants or boats and a simple sky — large colorable shapes.";
    }
    if (/savane|savanna|baobab|désert|desert|dune/i.test(hay)) {
      return "ENVIRONMENT: open savanna/desert with baobab trees, tall grass, dunes and a wide simple sky — large colorable shapes.";
    }
    if (/forêt|forest|jungle|bois\b/i.test(hay)) {
      return "ENVIRONMENT: forest with big trees, leaves, bushes and a simple path — large colorable shapes.";
    }
    return "";
  };

  // Prefer the world setting so the book's theme is respected on every page; only use
  // the per-page scene inference when the world setting itself gives no clear place.
  let envHint = envFor(worldHay) || envFor(sceneHay);
  if (!envHint) {
    envHint = worldSetting?.trim()
      ? `ENVIRONMENT matching the story setting "${worldSetting.trim()}": include mid-ground props and a simple readable background with large colorable closed shapes (never an empty white void, never only tiny grass tufts).`
      : "ENVIRONMENT: rich colorable setting with mid-ground props and simple background (never empty white void, never only tiny grass tufts).";
  }

  const bans =
    "No empty white void. No floating characters. Simplified mitten-style kid hands or hands holding objects. Max 2 characters.";

  // If the model already wrote its own ENVIRONMENT: block, keep it (Fix B: don't stack
  // conflicting canned environments on top of the model's own scene-derived one).
  if (scene.toLowerCase().includes("environment:")) {
    return `${scene} ${bans}`.trim();
  }
  return `${scene} ${envHint} ${bans}`.trim();
}
