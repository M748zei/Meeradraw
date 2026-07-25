/**
 * Guard: story plans must honor the user's original idea (hero name, power/theme).
 * Used after LLM planning — retry once, then fail clearly rather than ship off-topic.
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
    re: /princesse|princess|prince\b/i,
    labels: ["princesse", "princess", "prince"],
  },
  {
    re: /aimé|aimee|aimée|loved|adoré|adoree|adorée/i,
    labels: ["aime", "aimee", "loved", "adore"],
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

  const hay = normalize(
    [
      plan.title,
      plan.subtitle,
      plan.summary,
      plan.concept,
      ...plan.characters.map((c) => `${c.name} ${c.description} ${c.personality}`),
      ...plan.pages.map(
        (p) => `${p.title} ${p.storyText} ${p.action} ${p.illustrationDescription}`
      ),
    ]
      .filter(Boolean)
      .join(" ")
  );

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
