import { PRESETS } from "@/services/studio/presets";
import { packEpoque } from "@/services/studio/epoque";
import { ancrageAfricain } from "@/services/studio/ancrage";
import type { CompilerInput, Heure } from "@/services/studio/types";

/**
 * Le compilateur de prompt — un module pur, sans réseau.
 *
 * Assemble : rendu + lumière (+ heure) + ANCRAGE AFRICAIN + scène + époque +
 * cadre (+ prompt libre du mode avancé, toujours en DERNIER). L'utilisateur
 * ordinaire ne voit jamais cette chaîne : il décrit une scène en français,
 * le style vient du preset, l'ancrage vient de la région.
 *
 * Règle non négociable (§0.2) : AUCUNE formulation négative. Un modèle de
 * diffusion ne soustrait pas — nommer une chose pour l'interdire, c'est
 * l'injecter. La suite de tests échoue si une négation apparaît ici.
 */

/** « Changer l'heure du jour » — ambiance temporelle ajoutée à la lumière du preset. */
const BLOCS_HEURE: Record<Heure, string> = {
  nuit: "The scene takes place at night, deep darkness settling beyond the described light.",
  aube: "The scene takes place at dawn, cool first light seeping into the air.",
  jour: "The scene takes place in full daylight.",
  crepuscule: "The scene takes place at dusk, the last warm light fading fast.",
};

export function compilerPrompt(input: CompilerInput): string {
  const preset = PRESETS[input.preset];
  if (!preset) {
    throw new Error(`Preset inconnu : ${input.preset}`);
  }
  const scene = input.scene.replace(/\s+/g, " ").trim();
  if (!scene) {
    throw new Error("La scène est obligatoire.");
  }

  const blocs = [
    preset.rendu,
    preset.lumiere,
    input.heure ? BLOCS_HEURE[input.heure] : "",
    // L'ancrage africain, AVANT le sujet (§0.1).
    ancrageAfricain(input.region),
    `The scene: ${scene}.`,
    packEpoque(input.annee, input.lieu),
    preset.cadre,
    // Mode avancé : le prompt libre s'ajoute APRÈS l'ancrage et le preset.
    input.promptLibre?.trim() ?? "",
  ];

  return blocs
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => b.replace(/\.?$/, "."))
    .join(" ");
}

/**
 * Négations interdites dans un prompt compilé (§0.2) — vérifiées par la suite
 * de tests sur les 30 presets × toutes les heures × toutes les régions.
 */
export const NEGATIONS_INTERDITES = [
  /\bno\s/i,
  /\bnot\s/i,
  /\bwithout\b/i,
  /\bnever\b/i,
  /\bavoid\b/i,
  /\bsans\b/i,
  /\baucun(e)?\b/i,
  /\bjamais\b/i,
  /\bpas de\b/i,
];

export function trouverNegations(prompt: string): string[] {
  return NEGATIONS_INTERDITES.filter((r) => r.test(prompt)).map((r) => String(r));
}
