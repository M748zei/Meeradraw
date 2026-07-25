/**
 * Parent MVP — âge / thème / prénom → cahier PDF.
 */

export const AGE_BANDS = [
  {
    id: "3-5",
    label: "3–5 ans",
    audience: "enfants 3–5 ans",
    promptHint:
      "Vocabulaire très simple, phrases courtes. Traits TRÈS épais, grandes zones, décors minimalistes (style simple).",
    defaultStyle: "simple" as const,
    defaultPages: 6,
  },
  {
    id: "6-8",
    label: "6–8 ans",
    audience: "enfants 6–8 ans",
    promptHint:
      "Français clair et chaleureux. Line art équilibré, action lisible, 1–2 personnages max par scène.",
    defaultStyle: "cute" as const,
    defaultPages: 8,
  },
  {
    id: "9-12",
    label: "9–12 ans",
    audience: "enfants 9–12 ans",
    promptHint:
      "Histoire un peu plus riche, captions 2–3 phrases. Poses dynamiques, décors plus détaillés mais toujours colorables.",
    defaultStyle: "adventure" as const,
    defaultPages: 12,
  },
] as const;

export type AgeBandId = (typeof AGE_BANDS)[number]["id"];

export const PARENT_THEMES = [
  {
    id: "magic",
    label: "Magie",
    style: "fantasy",
    ideaTemplate: (name: string) =>
      `${name}, enfant aux pouvoirs magiques doux, découvre et utilise sa magie visible page après page pour aider ses amis.`,
  },
  {
    id: "animals",
    label: "Animaux",
    style: "cute",
    ideaTemplate: (name: string) =>
      `${name} part à l'aventure avec des animaux amis fidèles dans la nature, avec des défis doux et joyeux.`,
  },
  {
    id: "school",
    label: "École",
    style: "cute",
    ideaTemplate: (name: string) =>
      `${name} vit une journée d'école pleine de découvertes, d'amis et d'un petit défi courageux.`,
  },
  {
    id: "africa",
    label: "Afrique",
    style: "west_african",
    ideaTemplate: (name: string) =>
      `${name}, enfant aux pouvoirs magiques, vit une aventure joyeuse en Afrique de l'Ouest (marché, baobab, village ou ville) avec magie douce visible.`,
  },
  {
    id: "fantasy",
    label: "Fantasy",
    style: "fantasy",
    ideaTemplate: (name: string) =>
      `${name} explore un monde fantastique doux (château, forêt enchantée) et affronte un obstacle magique sans peur.`,
  },
  {
    id: "adventure",
    label: "Aventure",
    style: "adventure",
    ideaTemplate: (name: string) =>
      `${name} part en grande aventure : grimper, traverser, aider un ami, et revenir victorieux.`,
  },
  {
    id: "folklore",
    label: "Conte africain",
    style: "folklore_wa",
    ideaTemplate: (name: string) =>
      `${name}, petit héros malin d'un village d'Afrique de l'Ouest, résout un mystère avec sagesse et gentillesse (personnages originaux).`,
  },
] as const;

export type ParentThemeId = (typeof PARENT_THEMES)[number]["id"];

export const PARENT_PAGE_OPTIONS = [6, 8, 12] as const;

/** Thèmes / sujets refusés pour le parcours parent (checklist MVP). */
export const FORBIDDEN_THEME_PATTERNS: RegExp[] = [
  /violence|tuer|meurtre|arme\b|sang|horreur|gore/i,
  /sexe|porn|nu(d|e)|erotique/i,
  /drogue|alcool|cigarette/i,
  /terroris|racis|nazis|suicid/i,
];

export function isForbiddenParentTheme(text: string): string | null {
  for (const re of FORBIDDEN_THEME_PATTERNS) {
    if (re.test(text)) {
      return "Ce thème n’est pas adapté aux enfants. Choisissez une aventure douce (magie, animaux, école, Afrique…).";
    }
  }
  return null;
}

export function getAgeBand(id: string) {
  return AGE_BANDS.find((a) => a.id === id) ?? AGE_BANDS[1];
}

export function getParentTheme(id: string) {
  return PARENT_THEMES.find((t) => t.id === id) ?? PARENT_THEMES[0];
}

/**
 * Resolve image style for the parent flow: keep West-African contracts when
 * chosen; otherwise prefer the age band default (e.g. 3–5 → simple line art).
 */
export function resolveParentStyle(ageId: string, themeId: string): string {
  const theme = getParentTheme(themeId);
  const age = getAgeBand(ageId);
  if (theme.style === "west_african" || theme.style === "folklore_wa") {
    return theme.style;
  }
  if (age.id === "3-5") return age.defaultStyle;
  return theme.style;
}

export const PARENT_PROMISE =
  "Âge, genre, prénom, votre histoire — et une photo si vous voulez : un cahier qui ressemble à votre enfant, prêt à imprimer.";

export const CHILD_GENDERS = [
  { id: "girl" as const, label: "Fille" },
  { id: "boy" as const, label: "Garçon" },
  { id: "unspecified" as const, label: "Non précisé" },
];

export type ChildGenderId = (typeof CHILD_GENDERS)[number]["id"];
