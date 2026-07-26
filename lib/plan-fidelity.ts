/**
 * Guard: story plans must honor the user's original idea (hero name, power/theme).
 * Used after LLM planning — retry once, then rewrite or fail rather than ship off-topic.
 */

import type { StoryPlan } from "@/services/ai/types";

const STOPWORDS = new Set([
  "avec",
  "dans",
  "pour",
  "une",
  "des",
  "les",
  "qui",
  "que",
  "est",
  "sont",
  "aux",
  "sur",
  "par",
  "son",
  "ses",
  "mon",
  "mes",
  "ton",
  "tes",
  "leur",
  "cette",
  "cet",
  "ces",
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "have",
  "has",
  "was",
  "were",
  "his",
  "her",
  "their",
  "about",
  "livre",
  "histoire",
  "enfant",
  "enfants",
  "aventure",
  "coloriage",
  "petit",
  "petite",
  "grand",
  "grande",
  // Places / regions — not hero names
  "afrique",
  "ouest",
  "europe",
  "asie",
  "amerique",
  "amérique",
  "dakar",
  "abidjan",
  "lagos",
  "accra",
  "niger",
  "sahel",
  "savane",
]);

/** Capitalized words that are almost never person names in FR briefs. */
const NON_NAME_CAPS = new Set([
  "afrique",
  "ouest",
  "europe",
  "asie",
  "ameriques",
  "amériques",
  "magie",
  "pouvoirs",
  "pouvoir",
  "ecole",
  "école",
  "marche",
  "marché",
  "baobab",
  "village",
  "ville",
  "ouest",
]);

/** Theme/power stems that must appear if present in the original idea. */
const THEME_MARKERS: Array<{ re: RegExp; labels: string[] }> = [
  {
    re: /pouvoir|magie|magique|sorcier|sorcière|enchant|spell|wizard|magic/i,
    labels: ["magie", "pouvoir", "magic", "spell", "enchant", "sorcier"],
  },
  {
    re: /école|school|classe|institutrice|enseignant/i,
    labels: ["école", "school", "classe"],
  },
  {
    re: /animal|animaux|renard|lion|éléphant|elephant|tortue|chat|chien/i,
    labels: ["animal", "animaux"],
  },
  {
    re: /robot|espace|fusée|astronaut|planet/i,
    labels: ["robot", "espace", "fusée", "astronaut"],
  },
  {
    re: /foot|football|soccer|ballon/i,
    labels: ["foot", "football", "ballon", "soccer"],
  },
  {
    re: /princesse|princess|prince\b|couronne|crown|royal|royaume|château|chateau|castle/i,
    labels: [
      "princesse",
      "princess",
      "prince",
      "couronne",
      "crown",
      "royal",
      "château",
      "castle",
    ],
  },
  {
    re: /aimé|aimee|aimée|loved|adoré|adoree|adorée/i,
    labels: ["aime", "aimee", "loved", "adore"],
  },
  {
    re: /village/i,
    labels: ["village"],
  },
];

/**
 * Generic substitute adventures the model loves to invent.
 * Banned when the parent/source narrative does NOT ask for them.
 */
const SUBSTITUTE_TROPES: Array<{ id: string; re: RegExp; label: string }> = [
  {
    id: "travel_parents",
    re: /voyage|road\s*trip|travers(e|er|ée|ee)|across the country|a travers le pays|à travers le pays|trip with (my |the )?parents|voyage avec (ses |les )?parents|parents.*pays|pays.*parents|départ pour|dusty road|chemin poussi[eé]reux|route poussi[eé]reuse/i,
    label: "voyage / road-trip avec les parents",
  },
  {
    id: "market_day",
    re: /journ[eé]e au march[eé]|market day|d[eé]part.*march[eé]|march[eé].*d[eé]part|au march[eé] avec|open-air market adventure|aventure au march[eé]/i,
    label: "journée / départ au marché",
  },
  {
    id: "generic_market_arc",
    re: /petit march[eé]|explore un march[eé]|browsing market|market stalls/i,
    label: "arc marché générique",
  },
];

/**
 * Parent books: hero visualLock must describe a CHILD, never an adult.
 */
export function assertHeroIsChild(
  plan: StoryPlan,
  childName?: string
): FidelityResult {
  const hero =
    (childName &&
      plan.characters.find(
        (c) => normalize(c.name) === normalize(childName)
      )) ||
    plan.characters[0];
  if (!hero) return { ok: false, reasons: ["Aucun héros dans le plan."] };

  const lock = normalize(
    `${hero.visualLock || ""} ${hero.ageBand || ""} ${hero.appearance || ""} ${hero.body || ""}`
  );
  const reasons: string[] = [];
  if (
    /\b(adult|woman|man|mother|father|lady|grown ?up|mature woman)\b/.test(lock) &&
    !/\b(child|girl|boy|kid|years? old|enfant)\b/.test(lock)
  ) {
    reasons.push(`« ${hero.name} » est décrit comme un adulte — doit être un enfant.`);
  }
  if (!/\b(child|girl|boy|kid|years?|enfant|petite|petit)\b/.test(lock)) {
    reasons.push(`visualLock de « ${hero.name} » ne précise pas que c'est un enfant.`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * Hero gender must match the parent's choice on every visualLock / appearance.
 */
export function assertHeroGender(
  plan: StoryPlan,
  childGender?: string | null,
  childName?: string
): FidelityResult {
  if (!childGender || childGender === "unspecified") return { ok: true };

  const hero =
    (childName &&
      plan.characters.find(
        (c) => normalize(c.name) === normalize(childName)
      )) ||
    plan.characters[0];
  if (!hero) return { ok: false, reasons: ["Aucun héros dans le plan."] };

  const lock = normalize(
    `${hero.visualLock || ""} ${hero.appearance || ""} ${hero.description || ""} ${hero.body || ""}`
  );
  const reasons: string[] = [];

  if (childGender === "girl") {
    if (/\b(young )?boy\b|\bgarcon\b|\bson\b|\blittle boy\b/.test(lock)) {
      reasons.push(`« ${hero.name} » est décrit comme un garçon — doit être une fille.`);
    }
    if (!/\b(girl|fille|young girl|petite fille)\b/.test(lock)) {
      reasons.push(`visualLock de « ${hero.name} » ne précise pas que c'est une fille.`);
    }
  }
  if (childGender === "boy") {
    if (/\b(young )?girl\b|\bfille\b|\bdaughter\b|\blittle girl\b/.test(lock)) {
      reasons.push(`« ${hero.name} » est décrit comme une fille — doit être un garçon.`);
    }
    if (!/\b(boy|garcon|young boy|petit garcon)\b/.test(lock)) {
      reasons.push(`visualLock de « ${hero.name} » ne précise pas que c'est un garçon.`);
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Extract likely proper names / distinctive tokens from the user idea. */
export function extractIdeaKeywords(originalIdea: string): {
  names: string[];
  themes: string[];
  tokens: string[];
} {
  const raw = originalIdea.trim();
  const names: string[] = [];
  // Capitalized words (FR/EN) of length ≥ 3 — likely hero names
  for (const m of raw.matchAll(/\b([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇ][a-zàâäéèêëïîôùûüç]{2,})\b/g)) {
    const n = m[1];
    const key = normalize(n);
    if (!STOPWORDS.has(key) && !NON_NAME_CAPS.has(key)) names.push(n);
  }
  // Explicit "prénom / called / nommé"
  for (const m of raw.matchAll(
    /(?:prénom|prenom|nommé|nommee|s'appelle|called|named)\s+[«"]?([A-Za-zÀ-ÿ]{2,})/gi
  )) {
    names.push(m[1]);
  }

  const themes: string[] = [];
  for (const t of THEME_MARKERS) {
    if (t.re.test(raw)) themes.push(...t.labels);
  }

  const tokens = normalize(raw)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  return {
    names: [...new Set(names)],
    themes: [...new Set(themes)],
    tokens: [...new Set(tokens)].slice(0, 12),
  };
}

export type FidelityResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

function planHaystack(plan: StoryPlan): string {
  return normalize(
    [
      plan.title,
      plan.subtitle,
      plan.summary,
      plan.concept,
      plan.world?.setting,
      ...plan.characters.map((c) => `${c.name} ${c.description} ${c.personality}`),
      ...plan.pages.map(
        (p) =>
          `${p.title} ${p.storyText} ${p.action} ${p.illustrationDescription} ${p.pageSetting}`
      ),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Soft check: original idea's hero name + core theme must surface in the plan.
 * Skips when the idea is too vague (< 3 meaningful tokens).
 */
export function assertPlanFidelity(
  originalIdea: string,
  plan: StoryPlan
): FidelityResult {
  const idea = originalIdea.trim();
  if (idea.length < 8) return { ok: true };

  const { names, themes, tokens } = extractIdeaKeywords(idea);
  if (names.length === 0 && themes.length === 0 && tokens.length < 3) {
    return { ok: true };
  }

  const hay = planHaystack(plan);
  const reasons: string[] = [];

  for (const name of names) {
    if (!hay.includes(normalize(name))) {
      reasons.push(`Le héros « ${name} » de l'idée est absent du plan.`);
    }
  }

  for (const themeGroup of THEME_MARKERS) {
    if (!themeGroup.re.test(idea)) continue;
    const hit = themeGroup.labels.some((l) => hay.includes(normalize(l)));
    if (!hit) {
      reasons.push(
        `Le thème « ${themeGroup.labels[0]} » de l'idée n'apparaît pas dans le plan.`
      );
    }
  }

  // At least ~30% of distinctive tokens should appear somewhere
  if (tokens.length >= 4) {
    const hits = tokens.filter((t) => hay.includes(t)).length;
    if (hits / tokens.length < 0.25) {
      reasons.push(
        "Le plan s'éloigne trop de l'idée originale (peu de mots-clés conservés)."
      );
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * Hard parent lock: ban substitute adventures (travel/market) when the parent
 * asked for something else (princess/village/custom story), and require the
 * parent's distinctive words across title + summary + pages.
 */
export function assertParentNarrativeLock(
  sourceNarrative: string,
  plan: StoryPlan
): FidelityResult {
  const source = sourceNarrative.trim();
  if (source.length < 12) return { ok: true };

  const sourceN = normalize(source);
  const hay = planHaystack(plan);
  const reasons: string[] = [];

  for (const trope of SUBSTITUTE_TROPES) {
    const inSource = trope.re.test(source);
    const inPlan = trope.re.test(hay);
    if (!inSource && inPlan) {
      reasons.push(
        `Intrigue substituée détectée (« ${trope.label} ») alors que l'histoire du parent ne la demande pas.`
      );
    }
  }

  // Core theme markers from source must survive in the plan (harder than soft fidelity).
  for (const themeGroup of THEME_MARKERS) {
    if (!themeGroup.re.test(source)) continue;
    const hit = themeGroup.labels.some((l) => hay.includes(normalize(l)));
    if (!hit) {
      reasons.push(
        `Le thème central « ${themeGroup.labels[0]} » du parent a disparu du plan.`
      );
    }
  }

  const { tokens } = extractIdeaKeywords(source);
  if (tokens.length >= 5) {
    const hits = tokens.filter((t) => hay.includes(t)).length;
    if (hits / tokens.length < 0.35) {
      reasons.push(
        "Le plan ne conserve pas assez de mots de l'histoire du parent (substitution probable)."
      );
    }
  }

  // The ending must resolve the parent's actual plot, not merely mention the
  // hero before switching to an unrelated side quest. Check the final two
  // pages for a meaningful share of the parent's distinctive non-name tokens.
  const { names } = extractIdeaKeywords(source);
  const nameTokens = new Set(names.map(normalize));
  const resolutionTokens = tokens.filter((t) => !nameTokens.has(t));
  if (resolutionTokens.length >= 4 && plan.pages?.length) {
    const ending = normalize(
      plan.pages
        .slice(-2)
        .map((p) => `${p.title || ""} ${p.storyText || ""} ${p.action || ""}`)
        .join(" ")
    );
    const endingHits = resolutionTokens.filter((t) => ending.includes(t)).length;
    if (endingHits / resolutionTokens.length < 0.2) {
      reasons.push(
        "La fin ne résout pas l'intrigue demandée par le parent (les éléments clés disparaissent)."
      );
    }
  }

  // Every page caption must mention the hero name if we can extract one, OR
  // share at least one distinctive source token (blocks total plot replacement).
  const heroName = names[0];
  if (heroName && plan.pages?.length) {
    const heroN = normalize(heroName);
    const pagesMissingHero = plan.pages.filter((p) => {
      const pageN = normalize(
        `${p.storyText || ""} ${p.title || ""} ${p.action || ""}`
      );
      return !pageN.includes(heroN);
    });
    if (pagesMissingHero.length >= Math.max(2, Math.ceil(plan.pages.length * 0.4))) {
      reasons.push(
        `Trop de pages omettent le héros « ${heroName} » dans le texte / l'action.`
      );
    }
  }

  // If source is NOT about travel/market, title+summary must not lead with that.
  const lead = normalize(`${plan.title || ""} ${plan.summary || ""}`);
  if (
    !/voyage|road\s*trip|march[eé]|market|parents/i.test(sourceN) &&
    /voyage|road\s*trip|journ[eé]e au march|avec (ses |les )?parents|dusty road/i.test(
      lead
    )
  ) {
    reasons.push(
      "Le titre/résumé raconte un voyage ou un marché différent de l'histoire du parent."
    );
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * Infer a short theme key for pad-scene generation from the locked narrative.
 */
export function inferNarrativeThemeKey(sourceNarrative: string): string {
  const s = sourceNarrative || "";
  if (/princesse|princess|prince\b|couronne|crown|royal|château|chateau|castle/i.test(s)) {
    return "princess";
  }
  if (/pouvoir|magie|magique|spell|wizard|magic/i.test(s)) return "magic";
  if (/école|school|classe/i.test(s)) return "school";
  if (/animal|animaux|renard|lion|éléphant|elephant|tortue/i.test(s)) return "animals";
  if (/marché|market|étal|etal/i.test(s)) return "market";
  if (/voyage|road\s*trip|travers/i.test(s)) return "travel";
  if (/village|baobab|afrique/i.test(s)) return "village";
  return "adventure";
}

/**
 * Reject storyboards where ≥3 pages share the same camera or the same action stem
 * (clone poses / identical framing).
 */
export function assertPoseDiversity(plan: StoryPlan): FidelityResult {
  const pages = plan.pages || [];
  if (pages.length < 4) return { ok: true };

  const reasons: string[] = [];

  const cameraCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const shotCounts = new Map<string, number>();

  for (const p of pages) {
    const cam = normalize((p.camera || "").slice(0, 40));
    if (cam.length >= 8) {
      cameraCounts.set(cam, (cameraCounts.get(cam) || 0) + 1);
    }
    const act = normalize((p.action || "").split(/\s+/).slice(0, 4).join(" "));
    if (act.length >= 6) {
      actionCounts.set(act, (actionCounts.get(act) || 0) + 1);
    }
    const shot = normalize(p.shotType || "");
    if (shot) shotCounts.set(shot, (shotCounts.get(shot) || 0) + 1);
  }

  for (const [cam, n] of cameraCounts) {
    if (n >= 3) {
      reasons.push(`Au moins ${n} pages partagent le même angle caméra (« ${cam.slice(0, 28)}… »).`);
      break;
    }
  }
  for (const [, n] of actionCounts) {
    if (n >= 3) {
      reasons.push(`Au moins ${n} pages reprennent la même action / pose.`);
      break;
    }
  }
  // Prefer variety of shot types when book is long enough
  if (pages.length >= 6 && shotCounts.size < 2) {
    reasons.push("Toutes les pages ont le même shotType — varie full_body / mid_shot / wide.");
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}
