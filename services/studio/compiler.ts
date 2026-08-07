import { PRESETS } from "@/services/studio/presets";
import { packEpoque } from "@/services/studio/epoque";
import { ancrageAfricain } from "@/services/studio/ancrage";
import type { CompilerInput, Heure, Preset, Saisie } from "@/services/studio/types";

/**
 * Le compilateur de prompt — un module pur, sans réseau.
 *
 * Ordre d'assemblage (§5 du parcours v2) :
 *   ancrage africain (+ région)
 *   + rendu(preset) + lumière(preset, heure)
 *   + SUJET ← phrase + personnages + objets + champs texte, dans cet ordre
 *   + pack d'époque(année) + lieu
 *   + cadre(preset : caméra, atmosphère, étalonnage)
 *   + prompt libre du mode avancé (toujours en DERNIER)
 *
 * LA RÈGLE QUI PROTÈGE LA QUALITÉ (§4) : le preset gagne toujours sur le
 * rendu, l'utilisateur gagne toujours sur le contenu. Les saisies n'alimentent
 * QUE le bloc sujet — jamais rendu, lumière, caméra, atmosphère, étalonnage.
 * Un test échoue si cette règle casse.
 *
 * Règle des négations (§0.2) : aucune négation dans le prompt final. Une
 * clause négative SAISIE par l'utilisateur est retirée, pas transmise.
 */

/** « Changer l'heure du jour » — ambiance temporelle ajoutée à la lumière du preset. */
const BLOCS_HEURE: Record<Heure, string> = {
  nuit: "The scene takes place at night, deep darkness settling beyond the described light.",
  aube: "The scene takes place at dawn, cool first light seeping into the air.",
  jour: "The scene takes place in full daylight.",
  crepuscule: "The scene takes place at dusk, the last warm light fading fast.",
};

/**
 * Clauses négatives : retirées des saisies (jamais transmises au modèle).
 * La clause = la négation + son objet court (déterminant + nom + un
 * complément éventuel), pas le reste de la phrase — « un homme sans chapeau
 * marche » doit rendre « un homme marche ».
 */
const OBJET_COURT =
  "(?:(?:le|la|les|l'|un|une|des|de|d')\\s+)?\\S+(?:\\s+(?:à|de|d'|du|des|en)\\s+\\S+)?";
const CLAUSES_NEGATIVES = [
  new RegExp(`\\bsans\\s+${OBJET_COURT}`, "gi"),
  new RegExp(`\\baucune?\\s+${OBJET_COURT}`, "gi"),
  new RegExp(`\\bjamais\\s+(?:de\\s+|d')?${OBJET_COURT}`, "gi"),
  new RegExp(`\\bpas\\s+(?:de\\s+|d')${OBJET_COURT}`, "gi"),
  new RegExp(`\\bno\\s+${OBJET_COURT}`, "gi"),
  new RegExp(`\\bnot\\s+${OBJET_COURT}`, "gi"),
  new RegExp(`\\bwithout\\s+${OBJET_COURT}`, "gi"),
  new RegExp(`\\bnever\\s+${OBJET_COURT}`, "gi"),
  new RegExp(`\\bavoid\\s+${OBJET_COURT}`, "gi"),
];

/**
 * Clauses de lumière/moment saisies par l'utilisateur : ignorées (§4 —
 * « en plein jour » sur nuit-archive ne passe pas). La lumière vient du
 * preset, et de lui seul.
 */
const CLAUSES_LUMIERE = [
  /\ben plein(e)? (jour|nuit)\b/gi,
  /\b(la|de) nuit\b/gi,
  /\ble jour\b/gi,
  /\bau crépuscule\b/gi,
  /\bà l'aube\b/gi,
  /\b(sous|au) (le )?soleil\b/gi,
  /\bdans le noir\b/gi,
  /\béclairé(e|s|es)? par [^,.;]+/gi,
  /\b(en )?contre-jour\b/gi,
  /\blumière [^,.;]+/gi,
];

/** Nettoie UNE saisie utilisateur : négations retirées, lumière retirée. */
export function nettoyerSaisie(texte: string | undefined): string {
  if (!texte) return "";
  let net = texte.replace(/\s+/g, " ").trim();
  for (const r of [...CLAUSES_NEGATIVES, ...CLAUSES_LUMIERE]) {
    net = net.replace(r, " ");
  }
  return net
    .replace(/\s+([,.;])/g, "$1")
    .replace(/([,.;])\s*(?:[,.;]\s*)+/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;]+|[\s,.;]+$/g, "")
    .trim();
}

/**
 * Construit le bloc SUJET — le seul bloc que l'utilisateur alimente.
 * Vide, le modèle décide (le bloc disparaît). Rempli, il obéit.
 */
export function construireSujet(saisie: Saisie, preset: Preset): string {
  const morceaux: string[] = [];

  const phrase = nettoyerSaisie(saisie.phrase);
  if (phrase) morceaux.push(`The scene: ${phrase}.`);

  const maxPersonnages =
    preset.champs.find((c) => c.type === "personnages")?.type === "personnages"
      ? (preset.champs.find((c) => c.type === "personnages") as { max: number }).max
      : 3;
  const personnages = (saisie.personnages ?? [])
    .slice(0, maxPersonnages)
    .map((p) => {
      const role = nettoyerSaisie(p.role);
      const tenue = nettoyerSaisie(p.tenue);
      const action = nettoyerSaisie(p.action);
      if (!role && !tenue && !action) return "";
      // La tenue se subordonne au rôle : un rôle militaire SANS tenue saisie
      // reçoit son uniforme (les uniformes exacts viennent du pack d'époque).
      const militaire = /\b(soldats?|militaires?|gendarmes?|polici(er|ers|ère|ères)s?|officiers?|gardes?|soldiers?|officers?)\b/i.test(role);
      const habit = tenue
        ? `vêtu(e) de ${tenue}`
        : militaire
          ? "en uniforme complet de son armée et de son époque"
          : "";
      return [role || "une personne", habit, action].filter(Boolean).join(", ");
    })
    .filter(Boolean);
  if (personnages.length) {
    morceaux.push(`Les personnages : ${personnages.join(" ; ")}.`);
  }

  const objets = (saisie.objets ?? []).map((o) => nettoyerSaisie(o)).filter(Boolean);
  if (objets.length) {
    morceaux.push(`Présents dans la scène : ${objets.join(", ")}.`);
  }

  // Champs texte : uniquement ceux que le preset déclare, dans son ordre.
  for (const champ of preset.champs) {
    if (champ.type !== "texte") continue;
    const valeur = nettoyerSaisie(saisie.textes?.[champ.cle]);
    if (valeur) morceaux.push(`${champ.label} : ${valeur}.`);
  }

  return morceaux.join(" ");
}

/**
 * Bloc sujet du mode composite (chantier 4) : le décor SEUL, avec une zone
 * libre pour reposer le produit détouré. Le champ texte « produit » est ignoré
 * (le vrai produit arrive en pixels) ; couleur et support s'appliquent.
 */
export function construireDecorProduit(saisie: Saisie, preset: Preset): string {
  const morceaux: string[] = [
    "The foreground holds a clean, well-lit, EMPTY display area reserved for a product that will be placed there later.",
  ];
  const phrase = nettoyerSaisie(saisie.phrase);
  if (phrase) morceaux.push(`The scene around it: ${phrase}.`);
  for (const champ of preset.champs) {
    if (champ.type !== "texte" || champ.cle === "produit") continue;
    const valeur = nettoyerSaisie(saisie.textes?.[champ.cle]);
    if (valeur) morceaux.push(`${champ.label} : ${valeur}.`);
  }
  return morceaux.join(" ");
}

export function compilerPrompt(input: CompilerInput): string {
  const preset = PRESETS[input.preset];
  if (!preset) {
    throw new Error(`Preset inconnu : ${input.preset}`);
  }

  // Le seul champ obligatoire : la phrase, quand le preset la déclare.
  const declarePhrase = preset.champs.some((c) => c.type === "phrase");
  if (declarePhrase && nettoyerSaisie(input.saisie.phrase).length < 8) {
    throw new Error("La phrase est obligatoire pour ce style — décris ta scène.");
  }

  const sujet = input.decorProduit
    ? construireDecorProduit(input.saisie, preset)
    : construireSujet(input.saisie, preset);

  // Chantier 5 §2 — un selfie fourni : la partie « personnes » de l'ancrage se
  // retire, sinon elle écrase le visage réel. Même retrait en décor-produit :
  // vu à l'image le 07/08, elle imposait des figurants derrière un packshot.
  const partiesAncrage =
    input.avecSelfie || input.decorProduit
      ? preset.ancrage.filter((a) => a !== "personnes")
      : preset.ancrage;

  const blocs = [
    // L'ancrage africain d'abord (§5) — uniquement les parties que le preset
    // déclare (un portrait studio ne prend que « personnes »).
    ancrageAfricain(input.region, partiesAncrage),
    preset.rendu,
    preset.lumiere,
    input.heure ? BLOCS_HEURE[input.heure] : "",
    // Le SUJET — le seul bloc nourri par l'utilisateur (§4).
    sujet,
    packEpoque(input.saisie.annee, input.saisie.lieu),
    preset.cadre,
    // Mode avancé : la seule échappatoire, toujours en dernier.
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
