/**
 * Suite de tests MeeraDraw — compilateur de prompt. Pur, sans réseau.
 * Couvre : les 30 presets × toutes les heures × toutes les régions sans la
 * moindre négation (§0.2), l'ancrage africain injecté avant le sujet (§0.1),
 * les zones de texte réservées (§0.3), le pack d'époque et le mode avancé.
 */
import assert from "node:assert/strict";
import { compilerPrompt, trouverNegations } from "../services/studio/compiler";
import { PRESETS } from "../services/studio/presets";
import { ancrageAfricain } from "../services/studio/ancrage";
import { packEpoque } from "../services/studio/epoque";
import {
  CATEGORIES,
  HEURES,
  PRESET_IDS,
  REGIONS,
  type PresetId,
  type Region,
} from "../services/studio/types";

let total = 0;
let rate = 0;
function test(nom: string, fn: () => void) {
  total += 1;
  try {
    fn();
    console.log(`  ✓ ${nom}`);
  } catch (err) {
    rate += 1;
    console.error(`  ✗ ${nom}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

const SCENE = "Un homme d'affaires marche vers son bureau au petit matin";

console.log("Catalogue");
test("30 presets, tous complets, répartis dans les 6 familles", () => {
  assert.equal(PRESET_IDS.length, 30, "30 identifiants");
  const parCategorie = new Map<string, number>();
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    assert.ok(p, `${id} présent`);
    assert.ok(p.rendu && p.lumiere && p.cadre && p.format && p.nom, `${id} complet`);
    parCategorie.set(p.categorie, (parCategorie.get(p.categorie) ?? 0) + 1);
  }
  assert.equal(parCategorie.size, CATEGORIES.length, "6 familles utilisées");
});

test("les 30 presets produisent 30 prompts distincts", () => {
  const prompts = PRESET_IDS.map((id) =>
    compilerPrompt({ scene: SCENE, preset: id, format: PRESETS[id].format })
  );
  assert.equal(new Set(prompts).size, 30);
});

console.log("La règle des négations — 30 presets × heures × régions");
test("aucune négation, toutes combinaisons (30 × 5 heures × 7 régions = 1050 prompts)", () => {
  let compte = 0;
  for (const id of PRESET_IDS) {
    for (const heure of [undefined, ...HEURES] as const) {
      for (const region of REGIONS) {
        const p = compilerPrompt({
          scene: SCENE,
          annee: 1975,
          lieu: "Abidjan",
          preset: id as PresetId,
          heure,
          region: region as Region,
          format: "9:16",
        });
        const negations = trouverNegations(p);
        assert.deepEqual(negations, [], `${id}/${heure ?? "native"}/${region} : ${negations.join(", ")}`);
        compte += 1;
      }
    }
  }
  assert.equal(compte, 30 * 5 * 7, `${compte} prompts vérifiés`);
});

console.log("L'ancrage africain — le cœur du produit (§0.1)");
test("injecté par défaut, AVANT le sujet", () => {
  const p = compilerPrompt({ scene: SCENE, preset: "portrait-pro", format: "1:1" });
  assert.ok(p.includes("West and Central African features"), "bloc de base présent");
  assert.ok(
    p.indexOf("African features") < p.indexOf(`The scene: ${SCENE}`),
    "l'ancrage précède le sujet"
  );
});
test("chaque région remplace matériaux et végétation", () => {
  const attendus: Record<Exclude<Region, "monde">, string> = {
    ouest: "banco earth walls",
    sahel: "doum palms",
    cote: "fishing pirogues",
    foret: "kapok trees",
    est: "flat-topped acacias",
    maghreb: "zellige tiles",
  };
  for (const [region, marqueur] of Object.entries(attendus)) {
    const p = compilerPrompt({ scene: SCENE, preset: "portrait-pro", region: region as Region, format: "1:1" });
    assert.ok(p.includes(marqueur), `${region} → « ${marqueur} »`);
  }
});
test("région « monde » (décor non africain explicite) → bloc omis", () => {
  const p = compilerPrompt({ scene: SCENE, preset: "portrait-pro", region: "monde", format: "1:1" });
  assert.ok(!p.includes("African features"), "ancrage absent");
  assert.equal(ancrageAfricain("monde"), "");
});
test("les 6 blocs régionaux sont eux-mêmes affirmatifs", () => {
  for (const region of REGIONS) {
    assert.deepEqual(trouverNegations(ancrageAfricain(region as Region)), [], region);
  }
});

console.log("Zones de texte réservées (§0.3)");
test("les 7 presets [zone de texte] réservent une plage vide dans le prompt", () => {
  const marques = PRESET_IDS.filter((id) => PRESETS[id].zoneTexte);
  assert.deepEqual(
    marques.sort(),
    ["affiche-religieuse", "affiche-resistance", "flyer-promo", "fond-citation", "hommage", "miniature-video", "motivation"].sort(),
    "la liste des presets marqués"
  );
  for (const id of marques) {
    const p = compilerPrompt({ scene: SCENE, preset: id, format: PRESETS[id].format });
    assert.ok(/empty/i.test(p), `${id} : plage vide décrite dans le prompt`);
    assert.ok(/text overlay/i.test(p), `${id} : réservée pour l'incrustation`);
  }
});

console.log("Époque, heures, mode avancé");
test("année présente → pack de la période ; absente → intemporel", () => {
  const p1916 = compilerPrompt({ scene: SCENE, annee: 1916, preset: "document-epoque", format: "4:5" });
  assert.ok(p1916.includes("hand-crank automobiles"));
  const sans = compilerPrompt({ scene: SCENE, preset: "document-epoque", format: "4:5" });
  assert.ok(sans.includes("Timeless enduring world"));
  assert.deepEqual(trouverNegations(packEpoque(1943, "Dakar")), []);
});
test("changer l'heure ajoute l'ambiance temporelle, le reste ne bouge pas", () => {
  const natif = compilerPrompt({ scene: SCENE, preset: "nuit-archive", format: "9:16" });
  const aube = compilerPrompt({ scene: SCENE, preset: "nuit-archive", heure: "aube", format: "9:16" });
  assert.notEqual(natif, aube);
  assert.ok(aube.includes("takes place at dawn"));
  assert.ok(aube.includes(PRESETS["nuit-archive"].rendu), "le rendu reste");
});
test("mode avancé : le prompt libre atterrit APRÈS l'ancrage et le preset", () => {
  const libre = "shot on expired kodak film stock";
  const p = compilerPrompt({ scene: SCENE, preset: "portrait-pro", format: "1:1", promptLibre: libre });
  assert.ok(p.trimEnd().endsWith(`${libre}.`), "le prompt libre est le DERNIER bloc");
  assert.ok(p.indexOf("African features") < p.indexOf(libre), "après l'ancrage");
  assert.ok(p.indexOf(PRESETS["portrait-pro"].cadre) < p.indexOf(libre), "après le preset");
});
test("scène vide → erreur claire", () => {
  assert.throws(() => compilerPrompt({ scene: "  ", preset: "mariage", format: "4:5" }));
});

console.log(`\n${total - rate}/${total} tests verts`);
if (rate > 0) process.exit(1);
