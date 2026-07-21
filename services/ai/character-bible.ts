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
  const pages = (plan.pages || []).slice(0, pageCount).map((p, i) => {
    let characterIds = (p.characterIds || [])
      .map((id) => id.replace(/\s+/g, "_").toLowerCase())
      .filter((id) => validIds.has(id));
    if (characterIds.length === 0) {
      characterIds = characters.slice(0, Math.min(2, characters.length)).map((c) => c.id);
    }
    characterIds = characterIds.slice(0, 2);

    const beat =
      p.comicBeat ||
      inferComicBeat(i, Math.max(plan.pages?.length || pageCount, pageCount));

    return {
      ...p,
      pageNumber: p.pageNumber || i + 1,
      characterIds,
      comicBeat: beat,
      shotType: p.shotType || (beat === "establishing" ? "wide" : "full_body"),
      storyText: clampStoryText(p.storyText),
      illustrationDescription: ensureRichEnvironment(
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
