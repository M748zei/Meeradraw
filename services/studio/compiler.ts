import { PRESETS, CAMERA_COMMUNE } from "@/services/studio/presets";
import { packEpoque } from "@/services/studio/epoque";
import type { CompilerInput } from "@/services/studio/types";

/**
 * Le compilateur de prompt — un module pur, sans réseau (§4 du brief).
 *
 * Assemble : rendu + lumière + scène + pack d'époque + caméra + atmosphère +
 * étalonnage. L'utilisateur ne voit jamais cette chaîne : il décrit une scène
 * en français, le style vient du preset.
 *
 * Règle non négociable no 1 : AUCUNE formulation négative. Un modèle de
 * diffusion ne soustrait pas — nommer une chose pour l'interdire, c'est
 * l'injecter. La suite de tests échoue si une négation apparaît ici.
 */
export function compilerPrompt(input: CompilerInput): string {
  const preset = PRESETS[input.preset];
  if (!preset) {
    throw new Error(`Preset inconnu : ${input.preset}`);
  }
  const scene = input.scene.replace(/\s+/g, " ").trim();
  if (!scene) {
    throw new Error("La scène est obligatoire.");
  }
  const heure = input.heure ?? preset.heureNative;
  const lumiere = preset.lumiere[heure];

  return [
    preset.rendu,
    lumiere,
    `The scene: ${scene}.`,
    packEpoque(input.annee, input.lieu),
    CAMERA_COMMUNE,
    preset.sol,
    preset.atmosphere,
    preset.etalonnage,
  ]
    .map((bloc) => bloc.trim().replace(/\.?$/, "."))
    .join(" ");
}

/**
 * Négations interdites dans un prompt compilé — vérifiées par la suite de
 * tests sur les six presets (anglais ET français, on écrit dans les deux).
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
