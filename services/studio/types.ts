/** Types du Scarabée Studio — le studio d'images de la page. */

export const PRESET_IDS = [
  "nuit-archive",
  "heure-doree",
  "affiche-resistance",
  "document-epoque",
  "portrait-archive",
  "plein-jour-poussiere",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const FORMATS = ["9:16", "1:1", "16:9"] as const;
export type Format = (typeof FORMATS)[number];

export const VARIANTES = [1, 2, 4] as const;
export type Variantes = (typeof VARIANTES)[number];

/** « Changer l'heure du jour » après génération — remplace le bloc lumière. */
export const HEURES = ["nuit", "aube", "jour", "crepuscule"] as const;
export type Heure = (typeof HEURES)[number];

export interface CompilerInput {
  /** La scène décrite par l'utilisateur, une phrase en français. */
  scene: string;
  /** Année facultative — déclenche le pack d'époque. */
  annee?: number;
  /** Lieu facultatif. */
  lieu?: string;
  preset: PresetId;
  /** Si absente, le preset garde son heure native. */
  heure?: Heure;
  format: Format;
}

/**
 * Un preset = la recette complète, bloc par bloc. Le prompt final est
 * l'assemblage rendu + lumière + scène + époque + caméra + atmosphère +
 * étalonnage. Tout est affirmatif : un modèle de diffusion ne soustrait pas.
 */
export interface Preset {
  id: PresetId;
  nom: string;
  description: string;
  rendu: string;
  /** Lumière native du preset + variantes par heure du jour. */
  lumiere: Record<Heure, string>;
  heureNative: Heure;
  sol: string;
  atmosphere: string;
  etalonnage: string;
  /** Couleurs de la vignette dans la grille (pas d'image statique à gérer). */
  vignette: { de: string; vers: string };
}
