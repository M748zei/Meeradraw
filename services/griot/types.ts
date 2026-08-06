/** Types du moteur de récits Griot — la sortie décrite au §5 du cahier. */

export const ANGLES = ["crime", "mystere", "destin", "pouvoir", "heritage"] as const;
export type Angle = (typeof ANGLES)[number];

export const DUREES = ["45", "75", "120"] as const;
export type Duree = (typeof DUREES)[number];

/** Cibles par durée : mots parlés (~150 mots/min) et nombre de plans. */
export const CIBLES_DUREE: Record<Duree, { secondes: number; mots: number; plans: number }> = {
  "45": { secondes: 45, mots: 110, plans: 6 },
  "75": { secondes: 75, mots: 190, plans: 9 },
  "120": { secondes: 120, mots: 300, plans: 13 },
};

export interface RecitInput {
  sujet: string;
  angle: Angle;
  pays?: string;
  duree: Duree;
}

export interface PlanRecit {
  /** Fragment du script — la concaténation des narrations redonne le script. */
  narration: string;
  /** Description visuelle du plan, en français. */
  image: string;
  /** Requête de recherche d'images, en anglais. */
  recherche: string;
  /** Texte court incrusté à l'écran (optionnel). */
  incrustation?: string;
}

export interface Recit {
  accroches: string[];
  titre: string;
  script: string;
  duree_secondes: number;
  plans: PlanRecit[];
  description: string;
  question: string;
  hashtags: string[];
  reponses: { commentaire: string; reponse: string }[];
  tiktok: { accroche: string; script: string };
  /** JAMAIS vide (§6.2) — le normaliseur y veille. */
  a_verifier: string[];
  prochains_sujets: string[];
}

/** Récit structurellement présent mais inutilisable (script vide/trop court…). */
export class RecitInutilisable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecitInutilisable";
  }
}

/** Réponse du modèle illisible (pas de JSON exploitable). */
export class ReponseIllisible extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReponseIllisible";
  }
}
