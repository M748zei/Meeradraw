import type { StoryPlan, StoryCharacter } from "@/services/ai/types";

/** Max named cast for short/medium coloring books (kids readability). */
export function maxCastForPageCount(pageCount: number): number {
  if (pageCount <= 8) return 3;
  if (pageCount <= 12) return 4;
  return 5;
}

/** Parent books: tiny cast — hero child (+ optional one friend). */
export function maxCastForParentBook(): number {
  return 2;
}

function stripAdultWording(lock: string): string {
  return lock
    .replace(/\b(adult|woman|man|mother|father|lady|gentleman|mature)\b/gi, "child")
    .replace(/\b(tall slender adult|grown[- ]?up)\b/gi, "small child");
}

/**
 * Force the named child as sole hero with an explicit CHILD visual lock.
 * Prevents "adult market woman" drift on parent books.
 */
export function enforceParentChildHero(
  plan: StoryPlan,
  opts: {
    childName: string;
    childGender?: string | null;
    audience?: string | null;
  }
): StoryPlan {
  const name = opts.childName.trim();
  if (!name) return plan;

  const ageYears = /3\s*[–-]\s*5|3-5/.test(opts.audience || "")
    ? "about 4 years old"
    : /9\s*[–-]\s*12|9-12/.test(opts.audience || "")
      ? "about 10 years old"
      : "about 7 years old";
  const genderEn =
    opts.childGender === "girl"
      ? "young girl"
      : opts.childGender === "boy"
        ? "young boy"
        : "young child";
  const genderFr =
    opts.childGender === "girl"
      ? "petite fille"
      : opts.childGender === "boy"
        ? "petit garçon"
        : "enfant";

  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  let characters = [...(plan.characters || [])];
  let heroIdx = characters.findIndex((c) => norm(c.name) === norm(name));
  if (heroIdx < 0) heroIdx = 0;
  if (characters.length === 0) {
    characters = [
      {
        id: "char_1",
        name,
        description: `${genderFr} héros de l'histoire`,
        appearance: `${genderFr} ${ageYears}`,
        visualLock: "",
        personality: "gentil, joyeux, aimé",
      },
    ];
    heroIdx = 0;
  }

  const prev = characters[heroIdx];
  const baseLock = stripAdultWording(
    prev.visualLock || prev.appearance || "friendly child, consistent outfit"
  );
  const childLock = [
    `${genderEn} ${ageYears}`,
    "REAL CHILD proportions (large head, short limbs) — NEVER an adult woman or man",
    "friendly eyes WITH clear dark pupils and catchlights, soft rounded cheeks, gentle smile",
    baseLock,
    "identical face hair outfit every page",
  ].join(", ");

  const hero: StoryCharacter = {
    ...prev,
    id: "char_1",
    name,
    description: prev.description || `${genderFr}, héros principal, enfant`,
    appearance: `${genderFr} ${ageYears}, ${prev.appearance || ""}`.trim(),
    visualLock: childLock,
    ageBand: `child ${ageYears}`,
    personality: prev.personality || "gentil, courageux, aimé de tous",
    proportions: "large head, short limbs, small child body",
    face:
      prev.face ||
      "round child face, big friendly eyes with pupils, soft smile",
    body: "small child body, not adult",
    introducedOnPage: 1,
  };

  // Keep at most one other character — and force them child-like too (no adults).
  const others = characters
    .filter((_, i) => i !== heroIdx)
    .slice(0, 1)
    .map((c, i) => {
      const lock = stripAdultWording(c.visualLock || c.appearance || "");
      const isAdultish = /adult|woman|man|mother|father|elderly|grand/i.test(
        `${c.visualLock} ${c.ageBand} ${c.description}`
      );
      if (isAdultish) {
        return {
          ...c,
          id: `char_${i + 2}`,
          ageBand: "child friend ~same age",
          visualLock: `${lock}, child friend same age as hero, NOT an adult`,
          body: "small child",
          proportions: "child proportions",
        };
      }
      return { ...c, id: `char_${i + 2}` };
    });

  const nextChars = [hero, ...others].slice(0, maxCastForParentBook());
  const idMap = new Map<string, string>();
  characters.forEach((c, i) => {
    if (i === heroIdx) idMap.set(c.id, "char_1");
  });
  others.forEach((c, i) => {
    const old = characters.filter((_, idx) => idx !== heroIdx)[i];
    if (old) idMap.set(old.id, c.id);
  });

  const pages = (plan.pages || []).map((p) => {
    let ids = (p.characterIds || [])
      .map((id) => idMap.get(id) || id)
      .filter((id) => nextChars.some((c) => c.id === id));
    if (!ids.includes("char_1")) ids = ["char_1", ...ids];
    ids = [...new Set(ids)].slice(0, 2);
    // Rewrite poses keys
    const poses: Record<string, string> = {};
    if (p.characterPoses) {
      for (const [k, v] of Object.entries(p.characterPoses)) {
        const nk = idMap.get(k) || k;
        if (ids.includes(nk)) poses[nk] = v;
      }
    }
    return { ...p, characterIds: ids, characterPoses: poses };
  });

  return { ...plan, characters: nextChars, pages };
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

  // Pad to exact pageCount so parent books never ship short of the paid page count.
  // Invent DISTINCT continuing scenes — never copy-paste "(suite)" / same caption.
  const heroId = characters[0]?.id || "char_1";
  const heroName = characters[0]?.name || "Le héros";
  const worldSetting = (plan.world?.setting || "le monde de l'histoire").trim();
  const padTemplates = buildPadSceneTemplates(heroName, worldSetting);
  let padIdx = 0;
  while (pages.length < pageCount) {
    const n = pages.length + 1;
    const tpl = padTemplates[padIdx % padTemplates.length];
    padIdx++;
    const isLast = n >= pageCount;
    pages.push({
      pageNumber: n,
      title: isLast ? tpl.resolutionTitle : tpl.title,
      storyText: isLast ? tpl.resolutionStory : tpl.storyText,
      action: isLast ? tpl.resolutionAction : tpl.action,
      characterIds: [heroId],
      characterPoses: {
        [heroId]: isLast
          ? "joyful full-body pose celebrating with open arms"
          : tpl.pose,
      },
      comicBeat: isLast ? "resolution" : tpl.comicBeat,
      shotType: isLast ? "wide" : tpl.shotType,
      camera: tpl.camera,
      pageSetting: tpl.pageSetting,
      focalPoint: heroName,
      illustrationDescription: isLast
        ? `${heroName} celebrates the happy ending in ${tpl.pageSetting}. Wide shot, rich colorable environment filling the page.`
        : tpl.illustrationDescription,
      negativePrompt: DEFAULT_PAGE_NEGATIVE,
    });
  }

  return {
    ...plan,
    concept: (plan.concept || plan.summary || "").trim() || undefined,
    characters,
    pages: pages.slice(0, pageCount),
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
  "color, grayscale, shading, gradients, filled black areas, photorealism, blurry, text, watermark, extra fingers, fused fingers, floating head, cropped limbs, extra people, duplicate characters, inconsistent character design, empty white void, blank white eyes, hollow eyes, pupil-less eyes, elongated skull, deformed head, misshapen cranium";

/**
 * Distinct French scene templates used when the LLM returns fewer pages than
 * paid pageCount. Each pad page must advance the story with a NEW action/setting —
 * never append "(suite)" to a copied title/caption.
 */
function buildPadSceneTemplates(
  heroName: string,
  worldSetting: string
): Array<{
  title: string;
  storyText: string;
  action: string;
  pose: string;
  comicBeat: NonNullable<StoryPlan["pages"][number]["comicBeat"]>;
  shotType: NonNullable<StoryPlan["pages"][number]["shotType"]>;
  camera: string;
  pageSetting: string;
  illustrationDescription: string;
  resolutionTitle: string;
  resolutionStory: string;
  resolutionAction: string;
}> {
  const w = worldSetting || "le monde de l'histoire";
  return [
    {
      title: `Le chemin secret`,
      storyText: `${heroName} découvre un sentier caché bordé d'arbres et de fleurs.`,
      action: `${heroName} walking along a hidden path, pointing at a discovery ahead`,
      pose: "walking mid-stride, one arm pointing forward",
      comicBeat: "action",
      shotType: "wide",
      camera: "three-quarter view child eye level",
      pageSetting: `sentier bordé d'arbres dans ${w}`,
      illustrationDescription: `${heroName} walks a winding path with trees, rocks, flowers and sky filling the page. Wide shot, rich environment.`,
      resolutionTitle: `La belle fin`,
      resolutionStory: `${heroName} rentre heureux, le cœur plein de souvenirs.`,
      resolutionAction: `${heroName} celebrating happily with arms open in a warm final scene`,
    },
    {
      title: `L'aide inattendue`,
      storyText: `${heroName} aide un petit animal coincé près d'un ruisseau.`,
      action: `${heroName} kneeling by a stream carefully helping a small animal`,
      pose: "kneeling full-body, gentle hands near water",
      comicBeat: "help",
      shotType: "full_body",
      camera: "side view child eye level",
      pageSetting: `ruisseau et berges dans ${w}`,
      illustrationDescription: `${heroName} kneels by a stream with water, stones, plants and sky. Full body in a busy colorable scene.`,
      resolutionTitle: `Retour au calme`,
      resolutionStory: `${heroName} sourit, l'aventure se termine en douceur.`,
      resolutionAction: `${heroName} smiling and waving goodbye in a peaceful closing scene`,
    },
    {
      title: `Le petit marché`,
      storyText: `${heroName} explore un marché coloré plein de paniers et d'étoffes.`,
      action: `${heroName} browsing market stalls, reaching for a basket`,
      pose: "standing reaching toward a stall basket",
      comicBeat: "action",
      shotType: "wide",
      camera: "slight high angle wide",
      pageSetting: `marché avec étals dans ${w}`,
      illustrationDescription: `${heroName} at a lively market with stalls, baskets, cloths, ground and sky filling the frame.`,
      resolutionTitle: `Fête du retour`,
      resolutionStory: `${heroName} célèbre avec joie la fin de l'aventure.`,
      resolutionAction: `${heroName} dancing happily among friends in a festive final scene`,
    },
    {
      title: `Sous le grand arbre`,
      storyText: `${heroName} se repose à l'ombre d'un grand arbre et observe les oiseaux.`,
      action: `${heroName} sitting under a large tree looking up at birds in the branches`,
      pose: "sitting cross-legged looking upward",
      comicBeat: "emotion",
      shotType: "full_body",
      camera: "low angle looking slightly up",
      pageSetting: `grand arbre et clairière dans ${w}`,
      illustrationDescription: `${heroName} under a huge tree with canopy, roots, grass, birds and sky. Rich colorable nature scene.`,
      resolutionTitle: `Ciel étoilé`,
      resolutionStory: `${heroName} regarde le ciel, heureux d'avoir réussi.`,
      resolutionAction: `${heroName} looking at a gentle starry sky with a warm smile`,
    },
    {
      title: `Le pont de planches`,
      storyText: `${heroName} traverse un petit pont de planches au-dessus de l'eau.`,
      action: `${heroName} carefully crossing a wooden plank bridge mid-step`,
      pose: "mid-step on a bridge, arms balancing",
      comicBeat: "obstacle",
      shotType: "wide",
      camera: "side view dynamic",
      pageSetting: `pont de planches et rivière dans ${w}`,
      illustrationDescription: `${heroName} crossing a plank bridge with river, banks, trees and sky filling the page edges.`,
      resolutionTitle: `Maison douce`,
      resolutionStory: `${heroName} retrouve un lieu doux et se sent en sécurité.`,
      resolutionAction: `${heroName} arriving home with a joyful wave`,
    },
    {
      title: `La chasse au trésor`,
      storyText: `${heroName} cherche un trésor caché derrière des rochers fleuris.`,
      action: `${heroName} climbing over flowered rocks searching for a hidden treasure`,
      pose: "climbing over rocks, curious lean forward",
      comicBeat: "action",
      shotType: "full_body",
      camera: "three-quarter view",
      pageSetting: `rochers fleuris dans ${w}`,
      illustrationDescription: `${heroName} among flowered rocks, plants, path and sky — busy wide coloring scene.`,
      resolutionTitle: `Victoire joyeuse`,
      resolutionStory: `${heroName} a trouvé ce qu'il fallait et rit de bonheur.`,
      resolutionAction: `${heroName} holding a small found treasure with a big smile`,
    },
    {
      title: `Danse sous la pluie légère`,
      storyText: `${heroName} danse sous une pluie douce près des cases du village.`,
      action: `${heroName} dancing joyfully in light rain near village huts`,
      pose: "dancing with arms raised, one foot lifted",
      comicBeat: "emotion",
      shotType: "wide",
      camera: "front three-quarter wide",
      pageSetting: `cour de village sous la pluie dans ${w}`,
      illustrationDescription: `${heroName} dancing in light rain with huts, ground puddles, trees and cloudy sky filling the page.`,
      resolutionTitle: `Câlin final`,
      resolutionStory: `${heroName} partage un moment tendre pour clore l'histoire.`,
      resolutionAction: `${heroName} in a warm gentle closing embrace pose with soft scenery`,
    },
    {
      title: `Les lanternes du soir`,
      storyText: `${heroName} allume des lanternes pour guider les amis le long du chemin.`,
      action: `${heroName} hanging paper lanterns along an evening path`,
      pose: "reaching up to hang a lantern",
      comicBeat: "help",
      shotType: "full_body",
      camera: "side view child eye level",
      pageSetting: `chemin du soir avec lanternes dans ${w}`,
      illustrationDescription: `${heroName} hanging lanterns along a path with houses, trees and soft evening sky filling the frame.`,
      resolutionTitle: `Bonne nuit heureuse`,
      resolutionStory: `${heroName} s'endort le cœur léger après l'aventure.`,
      resolutionAction: `${heroName} waving goodnight under a soft evening sky`,
    },
  ];
}

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
