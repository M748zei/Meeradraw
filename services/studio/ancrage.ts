import type { Region } from "@/services/studio/types";

/**
 * L'ancrage africain (§0.1) — LE cœur du produit. Injecté avant le sujet dans
 * tous les prompts. Tapé ailleurs, « un homme d'affaires » donne un blanc à
 * New York ; ici, un homme noir à Abidjan. C'est la publicité, et c'est le
 * produit.
 *
 * Le réglage de région remplace les matériaux et la végétation du bloc.
 * "monde" = décor explicitement non africain → bloc omis. Tout est affirmatif.
 */

const GENS_SUBSAHARIENS =
  "Black and brown skin, West and Central African features, natural coily hair, braids, locs or sharp short haircuts";
const TENUES_SUBSAHARIENNES =
  "clothing of wax print, bazin, boubou, pagne or contemporary African urban fashion";

const BLOCS: Record<Exclude<Region, "monde">, string> = {
  ouest: `${GENS_SUBSAHARIENS}; ${TENUES_SUBSAHARIENNES}; a sub-Saharan African setting of banco earth walls, corrugated metal roofs, painted concrete, red laterite soil, mango trees, acacias and shea trees; equatorial or Sahelian light.`,
  sahel: `${GENS_SUBSAHARIENS}; ${TENUES_SUBSAHARIENNES}; a Sahelian setting of banco earth architecture, dry laterite ground, sparse acacias and doum palms, wide open sky; vast dry Sahelian light.`,
  cote: `${GENS_SUBSAHARIENS}; ${TENUES_SUBSAHARIENNES}; a West African coastal setting of painted concrete, corrugated metal, fishing pirogues, coconut palms and mango trees; humid Atlantic light.`,
  foret: `${GENS_SUBSAHARIENS}; ${TENUES_SUBSAHARIENNES}; a Central African rainforest setting of red earth tracks, dense green canopy, plantain and giant kapok trees; soft light filtered through foliage.`,
  est: `Black and brown skin, East African features, natural coily hair, braids or sharp short haircuts; clothing of kitenge, shuka cloth or contemporary East African urban fashion; an East African setting of savanna grasslands, flat-topped acacias and distant volcanic highlands; clear highland light.`,
  maghreb: `Olive to brown skin, North African features; clothing of djellaba, kaftan, haik or contemporary Maghrebi fashion; a Maghreb setting of whitewashed medina walls, zellige tiles, carved cedar wood and palm groves; dry luminous Mediterranean-Saharan light.`,
};

/** Bloc d'ancrage pour une région ("" pour "monde" : décor non africain assumé). */
export function ancrageAfricain(region: Region = "ouest"): string {
  if (region === "monde") return "";
  return BLOCS[region];
}
