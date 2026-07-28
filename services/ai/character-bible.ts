import type { StoryPlan, StoryCharacter } from "@/services/ai/types";
import { inferNarrativeThemeKey } from "@/lib/plan-fidelity";

/** Max named cast for short/medium coloring books (kids readability). */
export function maxCastForPageCount(pageCount: number): number {
  if (pageCount <= 8) return 3;
  if (pageCount <= 12) return 4;
  return 5;
}

/** Parent books: tiny cast — hero child (+ optional one friend). */
export function maxCastForParentBook(): number {
  // Hero + up to three essential story characters (for example the two
  // parents and the adopted dog). The previous caps of 2 then 3 silently
  // deleted named characters from the parent's story.
  return 4;
}

export type NormalizeStoryPlanOpts = {
  parentMode?: boolean;
  narrativeLock?: string;
  themeKey?: string;
  childGender?: string | null;
};

function stripAdultWording(lock: string): string {
  return lock
    .replace(/\b(adult|woman|man|mother|father|lady|gentleman|mature)\b/gi, "child")
    .replace(/\b(tall slender adult|grown[- ]?up)\b/gi, "small child");
}

function stripConflictingGender(lock: string, gender?: string | null): string {
  if (gender === "girl") {
    return lock
      .replace(/\b(young\s+)?boys?\b/gi, "young girl")
      .replace(/\bgarçons?\b/gi, "fille")
      .replace(/\blittle boy\b/gi, "little girl")
      .replace(/\bson\b/gi, "daughter");
  }
  if (gender === "boy") {
    return lock
      .replace(/\b(young\s+)?girls?\b/gi, "young boy")
      .replace(/\bfilles?\b/gi, "garçon")
      .replace(/\blittle girl\b/gi, "little boy")
      .replace(/\bdaughter\b/gi, "son");
  }
  return lock;
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
  const baseLock = stripConflictingGender(
    stripAdultWording(
      prev.visualLock || prev.appearance || "friendly child, consistent outfit"
    ),
    opts.childGender
  );
  const genderNeg =
    opts.childGender === "girl"
      ? "NOT a boy, NOT a male child"
      : opts.childGender === "boy"
        ? "NOT a girl, NOT a female child"
        : "NOT an adult";
  const childLock = [
    `${genderEn} ${ageYears}`,
    genderNeg,
    "REAL CHILD proportions (large head, short limbs) — NEVER an adult woman or man",
    "friendly eyes WITH clear dark pupils and catchlights, soft rounded cheeks, gentle smile",
    baseLock,
    `${genderEn}, identical face hair outfit every page`,
  ].join(", ");

  const hero: StoryCharacter = {
    ...prev,
    id: "char_1",
    name,
    description: prev.description || `${genderFr}, héros principal, enfant`,
    appearance: `${genderFr} ${ageYears}, ${stripConflictingGender(prev.appearance || "", opts.childGender)}`.trim(),
    visualLock: childLock,
    ageBand: `child ${ageYears}`,
    personality: prev.personality || "gentil, courageux, aimé de tous",
    proportions: "large head, short limbs, small child body",
    face:
      prev.face ||
      `round ${genderEn} face, big friendly eyes with pupils, soft smile`,
    body: "small child body, not adult",
    introducedOnPage: 1,
  };

  // Keep up to three DISTINCT story characters beside the hero (family cast:
  // two parents + the adopted animal). Preserve their real age and species:
  // an adult stays an adult and an animal stays that exact animal.
  const others = characters
    .filter((_, i) => i !== heroIdx)
    .slice(0, 3)
    .map((c, i) => {
      const lock = c.visualLock || c.appearance || "";
      const looksLikeHero =
        norm(c.name) === norm(name) ||
        /same (face|outfit|hair)|identical|twin|clone/i.test(
          `${c.visualLock} ${c.description}`
        );
      if (looksLikeHero) return null;
      return {
        ...c,
        id: `char_${i + 2}`,
        name: c.name === name ? `Compagnon ${i + 1}` : c.name,
        visualLock: `${lock}, EXACT same age/species/face/body/outfit on every appearance, DISTINCT from hero ${name}, never a twin or clone`,
      };
    })
    .filter(Boolean) as StoryCharacter[];

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
    // Keep the full mandatory cast the page asked for (up to the book cast
    // cap) — family scenes need the child AND both parents AND the pet.
    ids = [...new Set(ids)].slice(0, maxCastForParentBook());
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

/**
 * Last-resort rewrite when the LLM substituted a travel/market plot for the
 * parent's story. Forces title/summary/world + scrubbed page captions onto the
 * locked narrative theme (princess/village/etc.).
 */
/**
 * Strip technical framing from the composed parent idea so it can be shown to
 * a child. The raw source looks like:
 *   "khadija est une petite fille. HISTOIRE DU PARENT (intrigue obligatoire,
 *    ne pas remplacer) : khadija et ses parents adoptent un chien"
 * Prod gen 4f8980ea shipped that string VERBATIM as page 6's caption.
 */
export function sanitizeParentNarrative(source: string): string {
  let text = String(source || "").trim();
  // Drop the technical narrative-lock label wherever it appears.
  text = text.replace(
    /HISTOIRE DU PARENT\s*\([^)]*\)\s*:?\s*/gi,
    ""
  );
  // Drop the leading gender-lock sentence ("X est une petite fille."…).
  text = text.replace(
    /^[^.!?]{1,60}\best\s+(une petite fille|un petit gar[cç]on|un enfant)\s*\.\s*/i,
    ""
  );
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // Natural child sentence: capital first letter, terminal punctuation.
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?…]$/.test(text)) text += ".";
  return text;
}

/**
 * Explicit portrait subject line derived from the character itself. The
 * generic "cartoon character portrait" prompt loses against the child-styled
 * style contract: prod gen 29daf67a drew the MOTHER as a group of children
 * twice and the strict QC (rightly) killed the paid run. The subject must
 * state species / adulthood / solo-framing in the prompt itself.
 */
export function portraitSubjectLine(c: StoryCharacter): string {
  const kind = (c.kind || "human").trim().toLowerCase();
  if (kind && kind !== "human") {
    return `EXACTLY ONE ${kind} alone in frame — REAL ${kind} anatomy of its species, never humanoid, no humans, no children in the image`;
  }
  const text = `${c.visualLock || ""} ${c.ageBand || ""} ${c.description || ""} ${c.name || ""}`.toLowerCase();
  const isAdult = /adult|mother|father|maman|papa|m[eè]re|p[eè]re|grown[- ]?up/.test(text);
  if (isAdult) {
    const female = /woman|mother|maman|m[eè]re|female|lady/.test(text);
    const male = /\bman\b|father|papa|p[eè]re|\bmale\b/.test(text);
    const noun = female && !male ? "adult woman" : male && !female ? "adult man" : "adult person";
    return `EXACTLY ONE ${noun} alone in frame — full ADULT height, adult face and adult body proportions, NOT a child, no children anywhere in the image`;
  }
  return `EXACTLY ONE child alone in frame — no other characters in the image`;
}

/**
 * Deterministic completion of the mandatory family cast. When the parent's
 * story demands the parents and/or a pet but the plan's named cast lacks them
 * (prod gen 10de421f: OpenAI failover planned Khadija alone, so the viability
 * gate killed all 4 attempts), synthesize the missing characters instead of
 * failing the paid run — and put them in every scene, per the family-cast
 * contract (child + parents + pet).
 */
export function ensureMandatoryFamilyCast(
  plan: StoryPlan,
  sourceStory: string
): StoryPlan {
  const story = String(sourceStory || "").toLowerCase();
  const characters = [...(plan.characters || [])];
  const hero = characters[0];
  if (!hero) return plan;
  const heroName = hero.name;

  const needsParents = /\bparents?\b/.test(story);
  const animalWord = ANIMAL_WORDS.find(([re]) => re.test(story));

  const describes = (c: StoryCharacter) =>
    `${c.visualLock || ""} ${c.description || ""} ${c.name || ""}`;
  const isHuman = (c: StoryCharacter) => (c.kind || "").toLowerCase() === "human";
  const nonHero = characters.slice(1);
  const adults = nonHero.filter(
    (c) =>
      isHuman(c) &&
      /adult|parent|maman|papa|mère|père|mother|father|woman|man/i.test(describes(c))
  );
  const animals = characters.filter(
    (c) => String(c.kind || "").trim() && !isHuman(c)
  );

  const additions: StoryCharacter[] = [];
  if (needsParents && adults.length < 2) {
    const hasMom = adults.some((c) =>
      /maman|mère|mother|woman|female/i.test(describes(c))
    );
    const hasDad = adults.some((c) =>
      /papa|père|father|\bman\b|male/i.test(describes(c))
    );
    if (!hasMom) {
      additions.push({
        id: "char_maman",
        name: `Maman de ${heroName}`,
        description: `La maman de ${heroName}, douce et attentionnée`,
        appearance: `maman adulte souriante de ${heroName}`,
        visualLock: `adult woman, ${heroName}'s mother, kind warm smile, adult proportions, simple elegant outfit, identical face hair outfit every page, DISTINCT from hero ${heroName}`,
        personality: "douce, protectrice, joyeuse",
        kind: "human",
        ageBand: "adult",
        introducedOnPage: 1,
      });
    }
    if (!hasDad) {
      additions.push({
        id: "char_papa",
        name: `Papa de ${heroName}`,
        description: `Le papa de ${heroName}, bienveillant et solide`,
        appearance: `papa adulte souriant de ${heroName}`,
        visualLock: `adult man, ${heroName}'s father, kind gentle smile, adult proportions, simple casual outfit, identical face hair outfit every page, DISTINCT from hero ${heroName}`,
        personality: "bienveillant, calme, encourageant",
        kind: "human",
        ageBand: "adult",
        introducedOnPage: 1,
      });
    }
  }
  if (animalWord && animals.length === 0) {
    const species = animalWord[1];
    additions.push({
      id: "char_animal",
      name: "Compagnon",
      description: `Le ${species === "dog" ? "chien" : species} adopté par la famille de ${heroName}`,
      appearance: `adorable ${species} de la famille`,
      visualLock: `cute friendly young ${species}, REAL ${species} anatomy (never humanoid), same fur markings every page, DISTINCT from every human character`,
      personality: "joueur, affectueux, fidèle",
      kind: species,
      introducedOnPage: 1,
    });
  }

  if (!additions.length) return plan;

  const cap = maxCastForParentBook();
  // Mandatory cast first so the cap can never evict it: hero, existing
  // adults, existing animals, synthesized family, then the rest.
  const mandatory = [hero, ...adults, ...animals.filter((c) => c !== hero), ...additions];
  const rest = characters.filter((c) => !mandatory.includes(c));
  const seen = new Set<string>();
  const nextChars = [...mandatory, ...rest]
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .slice(0, cap);
  const keptIds = new Set(nextChars.map((c) => c.id));

  const pages = (plan.pages || []).map((p) => {
    const ids = [
      hero.id,
      ...nextChars.slice(1).map((c) => c.id),
      ...(p.characterIds || []),
    ].filter((id, i, arr) => keptIds.has(id) && arr.indexOf(id) === i);
    return { ...p, characterIds: ids.slice(0, cap) };
  });

  return { ...plan, characters: nextChars, pages };
}

export function lockPlanToParentNarrative(
  plan: StoryPlan,
  opts: {
    sourceNarrative: string;
    childName: string;
    childGender?: string | null;
    audience?: string | null;
    pageCount: number;
  }
): StoryPlan {
  const name = opts.childName.trim() || plan.characters[0]?.name || "Héros";
  const themeKey = inferNarrativeThemeKey(opts.sourceNarrative);
  const source = opts.sourceNarrative.trim();
  // Child-facing copy NEVER carries the technical framing — only the clean story.
  const cleanSource = sanitizeParentNarrative(source);
  const shortSource = (cleanSource || source).slice(0, 220);

  let next = enforceParentChildHero(plan, {
    childName: name,
    childGender: opts.childGender,
    audience: opts.audience,
  });
  // The last-resort rewrite must stay viable: never hand the viability gate
  // a plan whose mandatory family cast the rewrite itself dropped.
  next = ensureMandatoryFamilyCast(next, source);

  const worldSetting =
    themeKey === "princess"
      ? `soft royal village world for little princess ${name} — courtyard, gentle crown, village homes (NOT a market road-trip)`
      : themeKey === "magic"
        ? `gentle magical world for ${name} with visible soft magic`
        : themeKey === "village"
          ? `joyful village world for ${name}`
          : next.world?.setting || `world of ${name}'s story`;

  next = {
    ...next,
    title: next.title?.trim() || `L'aventure de ${name}`,
    summary: shortSource || next.summary,
    concept: `Fidèle à l'histoire du parent : ${shortSource}`,
    world: {
      setting: worldSetting,
      palette: next.world?.palette || "warm joyful",
      mood: next.world?.mood || "tender and brave",
    },
  };

  const subRe =
    /voyage|road\s*trip|travers(e|er)|across the country|a travers le pays|à travers le pays|parents|dusty road|chemin poussi|journ[eé]e au march|market day|d[eé]part.*march|petit march[eé]/i;
  const sourceAllowsSub = subRe.test(source);

  next = {
    ...next,
    pages: (next.pages || []).map((p, i, pages) => {
      if (i === pages.length - 1) {
        return {
          ...p,
          title: "La belle fin de l'histoire",
          // Natural sentence for the child — the parent's own story words,
          // never the technical prompt framing.
          storyText: (cleanSource || `${name} a réussi sa belle aventure !`).slice(
            0,
            280
          ),
          action: `${name} completes the exact parent story: ${shortSource}`.slice(
            0,
            320
          ),
          focalPoint: name,
          // The finale gathers the page's full mandatory cast (family ending),
          // never the hero alone.
          characterIds: p.characterIds?.length ? p.characterIds : ["char_1"],
          comicBeat: "resolution",
          shotType: "wide",
        };
      }
      const hay = `${p.title} ${p.storyText} ${p.action} ${p.pageSetting}`;
      if (!sourceAllowsSub && subRe.test(hay)) {
        return rewritePageToTheme(p, name, themeKey, i, (next.pages || []).length);
      }
      // Ensure hero name in caption
      if (p.storyText && !new RegExp(name, "i").test(p.storyText)) {
        return {
          ...p,
          storyText: `${name} : ${p.storyText}`.slice(0, 280),
        };
      }
      return p;
    }),
  };

  return normalizeStoryPlan(next, opts.pageCount, {
    parentMode: true,
    narrativeLock: source,
    themeKey,
    childGender: opts.childGender,
  });
}

function rewritePageToTheme(
  p: StoryPlan["pages"][number],
  heroName: string,
  themeKey: string,
  index: number,
  total: number
): StoryPlan["pages"][number] {
  const tpl = buildPadSceneTemplates(heroName, themeKey, themeKey)[
    index % 8
  ];
  const isLast = index >= total - 1;
  return {
    ...p,
    title: isLast ? tpl.resolutionTitle : tpl.title,
    storyText: isLast ? tpl.resolutionStory : tpl.storyText,
    action: isLast ? tpl.resolutionAction : tpl.action,
    pageSetting: tpl.pageSetting,
    illustrationDescription: isLast
      ? `${heroName} celebrates in ${tpl.pageSetting}. Wide shot, rich colorable environment.`
      : tpl.illustrationDescription,
    characterIds: ["char_1"],
    characterPoses: {
      char_1: isLast
        ? "joyful full-body pose celebrating with open arms"
        : tpl.pose,
    },
    comicBeat: isLast ? "resolution" : tpl.comicBeat,
    shotType: isLast ? "wide" : tpl.shotType,
    camera: tpl.camera,
    focalPoint: heroName,
  };
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
  // Up to 4 named characters: family stories (child + two parents + pet)
  // MUST keep their full mandatory cast — the old cap of 2 silently erased
  // the parents from "Khadidja et ses parents adoptent un chien".
  return resolved.slice(0, 4);
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
export function normalizeStoryPlan(
  plan: StoryPlan,
  pageCount: number,
  opts?: NormalizeStoryPlanOpts
): StoryPlan {
  const maxCast = opts?.parentMode
    ? maxCastForParentBook()
    : maxCastForPageCount(pageCount);
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
    // Family scenes may require the full mandatory cast (child + two parents
    // + pet) — the old cap of 2 silently erased the parents.
    characterIds = characterIds.slice(0, 4);

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

    const polishedTitle = (p.title || `Page ${pageNumber}`)
      .replace(/\bAider à la étalage\b/gi, "Aider à préparer l’étalage")
      .replace(/\bà la étalage\b/gi, "à l’étalage");
    return {
      ...p,
      pageNumber,
      title: polishedTitle,
      characterIds,
      comicBeat: beat,
      shotType: p.shotType || (beat === "establishing" ? "wide" : "full_body"),
      action: (p.action || "").trim() || undefined,
      characterPoses: Object.keys(poses).length ? poses : undefined,
      camera: (p.camera || "").trim() || undefined,
      pageSetting: (p.pageSetting || "").trim() || undefined,
      focalPoint: (p.focalPoint || "").trim() || undefined,
      storyText: clampStoryText(p.storyText),
      // Every paid page gets the environment-enrichment contract, including
      // pages where the LLM supplied pageSetting. The scene stays authoritative;
      // enrichment only adds colorable depth and never substitutes another world.
      illustrationDescription: ensureRichEnvironment(
        ensureSceneMentionsCast(
          [
            p.illustrationDescription,
            (p.pageSetting || "").trim()
              ? `THIS PAGE'S SETTING: ${p.pageSetting}.`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
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
  // Invent DISTINCT continuing scenes ON THE LOCKED THEME — never market/travel tropes
  // unless the locked narrative asks for them; never copy-paste "(suite)".
  const heroId = characters[0]?.id || "char_1";
  const heroName = characters[0]?.name || "Le héros";
  const worldSetting = (plan.world?.setting || "le monde de l'histoire").trim();
  const themeKey =
    opts?.themeKey ||
    inferNarrativeThemeKey(
      `${opts?.narrativeLock || ""} ${plan.summary || ""} ${plan.concept || ""} ${worldSetting}`
    );
  const padTemplates = buildPadSceneTemplates(heroName, worldSetting, themeKey);
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
  [/\b(lion|lioness|lionne|lionceau|lion cub)\b/i, "lion"],
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
  const explicit = typeof c.kind === "string" ? c.kind.trim().toLowerCase() : "";
  if (explicit && explicit !== "person" && explicit !== "child") {
    return explicit === "person" ? "human" : explicit;
  }
  const hay = `${c.visualLock || ""} ${c.appearance || ""} ${c.description || ""}`;
  for (const [re, kind] of ANIMAL_WORDS) {
    if (re.test(hay)) return kind;
  }
  return "human";
}

/** Vision-QC expected cast for a set of characters. */
export function expectedCastFor(
  characters: StoryCharacter[]
): Array<{ name: string; kind: string; visualLock?: string }> {
  return characters.map((c) => ({
    name: c.name,
    kind: characterKind(c),
    visualLock: (c.visualLock || c.appearance || "").slice(0, 600),
  }));
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
  "color, grayscale, shading, gradients, filled black areas, photorealism, blurry, text, watermark, extra fingers, fused fingers, floating head, cropped limbs, extra people, extra children, duplicate characters, twin clones, identical twin of hero, inconsistent character design, wrong gender, empty white void, blank white eyes, hollow eyes, pupil-less eyes, elongated skull, deformed head, misshapen cranium, inconsistent line weight, different art style";

type PadTemplate = {
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
};

/**
 * Distinct French scene templates used when the LLM returns fewer pages than
 * paid pageCount. Pads MUST continue the locked theme — never invent market /
 * travel tropes unless themeKey is market/travel.
 */
function buildPadSceneTemplates(
  heroName: string,
  worldSetting: string,
  themeKey = "adventure"
): PadTemplate[] {
  const w = worldSetting || "le monde de l'histoire";

  if (themeKey === "princess") {
    return [
      {
        title: `La petite couronne`,
        storyText: `${heroName}, petite princesse du village, ajuste sa douce couronne dans la cour.`,
        action: `${heroName} carefully placing a soft child crown on her head in a village courtyard`,
        pose: "standing full-body, both hands adjusting a small crown",
        comicBeat: "establishing",
        shotType: "full_body",
        camera: "three-quarter view child eye level",
        pageSetting: `cour de village royale douce dans ${w}`,
        illustrationDescription: `${heroName} young girl princess with a soft crown in a village courtyard with houses, flowers, sky — rich colorable scene. ONE girl only.`,
        resolutionTitle: `Princesse aimée`,
        resolutionStory: `${heroName} est célébrée par son village, le cœur joyeux.`,
        resolutionAction: `${heroName} waving happily as village friends cheer from a distance as soft silhouettes`,
      },
      {
        title: `Aide au village`,
        storyText: `${heroName} aide les villageois avec gentillesse près des cases.`,
        action: `${heroName} carrying a basket of flowers to help villagers near round huts`,
        pose: "walking with a basket, kind smile",
        comicBeat: "help",
        shotType: "wide",
        camera: "side view child eye level",
        pageSetting: `cases du village et fleurs dans ${w}`,
        illustrationDescription: `${heroName} girl princess helping near village huts with flowers, path, sky. No market stalls. ONE child.`,
        resolutionTitle: `Cœur du village`,
        resolutionStory: `${heroName} ressent l'amour de tout le village.`,
        resolutionAction: `${heroName} hugging a soft cloth banner with a warm smile`,
      },
      {
        title: `Le jardin royal`,
        storyText: `${heroName} découvre un jardin secret derrière le grand arbre du village.`,
        action: `${heroName} pushing aside leaves to reveal a secret garden behind a large tree`,
        pose: "pushing leaves aside, leaning forward curiously",
        comicBeat: "action",
        shotType: "wide",
        camera: "slight high angle",
        pageSetting: `jardin secret du village dans ${w}`,
        illustrationDescription: `${heroName} in a secret garden with trees, flowers, fence and sky. Princess child only.`,
        resolutionTitle: `Fête douce`,
        resolutionStory: `${heroName} danse de joie, princesse aimée de tous.`,
        resolutionAction: `${heroName} dancing joyfully with her soft crown in a festive courtyard`,
      },
      {
        title: `Le pont du village`,
        storyText: `${heroName} traverse le petit pont pour rejoindre ses amis.`,
        action: `${heroName} carefully crossing a wooden bridge toward village friends`,
        pose: "mid-step on bridge, arms balancing",
        comicBeat: "obstacle",
        shotType: "wide",
        camera: "side view dynamic",
        pageSetting: `pont de village et rivière dans ${w}`,
        illustrationDescription: `${heroName} crossing a village bridge with river, banks, trees, sky. ONE girl.`,
        resolutionTitle: `Retour heureux`,
        resolutionStory: `${heroName} rentre au village, couronne brillante de fierté.`,
        resolutionAction: `${heroName} arriving home waving with a gentle crown`,
      },
      {
        title: `Chanson du soir`,
        storyText: `${heroName} chante pour le village sous les lanternes.`,
        action: `${heroName} singing joyfully under paper lanterns in the village square`,
        pose: "standing singing, one hand on heart",
        comicBeat: "emotion",
        shotType: "full_body",
        camera: "front three-quarter",
        pageSetting: `place du village avec lanternes dans ${w}`,
        illustrationDescription: `${heroName} singing under lanterns with houses and soft evening sky. Princess girl only.`,
        resolutionTitle: `Bonne nuit princesse`,
        resolutionStory: `${heroName} s'endort aimée de tout son village.`,
        resolutionAction: `${heroName} waving goodnight under a soft evening sky`,
      },
      {
        title: `La mission douce`,
        storyText: `${heroName} apporte de l'eau fraîche aux aînés du village.`,
        action: `${heroName} carrying a small water calabash carefully to elders' porch`,
        pose: "walking carefully holding a calabash with both hands",
        comicBeat: "help",
        shotType: "full_body",
        camera: "three-quarter view",
        pageSetting: `porche de case dans ${w}`,
        illustrationDescription: `${heroName} bringing water near a village porch with pots, trees, sky. ONE child.`,
        resolutionTitle: `Victoire douce`,
        resolutionStory: `${heroName} a aidé tout le monde et rit de bonheur.`,
        resolutionAction: `${heroName} celebrating with open arms in the courtyard`,
      },
      {
        title: `Sous le baobab`,
        storyText: `${heroName} écoute les contes à l'ombre du grand baobab.`,
        action: `${heroName} sitting under a giant baobab listening with bright eyes`,
        pose: "sitting cross-legged looking up",
        comicBeat: "emotion",
        shotType: "wide",
        camera: "low angle looking slightly up",
        pageSetting: `baobab et clairière dans ${w}`,
        illustrationDescription: `${heroName} under a baobab with roots, grass, sky. Soft princess outfit. ONE girl.`,
        resolutionTitle: `Étoiles du village`,
        resolutionStory: `${heroName} regarde les étoiles, princesse apaisée.`,
        resolutionAction: `${heroName} looking at a gentle starry sky with a warm smile`,
      },
      {
        title: `Couronne de fleurs`,
        storyText: `${heroName} tresse une couronne de fleurs pour son village.`,
        action: `${heroName} weaving a flower crown sitting among blooms`,
        pose: "sitting weaving flowers with both hands",
        comicBeat: "action",
        shotType: "mid_shot",
        camera: "child eye level",
        pageSetting: `parterre de fleurs du village dans ${w}`,
        illustrationDescription: `${heroName} weaving a flower crown among blooms, fence, sky. ONE girl princess.`,
        resolutionTitle: `Aimée de tous`,
        resolutionStory: `${heroName} offre sa couronne de fleurs, aimée de tous.`,
        resolutionAction: `${heroName} offering a flower crown with a joyful smile`,
      },
    ];
  }

  if (themeKey === "magic") {
    return [
      {
        title: `Éveil magique`,
        storyText: `${heroName} voit sa magie douce briller entre ses mains.`,
        action: `${heroName} raising glowing soft magic orbs between both hands`,
        pose: "arms raised, glowing orbs as open circles",
        comicBeat: "establishing",
        shotType: "full_body",
        camera: "low angle",
        pageSetting: `clairière magique dans ${w}`,
        illustrationDescription: `${heroName} with visible soft magic sparkles (open star shapes) in a clearing. Rich environment.`,
        resolutionTitle: `Magie partagée`,
        resolutionStory: `${heroName} utilise sa magie pour aider, puis sourit.`,
        resolutionAction: `${heroName} celebrating with soft glowing sparkles around`,
      },
      {
        title: `Sort utile`,
        storyText: `${heroName} aide un ami avec un sort léger et visible.`,
        action: `${heroName} casting a gentle spark toward a stuck cart wheel`,
        pose: "leaning forward casting with one arm",
        comicBeat: "help",
        shotType: "wide",
        camera: "side view",
        pageSetting: `chemin et charrette dans ${w}`,
        illustrationDescription: `${heroName} using soft drawable magic near a cart, trees, sky.`,
        resolutionTitle: `Fin enchantée`,
        resolutionStory: `${heroName} range sa magie, le cœur léger.`,
        resolutionAction: `${heroName} waving goodbye with a tiny glowing orb`,
      },
      {
        title: `Pont enchanté`,
        storyText: `${heroName} traverse un pont que sa magie éclaire.`,
        action: `${heroName} crossing a bridge lit by soft magic sparkles`,
        pose: "mid-step on bridge, one hand glowing",
        comicBeat: "obstacle",
        shotType: "wide",
        camera: "side view dynamic",
        pageSetting: `pont magique dans ${w}`,
        illustrationDescription: `${heroName} on a magic-lit bridge with river, trees, sky.`,
        resolutionTitle: `Maison douce`,
        resolutionStory: `${heroName} rentre heureux après l'aventure magique.`,
        resolutionAction: `${heroName} arriving home with a joyful wave`,
      },
      {
        title: `Jardin des sorts`,
        storyText: `${heroName} fait pousser des fleurs avec un sort doux.`,
        action: `${heroName} kneeling making flowers bloom with soft sparkles`,
        pose: "kneeling, hands near blooming flowers",
        comicBeat: "action",
        shotType: "full_body",
        camera: "three-quarter view",
        pageSetting: `jardin enchanté dans ${w}`,
        illustrationDescription: `${heroName} in a flower garden with visible soft magic shapes.`,
        resolutionTitle: `Ciel magique`,
        resolutionStory: `${heroName} regarde le ciel, fier de sa magie gentille.`,
        resolutionAction: `${heroName} looking at a gentle starry sky smiling`,
      },
      {
        title: `Animal ami`,
        storyText: `${heroName} apaise un petit animal avec sa magie.`,
        action: `${heroName} gently calming a small animal with soft glowing hands`,
        pose: "kneeling gentle hands near animal",
        comicBeat: "help",
        shotType: "full_body",
        camera: "child eye level",
        pageSetting: `lisière boisée dans ${w}`,
        illustrationDescription: `${heroName} helping a small animal among trees and rocks.`,
        resolutionTitle: `Câlin magique`,
        resolutionStory: `${heroName} partage un moment tendre pour clore l'histoire.`,
        resolutionAction: `${heroName} in a warm gentle closing pose`,
      },
      {
        title: `Course étincelante`,
        storyText: `${heroName} court en laissant une traînée d'étoiles dessinables.`,
        action: `${heroName} running with a trail of open star sparkles behind`,
        pose: "running mid-stride, arm forward",
        comicBeat: "action",
        shotType: "wide",
        camera: "side view",
        pageSetting: `sentier étincelant dans ${w}`,
        illustrationDescription: `${heroName} running on a path with star sparkles, trees, sky.`,
        resolutionTitle: `Victoire joyeuse`,
        resolutionStory: `${heroName} a réussi et rit de bonheur.`,
        resolutionAction: `${heroName} holding a small glowing orb with a big smile`,
      },
      {
        title: `Arbre gardien`,
        storyText: `${heroName} parle à un grand arbre ami.`,
        action: `${heroName} placing a hand on a great tree trunk with soft glow`,
        pose: "standing hand on tree",
        comicBeat: "emotion",
        shotType: "wide",
        camera: "low angle",
        pageSetting: `grand arbre dans ${w}`,
        illustrationDescription: `${heroName} by a huge tree with canopy, roots, grass, sky.`,
        resolutionTitle: `Bonne nuit magique`,
        resolutionStory: `${heroName} s'endort le cœur léger.`,
        resolutionAction: `${heroName} waving goodnight under soft evening sky`,
      },
      {
        title: `Lanternes magiques`,
        storyText: `${heroName} allume des lanternes avec une étincelle douce.`,
        action: `${heroName} lighting paper lanterns with a fingertip spark`,
        pose: "reaching up to light a lantern",
        comicBeat: "help",
        shotType: "full_body",
        camera: "side view",
        pageSetting: `chemin de lanternes dans ${w}`,
        illustrationDescription: `${heroName} hanging/lighting lanterns along a path with houses and sky.`,
        resolutionTitle: `Fin lumineuse`,
        resolutionStory: `${heroName} sourit, l'aventure magique est terminée.`,
        resolutionAction: `${heroName} smiling and waving in a peaceful closing scene`,
      },
    ];
  }

  // Default adventure pads — NO market unless themeKey is market.
  const allowMarket = themeKey === "market";
  const templates: PadTemplate[] = [
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
      storyText: `${heroName} danse sous une pluie douce près des maisons.`,
      action: `${heroName} dancing joyfully in light rain near simple houses`,
      pose: "dancing with arms raised, one foot lifted",
      comicBeat: "emotion",
      shotType: "wide",
      camera: "front three-quarter wide",
      pageSetting: `cour sous la pluie dans ${w}`,
      illustrationDescription: `${heroName} dancing in light rain with houses, ground puddles, trees and cloudy sky filling the page.`,
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

  if (allowMarket) {
    templates.splice(2, 0, {
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
      resolutionAction: `${heroName} dancing happily in a festive final scene`,
    });
  }

  return templates;
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

  // Prefer THIS page's scene so a polluted world.setting ("…market…") cannot
  // overwrite a princess/village page. Fall back to world only when scene is vague.
  const sceneIsRoyal =
    /princess|princesse|castle|chateau|château|crown|couronne|royal|royaume/i.test(
      sceneHay
    );
  let envHint = "";
  if (sceneIsRoyal) {
    envHint =
      envFor(sceneHay) ||
      "ENVIRONMENT: soft royal village courtyard with houses, flowers, a path and sky — large colorable shapes. NOT a market road-trip.";
  } else {
    envHint = envFor(sceneHay) || envFor(worldHay);
  }
  if (!envHint) {
    envHint = worldSetting?.trim()
      ? `ENVIRONMENT matching the story setting "${worldSetting.trim()}": include mid-ground props and a simple readable background with large colorable closed shapes (never an empty white void, never only tiny grass tufts).`
      : "ENVIRONMENT: rich colorable setting with mid-ground props and simple background (never empty white void, never only tiny grass tufts).";
  }

  const richness =
    "COLORING VALUE: compose a coherent foreground, midground and background with 6–10 LARGE CLOSED colorable objects/zones specific to this scene; ground and sky must also contain meaningful closed shapes. Hero occupies at most 35% of the page. Organic professional ink contours with gently varied line weight — never generic vector clipart or giant glossy emoji eyes.";
  const bans =
    "No empty white void. No floating characters. No malformed, missing, fused or duplicated limbs. Simplified readable child hands holding objects when relevant. ONLY the named cast of this scene — no extra characters.";

  // If the model already wrote its own ENVIRONMENT: block, keep it (Fix B: don't stack
  // conflicting canned environments on top of the model's own scene-derived one).
  if (scene.toLowerCase().includes("environment:")) {
    return `${scene} ${richness} ${bans}`.trim();
  }
  return `${scene} ${envHint} ${richness} ${bans}`.trim();
}
