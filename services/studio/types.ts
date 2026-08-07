/** Types de MeeraDraw — « le Midjourney africain ». */

export const PRESET_IDS = [
  // 1. Portrait et identité
  "portrait-pro",
  "portrait-studio",
  "portrait-traditionnel",
  "portrait-archive",
  "avatar-illustre",
  "portrait-couple",
  // 2. Commerce et boutique
  "produit-fond-uni",
  "produit-en-main",
  "vitrine-boutique",
  "flyer-promo",
  "equipe-bureau",
  "plat-restaurant",
  // 3. Famille et célébrations
  "mariage",
  "bapteme",
  "portrait-famille",
  "anniversaire",
  "hommage",
  // 4. Foi et sagesse
  "affiche-religieuse",
  "fond-citation",
  "scene-priere",
  // 5. Récit et histoire — la série d'origine
  "nuit-archive",
  "heure-doree",
  "affiche-resistance",
  "document-epoque",
  "plein-jour-poussiere",
  "carte-ancienne",
  // 6. Réseaux et contenu
  "miniature-video",
  "motivation",
  "ville-nuit",
  "nature-afrique",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const CATEGORIES = [
  { id: "portrait", nom: "Portrait et identité" },
  { id: "commerce", nom: "Commerce et boutique" },
  { id: "famille", nom: "Famille et célébrations" },
  { id: "foi", nom: "Foi et sagesse" },
  { id: "recit", nom: "Récit et histoire" },
  { id: "reseaux", nom: "Réseaux et contenu" },
] as const;
export type CategorieId = (typeof CATEGORIES)[number]["id"];

export const FORMATS = ["9:16", "4:5", "1:1", "16:9"] as const;
export type Format = (typeof FORMATS)[number];

export const VARIANTES = [1, 2, 4] as const;
export type Variantes = (typeof VARIANTES)[number];

/** « Changer l'heure du jour » — ambiance temporelle ajoutée au bloc lumière. */
export const HEURES = ["nuit", "aube", "jour", "crepuscule"] as const;
export type Heure = (typeof HEURES)[number];

/**
 * Régions de l'ancrage africain (§0.1) : remplacent matériaux et végétation.
 * "monde" = décor explicitement non africain → le bloc d'ancrage est omis.
 */
export const REGIONS = ["ouest", "sahel", "cote", "foret", "est", "maghreb", "monde"] as const;
export type Region = (typeof REGIONS)[number];

/** Ce qu'un preset accepte en image de référence (chantiers 4-5). */
export type ReferenceType = "produit" | "selfie" | "logo";

/** Les trois parties de l'ancrage africain — chaque preset déclare les siennes. */
export const ANCRAGE_PARTIES = ["personnes", "decor", "tenues"] as const;
export type AncragePartie = (typeof ANCRAGE_PARTIES)[number];

/** Plage vide réservée par les presets [zone de texte]. */
export type ZoneTexte = "haut" | "bas" | "centre" | "droite" | "bandeaux";

/**
 * Un champ que le preset déclare (§3 du parcours v2) : c'est le style qui
 * décide de ce qu'on demande. Aucun champ obligatoire sauf la phrase quand
 * elle est déclarée. Vide, le modèle décide ; rempli, il obéit.
 */
export type Champ =
  | { type: "phrase"; label: string; exemples: string[] }
  | { type: "personnages"; max: number }
  | { type: "objets"; max: number }
  | { type: "texte"; cle: string; label: string; exemples: string[] }
  | { type: "annee" }
  | { type: "lieu" };

/** Un personnage = trois cases courtes, pas une dissertation. */
export interface Personnage {
  role?: string;
  tenue?: string;
  action?: string;
}

/** Ce que l'utilisateur a saisi à l'étape 2 — n'alimente QUE le bloc sujet. */
export interface Saisie {
  phrase?: string;
  personnages?: Personnage[];
  objets?: string[];
  /** Valeurs des champs texte, par clé déclarée (fond, tenue, produit…). */
  textes?: Record<string, string>;
  annee?: number;
  lieu?: string;
}

export interface CompilerInput {
  preset: PresetId;
  saisie: Saisie;
  /** Si absente, le preset garde sa lumière native. */
  heure?: Heure;
  format: Format;
  /** Défaut : "ouest" (le bloc d'ancrage de base). */
  region?: Region;
  /** Mode avancé : ajouté en dernier, jamais avant. */
  promptLibre?: string;
  /**
   * Un selfie de référence est fourni : le bloc « personnes » de l'ancrage se
   * RETIRE — sinon il écrase le visage réel de la personne (chantier 5 §2).
   */
  avecSelfie?: boolean;
  /**
   * Composite produit : ne générer QUE le décor, avec une zone libre bien
   * éclairée où le produit détouré sera reposé (chantier 4 §2).
   */
  decorProduit?: boolean;
}

/**
 * Un preset = une ligne du catalogue : rendu + lumière + cadre (+ format
 * conseillé). Le prompt final est l'assemblage rendu + lumière + ancrage
 * africain + scène + époque + cadre. Tout est affirmatif : un modèle de
 * diffusion ne soustrait pas.
 */
export interface Preset {
  id: PresetId;
  categorie: CategorieId;
  nom: string;
  description: string;
  rendu: string;
  lumiere: string;
  cadre: string;
  /** Format présélectionné à l'écran 3 (modifiable). */
  format: Format;
  /** Présent sur les presets [zone de texte]. */
  zoneTexte?: ZoneTexte;
  /** Les questions que ce style pose à l'étape 2 (§3 du parcours v2). */
  champs: Champ[];
  /**
   * Les parties de l'ancrage africain que ce style prend : un portrait studio
   * et un packshot ne prennent que « personnes » — le décor village n'a rien
   * à faire derrière un fond uni.
   */
  ancrage: AncragePartie[];
  /** Image de référence acceptée par ce style (absent = aucune). */
  reference?: ReferenceType;
  /** Couleurs de la vignette dans la grille. */
  vignette: { de: string; vers: string };
}
