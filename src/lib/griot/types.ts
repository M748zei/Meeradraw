/**
 * Le contrat de sortie de Griot.
 *
 * Il est volontairement plat et explicite : chaque champ correspond à UN
 * bouton « copier » dans l'interface. La personne ne doit jamais avoir à
 * découper elle-même un pavé de texte — c'est exactement le travail qu'on lui
 * fait gagner.
 */

export type Plan = {
  /** Le texte que la voix dit sur ce plan, mot pour mot. */
  narration: string;
  /** Ce qu'on voit à l'écran pendant ces secondes-là. */
  image: string;
  /** À taper dans une banque d'images ou un générateur, en anglais. */
  recherche: string;
  /** Texte à incruster à l'écran (court, lisible sur un téléphone). */
  incrustation?: string;
};

export type Recit = {
  /** 3 accroches concurrentes : la première ligne décide de tout. */
  accroches: string[];
  /** Le titre retenu, celui qui ouvre la description. */
  titre: string;
  /** Le script complet, prêt à enregistrer, sans didascalies. */
  script: string;
  /** Durée de lecture estimée à voix haute, en secondes. */
  duree_secondes: number;
  /** Le découpage : un plan = une phrase = une image. */
  plans: Plan[];
  /** La description Facebook, format Scarabée Noir, question comprise. */
  description: string;
  /** La question posée à l'audience, isolée pour l'épingler en commentaire. */
  question: string;
  /** Hashtags, déjà préfixés du dièse. */
  hashtags: string[];
  /** Réponses toutes prêtes aux commentaires qui reviennent. */
  reponses: { commentaire: string; reponse: string }[];
  /** La version TikTok : plus courte, autre accroche. */
  tiktok: { accroche: string; script: string };
  /**
   * Ce qui n'est PAS certain.
   *
   * Une page d'histoires vraies vit de sa crédibilité : une date fausse et
   * l'audience part. Le modèle doit donc déclarer lui-même ce qu'il n'a pas
   * pu établir, au lieu de combler les trous en silence. C'est la différence
   * entre cet outil et une réponse de chatbot.
   */
  a_verifier: string[];
  /** Trois sujets pour les jours suivants : ne jamais tomber en panne d'idées. */
  prochains_sujets: string[];
};

export type DemandeRecit = {
  sujet: string;
  angle: AngleId;
  pays: string;
  duree: DureeId;
};

export const ANGLES = [
  { id: 'crime', label: 'Affaire criminelle', aide: 'braquage, disparition, procès, scandale' },
  { id: 'mystere', label: 'Mystère non résolu', aide: 'énigme, légende, fait inexpliqué' },
  { id: 'destin', label: 'Destin hors norme', aide: 'roi, résistante, oublié de l’Histoire' },
  { id: 'pouvoir', label: 'Pouvoir et complot', aide: 'coup d’État, assassinat politique' },
  { id: 'heritage', label: 'Héritage volé', aide: 'objets pillés, mémoire effacée, colonisation' },
] as const;

export type AngleId = (typeof ANGLES)[number]['id'];

export const DUREES = [
  { id: 'court', label: '45 s', mots: 110, plans: 6 },
  { id: 'moyen', label: '75 s', mots: 190, plans: 9 },
  { id: 'long', label: '2 min', mots: 300, plans: 13 },
] as const;

export type DureeId = (typeof DUREES)[number]['id'];

export function dureeParId(id: string) {
  return DUREES.find((d) => d.id === id) ?? DUREES[1];
}

export function angleParId(id: string) {
  return ANGLES.find((a) => a.id === id) ?? ANGLES[0];
}
