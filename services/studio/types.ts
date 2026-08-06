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

/** Plage vide réservée par les presets [zone de texte]. */
export type ZoneTexte = "haut" | "bas" | "centre" | "droite" | "bandeaux";

export interface CompilerInput {
  /** La scène décrite par l'utilisateur, une phrase en français. */
  scene: string;
  annee?: number;
  lieu?: string;
  preset: PresetId;
  /** Si absente, le preset garde sa lumière native. */
  heure?: Heure;
  format: Format;
  /** Défaut : "ouest" (le bloc d'ancrage de base). */
  region?: Region;
  /** Mode avancé : ajouté APRÈS l'ancrage et le preset, jamais avant. */
  promptLibre?: string;
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
  /** Couleurs de la vignette dans la grille. */
  vignette: { de: string; vers: string };
}
