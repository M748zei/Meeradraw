/**
 * Le pack d'époque — la table année → monde matériel plausible.
 * C'est lui qui fait qu'une scène de 1916 au Niger ne ressemble pas à 1988 à
 * Paris : véhicules, vêtements, matériaux et sources de lumière de la période.
 * Tout est AFFIRMATIF : on décrit ce qui existe, jamais ce qui est absent.
 */

interface PackEpoque {
  /** Bornes incluses. */
  de: number;
  a: number;
  elements: string;
}

const PACKS: PackEpoque[] = [
  {
    de: 0,
    a: 1899,
    elements:
      "Pre-colonial and early era world: riders and pack animals, wooden carts, hand-forged tools, flowing robes and woven cloth, earthen and stone architecture, thatch and carved wood, firelight, oil lamps and torches as the only lights.",
  },
  {
    de: 1900,
    a: 1929,
    elements:
      "Early twentieth century world: rare hand-crank automobiles and steam engines, colonial-era uniforms and pith helmets beside traditional robes, brass and rivets, telegraph poles, kerosene lanterns and early arc lamps, packed-earth roads and new rail lines.",
  },
  {
    de: 1930,
    a: 1949,
    elements:
      "Nineteen-thirties and forties world: round-fendered trucks and rare sedans, wartime canvas and leather gear beside boubous and wax cloth, shortwave radios, bakelite and riveted steel, kerosene lamps and the first bare electric bulbs on wooden poles.",
  },
  {
    de: 1950,
    a: 1969,
    elements:
      "Fifties and sixties world: chrome-trimmed round sedans, bicycles everywhere, independence-era suits and vivid boubous, transistor radios, hand-painted shop signs, early neon and bare bulbs, freshly painted concrete beside colonial facades.",
  },
  {
    de: 1970,
    a: 1989,
    elements:
      "Seventies and eighties world: Peugeot 404 and 504 sedans and pickups, mopeds and motorbikes, bold wax-print fabrics and flared tailoring, cassette radios, fluorescent tubes over shopfronts, hand-painted advertising murals, dusty asphalt.",
  },
  {
    de: 1990,
    a: 2005,
    elements:
      "Nineties and early two-thousands world: bush taxis and minibuses loaded high, small motorbikes, phone-call kiosks and satellite dishes, printed polo shirts beside boubous, bare bulbs and buzzing fluorescent light, painted concrete storefronts.",
  },
];

const PACK_INTEMPOREL =
  "Timeless enduring world: materials of stone, earth, wood and cloth, every object and garment consistent with the scene's own period.";

export function packEpoque(annee?: number, lieu?: string): string {
  const morceaux: string[] = [];
  if (typeof annee === "number" && Number.isFinite(annee)) {
    const pack = PACKS.find((p) => annee >= p.de && annee <= p.a);
    morceaux.push(pack ? pack.elements : PACK_INTEMPOREL);
    morceaux.push(`Every vehicle, garment, material and light source belongs to the year ${annee}.`);
  } else {
    morceaux.push(PACK_INTEMPOREL);
  }
  if (lieu && lieu.trim()) {
    morceaux.push(`The scene is set in ${lieu.trim()}, its architecture, landscape and light true to that place.`);
  }
  return morceaux.join(" ");
}
