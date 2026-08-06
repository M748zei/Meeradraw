/**
 * Suite de tests du Scarabée Studio — compilateur de prompt (§4 du brief).
 * Pur, sans réseau. Échoue notamment si un prompt compilé contient une
 * négation (`no `, `not `, `without`, `never`, `avoid` + équivalents français).
 */
import assert from "node:assert/strict";
import { compilerPrompt, trouverNegations } from "../services/studio/compiler";
import { PRESETS } from "../services/studio/presets";
import { PRESET_IDS, HEURES, type PresetId } from "../services/studio/types";
import { packEpoque } from "../services/studio/epoque";

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

const SCENE = "Un homme seul marche vers l'agence de la banque, la nuit, sous la pluie";

console.log("Compilateur — assemblage");
test("preset appliqué : le prompt contient rendu, lumière, caméra, étalonnage", () => {
  const p = compilerPrompt({ scene: SCENE, preset: "nuit-archive", format: "9:16" });
  const preset = PRESETS["nuit-archive"];
  assert.ok(p.includes(preset.rendu), "bloc rendu présent");
  assert.ok(p.includes(preset.lumiere.nuit.slice(0, 40)), "bloc lumière (heure native) présent");
  assert.ok(p.includes("35mm lens"), "caméra commune présente");
  assert.ok(p.includes("teal shadows and amber highlights"), "étalonnage présent");
  assert.ok(p.includes(SCENE), "la scène de l'utilisateur est dedans, telle quelle");
});

test("année absente → pack intemporel, et l'année ne surgit pas de nulle part", () => {
  const p = compilerPrompt({ scene: SCENE, preset: "nuit-archive", format: "9:16" });
  assert.ok(p.includes("Timeless enduring world"), "pack intemporel");
  assert.ok(!/\b(19|20)\d{2}\b/.test(p), "aucune année inventée");
});

test("année présente → le pack de la période et l'ancrage à l'année", () => {
  const p1916 = compilerPrompt({ scene: SCENE, annee: 1916, preset: "nuit-archive", format: "9:16" });
  assert.ok(p1916.includes("hand-crank automobiles"), "pack 1900-1929 pour 1916");
  assert.ok(p1916.includes("belongs to the year 1916"), "ancrage explicite");
  const p1988 = compilerPrompt({ scene: SCENE, annee: 1988, preset: "nuit-archive", format: "9:16" });
  assert.ok(p1988.includes("Peugeot 404 and 504"), "pack 1970-1989 pour 1988");
  assert.ok(!p1988.includes("hand-crank"), "1916 et 1988 sont deux mondes différents");
});

test("lieu absent → aucune mention de lieu ; lieu présent → ancré", () => {
  const sans = compilerPrompt({ scene: SCENE, preset: "heure-doree", format: "1:1" });
  assert.ok(!sans.includes("The scene is set in"), "sans lieu, la phrase de lieu est absente");
  const avec = compilerPrompt({ scene: SCENE, lieu: "Bouaké, Côte d'Ivoire", preset: "heure-doree", format: "1:1" });
  assert.ok(avec.includes("set in Bouaké, Côte d'Ivoire"), "le lieu est ancré");
});

test("les six presets produisent six prompts distincts", () => {
  const prompts = PRESET_IDS.map((id) =>
    compilerPrompt({ scene: SCENE, preset: id, format: "9:16" })
  );
  assert.equal(new Set(prompts).size, 6, "6 prompts uniques");
});

console.log("Compilateur — la règle des négations");
test("aucune négation dans les six presets (toutes heures confondues)", () => {
  for (const id of PRESET_IDS) {
    for (const heure of HEURES) {
      const p = compilerPrompt({ scene: SCENE, annee: 1953, lieu: "Niamey", preset: id as PresetId, heure, format: "16:9" });
      const negations = trouverNegations(p);
      assert.deepEqual(negations, [], `${id}/${heure} contient : ${negations.join(", ")}`);
    }
  }
});

test("les packs d'époque eux-mêmes sont affirmatifs", () => {
  for (const annee of [1850, 1916, 1943, 1960, 1988, 1999, 2020, undefined]) {
    const bloc = packEpoque(annee, "Dakar");
    assert.deepEqual(trouverNegations(bloc), [], `pack ${annee ?? "intemporel"}`);
  }
});

console.log("Compilateur — garde-fous");
test("scène vide → erreur claire", () => {
  assert.throws(() => compilerPrompt({ scene: "   ", preset: "nuit-archive", format: "9:16" }));
});
test("changer l'heure du jour change le bloc lumière et rien d'autre", () => {
  const nuit = compilerPrompt({ scene: SCENE, preset: "nuit-archive", heure: "nuit", format: "9:16" });
  const jour = compilerPrompt({ scene: SCENE, preset: "nuit-archive", heure: "jour", format: "9:16" });
  assert.notEqual(nuit, jour, "la lumière change");
  assert.ok(jour.includes(PRESETS["nuit-archive"].rendu), "le rendu reste");
  assert.ok(jour.includes(PRESETS["nuit-archive"].etalonnage), "l'étalonnage reste");
});
test("la caméra n'est pas réglable : plan large + trois-quarts dans les six presets", () => {
  for (const id of PRESET_IDS) {
    const p = compilerPrompt({ scene: SCENE, preset: id as PresetId, format: "9:16" });
    assert.ok(p.includes("wide or medium-wide framing"), `${id}: plan large`);
    assert.ok(p.includes("three-quarters behind or from the back"), `${id}: trois-quarts/dos`);
  }
});

console.log(`\n${total - rate}/${total} tests verts`);
if (rate > 0) process.exit(1);
