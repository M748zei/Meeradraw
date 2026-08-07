import type { AncragePartie, Region } from "@/services/studio/types";

/**
 * L'ancrage africain (§0.1) — LE cœur du produit, découpé en TROIS parties
 * depuis le défaut du 07/08 (un soldat en pagne au milieu des uniformes, un
 * portrait studio posé dans un village) : une clause globale qui nomme une
 * chose l'injecte partout, exactement comme une négation.
 *
 *   personnes — peaux, traits, cheveux : ce qui fait la promesse du produit.
 *   decor     — matériaux, végétation, lumière du lieu.
 *   tenues    — l'habillement, SUBORDONNÉ AU RÔLE : les civils portent le wax,
 *               chaque personne porte la tenue de son rôle (un soldat porte
 *               l'uniforme complet de son armée et de son époque — les
 *               uniformes eux-mêmes viennent du pack d'époque).
 *
 * Chaque preset déclare ce qu'il prend : un portrait studio et un packshot ne
 * prennent que « personnes ». "monde" = décor non africain → tout est omis.
 */

const PERSONNES: Record<Exclude<Region, "monde">, string> = {
  ouest:
    "Black and brown skin, West and Central African features, natural coily hair, braids, locs or sharp short haircuts.",
  sahel:
    "Black and brown skin, West and Central African features, natural coily hair, braids, locs or sharp short haircuts.",
  cote:
    "Black and brown skin, West and Central African features, natural coily hair, braids, locs or sharp short haircuts.",
  foret:
    "Black and brown skin, West and Central African features, natural coily hair, braids, locs or sharp short haircuts.",
  est: "Black and brown skin, East African features, natural coily hair, braids or sharp short haircuts.",
  maghreb: "Olive to brown skin, North African features.",
};

const DECORS: Record<Exclude<Region, "monde">, string> = {
  ouest:
    "A sub-Saharan African setting of banco earth walls, corrugated metal roofs, painted concrete, red laterite soil, mango trees, acacias and shea trees; equatorial or Sahelian light.",
  sahel:
    "A Sahelian setting of banco earth architecture, dry laterite ground, sparse acacias and doum palms, wide open sky; vast dry Sahelian light.",
  cote: "A West African coastal setting of painted concrete, corrugated metal, fishing pirogues, coconut palms and mango trees; humid Atlantic light.",
  foret:
    "A Central African rainforest setting of red earth tracks, dense green canopy, plantain and giant kapok trees; soft light filtered through foliage.",
  est: "An East African setting of savanna grasslands, flat-topped acacias and distant volcanic highlands; clear highland light.",
  maghreb:
    "A Maghreb setting of whitewashed medina walls, zellige tiles, carved cedar wood and palm groves; dry luminous Mediterranean-Saharan light.",
};

const TENUES: Record<Exclude<Region, "monde">, string> = {
  ouest:
    "Civilians wear wax print, bazin, boubou, pagne or contemporary African urban fashion; every person wears the dress of their own role — a soldier wears the complete uniform of their army and era, a nurse her uniform, a judge his robe.",
  sahel:
    "Civilians wear boubou, bazin, indigo cloth or contemporary Sahelian fashion; every person wears the dress of their own role — a soldier wears the complete uniform of their army and era.",
  cote: "Civilians wear wax print, bazin, boubou or contemporary coastal urban fashion; every person wears the dress of their own role — a soldier wears the complete uniform of their army and era.",
  foret:
    "Civilians wear wax print, raffia cloth or contemporary urban fashion; every person wears the dress of their own role — a soldier wears the complete uniform of their army and era.",
  est: "Civilians wear kitenge, shuka cloth or contemporary East African urban fashion; every person wears the dress of their own role — a soldier wears the complete uniform of their army and era.",
  maghreb:
    "Civilians wear djellaba, kaftan, haik or contemporary Maghrebi fashion; every person wears the dress of their own role — a soldier wears the complete uniform of their army and era.",
};

const PARTIES: Record<AncragePartie, Record<Exclude<Region, "monde">, string>> = {
  personnes: PERSONNES,
  decor: DECORS,
  tenues: TENUES,
};

/**
 * Bloc d'ancrage : uniquement les parties que le preset déclare.
 * "" pour "monde" (décor non africain assumé) ou pour une liste vide.
 */
export function ancrageAfricain(
  region: Region = "ouest",
  parties: AncragePartie[] = ["personnes", "decor", "tenues"]
): string {
  if (region === "monde" || parties.length === 0) return "";
  return parties.map((p) => PARTIES[p][region]).join(" ");
}
