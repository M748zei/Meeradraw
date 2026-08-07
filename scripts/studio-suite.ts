/**
 * Suite de tests MeeraDraw v2 — compilateur de prompt. Pur, sans réseau.
 * Couvre : la règle du §4 (les saisies n'alimentent QUE le bloc sujet — un
 * test échoue si une saisie touche rendu/lumière/caméra/atmosphère/étalonnage),
 * les négations SAISIES retirées, les 30 presets × heures × régions sans
 * négation, l'ancrage africain, les zones de texte, les champs déclarés.
 */
import assert from "node:assert/strict";
import {
  compilerPrompt,
  construireSujet,
  nettoyerSaisie,
  trouverNegations,
} from "../services/studio/compiler";
import { PRESETS } from "../services/studio/presets";
import { ancrageAfricain } from "../services/studio/ancrage";
import {
  CATEGORIES,
  HEURES,
  PRESET_IDS,
  REGIONS,
  type PresetId,
  type Region,
  type Saisie,
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

/** Saisie de démonstration acceptée par tous les presets. */
function saisieDemo(id: PresetId): Saisie {
  const p = PRESETS[id];
  const s: Saisie = {};
  for (const c of p.champs) {
    if (c.type === "phrase") s.phrase = "Un homme sort de sa voiture devant sa maison";
    if (c.type === "personnages") s.personnages = [{ role: "un soldat", tenue: "chemise bleue", action: "il attend dans la cour" }];
    if (c.type === "objets") s.objets = ["une berline grise"];
    if (c.type === "texte") s.textes = { ...s.textes, [c.cle]: "valeur d'essai" };
    if (c.type === "annee") s.annee = 1973;
    if (c.type === "lieu") s.lieu = "Conakry";
  }
  return s;
}

console.log("La règle du §4 — le preset gagne sur le rendu, l'utilisateur sur le contenu");
test("une saisie n'atterrit JAMAIS dans rendu, lumière, caméra, atmosphère ou étalonnage", () => {
  const SENTINELLE = "zanzibarwax73";
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    const s = saisieDemo(id);
    // La sentinelle injectée dans chaque champ utilisateur possible.
    if (s.phrase) s.phrase = `Un homme ${SENTINELLE} marche vers la maison`;
    if (s.personnages) s.personnages = [{ role: `un soldat ${SENTINELLE}`, tenue: SENTINELLE, action: SENTINELLE }];
    if (s.objets) s.objets = [`une berline ${SENTINELLE}`];
    if (s.textes) for (const k of Object.keys(s.textes)) s.textes[k] = SENTINELLE;
    if (s.lieu) s.lieu = SENTINELLE;
    const prompt = compilerPrompt({ preset: id, saisie: s, format: p.format });
    // 1. Les blocs du preset restent VERBATIM — si quelqu'un y interpole une
    //    saisie, l'égalité stricte casse et ce test échoue.
    assert.ok(prompt.includes(p.rendu), `${id} : bloc rendu intact`);
    assert.ok(prompt.includes(p.lumiere), `${id} : bloc lumière intact`);
    assert.ok(prompt.includes(p.cadre), `${id} : bloc cadre (caméra/atmosphère/étalonnage) intact`);
    // 2. La sentinelle vit UNIQUEMENT entre la lumière et le cadre (bloc sujet
    //    + époque/lieu), jamais avant la fin de la lumière ni après le début du cadre.
    const finLumiere = prompt.indexOf(p.lumiere) + p.lumiere.length;
    const debutCadre = prompt.indexOf(p.cadre);
    let pos = prompt.indexOf(SENTINELLE);
    assert.ok(pos !== -1, `${id} : la saisie est bien transmise`);
    while (pos !== -1) {
      assert.ok(pos > finLumiere && pos < debutCadre, `${id} : sentinelle hors du bloc sujet (pos ${pos})`);
      pos = prompt.indexOf(SENTINELLE, pos + 1);
    }
  }
});

test("une clause négative SAISIE est retirée, pas transmise", () => {
  assert.equal(nettoyerSaisie("un homme sans chapeau marche"), "un homme marche");
  assert.equal(nettoyerSaisie("chemise bleue, pas de cravate, pantalon noir"), "chemise bleue, pantalon noir");
  assert.equal(nettoyerSaisie("aucun véhicule dans la rue"), "dans la rue");
  const prompt = compilerPrompt({
    preset: "nuit-archive",
    saisie: { phrase: "Un homme sans chapeau marche vers la maison, jamais de foule autour" },
    format: "9:16",
  });
  assert.deepEqual(trouverNegations(prompt), [], "le prompt final reste affirmatif");
  assert.ok(!prompt.includes("chapeau"), "la clause négative a disparu avec son objet");
});

test("une clause de lumière saisie est ignorée — la lumière vient du preset (§4)", () => {
  const prompt = compilerPrompt({
    preset: "nuit-archive",
    saisie: { phrase: "Un homme marche vers la banque en plein jour, sous le soleil" },
    format: "9:16",
  });
  assert.ok(!/en plein jour|sous le soleil/i.test(prompt), "les clauses de lumière saisies sont retirées");
  assert.ok(prompt.includes(PRESETS["nuit-archive"].lumiere), "la lumière du preset est intacte");
});

console.log("Les champs déclarés (§3)");
test("30 presets déclarent leurs champs ; la phrase est le seul champ obligatoire", () => {
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    assert.ok(p.champs.length >= 1, `${id} : au moins un champ`);
    const declarePhrase = p.champs.some((c) => c.type === "phrase");
    if (declarePhrase) {
      assert.throws(
        () => compilerPrompt({ preset: id, saisie: {}, format: p.format }),
        /phrase est obligatoire/,
        `${id} : phrase déclarée → obligatoire`
      );
    } else {
      // Vide, le modèle décide : le preset seul compile.
      const prompt = compilerPrompt({ preset: id, saisie: {}, format: p.format });
      assert.ok(prompt.includes(p.rendu), `${id} : compile sans aucune saisie`);
    }
  }
});
test("nuit-archive plafonne les personnages à 2 (§6)", () => {
  const champ = PRESETS["nuit-archive"].champs.find((c) => c.type === "personnages");
  assert.ok(champ && champ.type === "personnages" && champ.max === 2);
  const sujet = construireSujet(
    {
      phrase: "Un homme sort de sa voiture",
      personnages: [{ role: "a" }, { role: "b" }, { role: "c" }],
    },
    PRESETS["nuit-archive"]
  );
  assert.ok(!/\bc\b/.test(sujet), "le 3e personnage est plafonné");
});
test("un personnage = rôle · tenue · action ; un objet = une ligne", () => {
  const sujet = construireSujet(
    {
      personnages: [{ role: "un soldat", tenue: "chemise bleue", action: "il sort de la voiture" }],
      objets: ["une berline grise"],
    },
    PRESETS["portrait-pro"]
  );
  assert.ok(sujet.includes("un soldat, vêtu(e) de chemise bleue, il sort de la voiture"));
  assert.ok(sujet.includes("une berline grise"));
});

console.log("La règle des négations — 30 presets × heures × régions");
test("aucune négation, toutes combinaisons (30 × 5 heures × 7 régions = 1050 prompts)", () => {
  let compte = 0;
  for (const id of PRESET_IDS) {
    for (const heure of [undefined, ...HEURES] as const) {
      for (const region of REGIONS) {
        const p = compilerPrompt({
          preset: id as PresetId,
          saisie: saisieDemo(id),
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

console.log("L'ancrage africain (§0.1) et l'ordre du §5");
test("l'ancrage ouvre le prompt, le sujet vient après la lumière", () => {
  const p = compilerPrompt({ preset: "nuit-archive", saisie: saisieDemo("nuit-archive"), format: "9:16" });
  assert.ok(p.startsWith(ancrageAfricain("ouest").slice(0, 40)), "l'ancrage est le premier bloc");
  assert.ok(
    p.indexOf(PRESETS["nuit-archive"].lumiere) < p.indexOf("The scene:"),
    "sujet après la lumière"
  );
  assert.ok(p.indexOf("The scene:") < p.indexOf(PRESETS["nuit-archive"].cadre), "sujet avant le cadre");
});
test("chaque région remplace matériaux et végétation ; « monde » omet le bloc", () => {
  const marqueurs: Record<Exclude<Region, "monde">, string> = {
    ouest: "banco earth walls", sahel: "doum palms", cote: "fishing pirogues",
    foret: "kapok trees", est: "flat-topped acacias", maghreb: "zellige tiles",
  };
  for (const [region, marqueur] of Object.entries(marqueurs)) {
    const p = compilerPrompt({ preset: "nuit-archive", saisie: saisieDemo("nuit-archive"), region: region as Region, format: "9:16" });
    assert.ok(p.includes(marqueur), `${region} → « ${marqueur} »`);
  }
  const monde = compilerPrompt({ preset: "portrait-pro", saisie: {}, region: "monde", format: "1:1" });
  assert.ok(!monde.includes("African features"));
});

console.log("L'ancrage découpé — le défaut du 07/08 ne peut pas revenir");
test("portrait-studio : aucun mot de végétation ni de matériau de construction", () => {
  const CONTAMINANTS = /mango|acacia|shea|kapok|palm|banco|laterite|corrugated|concrete|thatch|pirogue|savanna|medina|zellige|cedar|plantain|grassland/i;
  for (const region of REGIONS) {
    for (const id of ["portrait-studio", "portrait-pro", "produit-fond-uni"] as const) {
      const p = compilerPrompt({
        preset: id,
        saisie: { personnages: [{ role: "une femme" }], textes: { produit: "un flacon" } },
        region: region as Region,
        format: "1:1",
      });
      const hit = p.match(CONTAMINANTS);
      assert.ok(!hit, `${id}/${region} contaminé par « ${hit?.[0]} »`);
    }
  }
});
test("un rôle « soldat » produit une clause d'uniforme, jamais de pagne", () => {
  const sujet = construireSujet(
    { phrase: "des militaires attendent dans la cour", personnages: [{ role: "un soldat", action: "il monte la garde" }] },
    PRESETS["nuit-archive"]
  );
  assert.ok(sujet.includes("un soldat, en uniforme complet de son armée et de son époque"), "clause d'uniforme");
  assert.ok(!/pagne|wax|boubou|bazin/i.test(sujet), "aucune clause de pagne sur le soldat");
});
test("la tenue saisie par l'utilisateur gagne sur l'uniforme automatique", () => {
  const sujet = construireSujet(
    { personnages: [{ role: "un soldat", tenue: "uniforme de parade blanc" }] },
    PRESETS["nuit-archive"]
  );
  assert.ok(sujet.includes("vêtu(e) de uniforme de parade blanc"));
  assert.ok(!sujet.includes("de son armée et de son époque"), "l'automatisme s'efface");
});
test("les tenues sont subordonnées au rôle dans le bloc ancrage (affirmatif)", () => {
  const p = compilerPrompt({ preset: "nuit-archive", saisie: saisieDemo("nuit-archive"), format: "9:16" });
  assert.ok(p.includes("Civilians wear"), "le wax est réservé aux civils");
  assert.ok(p.includes("every person wears the dress of their own role"), "subordination au rôle");
  const annee1973 = compilerPrompt({ preset: "nuit-archive", saisie: { ...saisieDemo("nuit-archive"), annee: 1973 }, format: "9:16" });
  assert.ok(annee1973.includes("olive-green fatigues and berets"), "l'uniforme vient du pack d'époque");
});
test("chaque preset déclare son ancrage ; plat, carte et fond n'en prennent aucun", () => {
  for (const id of PRESET_IDS) {
    assert.ok(Array.isArray(PRESETS[id].ancrage), `${id} : ancrage déclaré`);
  }
  for (const id of ["plat-restaurant", "carte-ancienne", "fond-citation"] as const) {
    const p = compilerPrompt({ preset: id, saisie: saisieDemo(id), format: PRESETS[id].format });
    assert.ok(!p.includes("African features") && !p.includes("Civilians wear"), `${id} : sans ancrage`);
  }
});

console.log("Zones de texte, époque, mode avancé");
test("les 7 presets [zone de texte] réservent leur plage vide", () => {
  const marques = PRESET_IDS.filter((id) => PRESETS[id].zoneTexte);
  assert.equal(marques.length, 7);
  for (const id of marques) {
    const p = compilerPrompt({ preset: id, saisie: saisieDemo(id), format: PRESETS[id].format });
    assert.ok(/empty/i.test(p) && /text overlay/i.test(p), `${id} : plage vide réservée`);
  }
});
test("année → pack d'époque ; prompt libre en DERNIER bloc", () => {
  const p = compilerPrompt({
    preset: "nuit-archive",
    saisie: { ...saisieDemo("nuit-archive"), annee: 1973 },
    format: "9:16",
    promptLibre: "shot on expired kodak film stock",
  });
  assert.ok(p.includes("Peugeot 404 and 504"), "pack 1970-1989");
  assert.ok(p.trimEnd().endsWith("shot on expired kodak film stock."), "prompt libre en dernier");
});
test("les 6 familles sont couvertes ; 30 prompts distincts", () => {
  const parCat = new Set(PRESET_IDS.map((id) => PRESETS[id].categorie));
  assert.equal(parCat.size, CATEGORIES.length);
  const prompts = PRESET_IDS.map((id) =>
    compilerPrompt({ preset: id, saisie: saisieDemo(id), format: PRESETS[id].format })
  );
  assert.equal(new Set(prompts).size, 30);
});

console.log(`\n${total - rate}/${total} tests verts`);
if (rate > 0) process.exit(1);
