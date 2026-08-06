/**
 * Suite de tests Griot — moteur de récits, sans réseau.
 * Couvre les 5 cas exigés (§10.4) : réponse propre · emballée dans des ``` ·
 * champs manquants · récit inutilisable · réponse illisible — plus les
 * invariants produit (plans↔script, a_verifier jamais vide, emoji hors script).
 */
import assert from "node:assert/strict";
import {
  extraireJson,
  normaliserRecit,
  phrasesInterditesPresentes,
  VERIF_DEFAUT,
} from "../services/griot/normalize";
import { recitMock } from "../services/griot/mock";
import {
  CIBLES_DUREE,
  RecitInutilisable,
  ReponseIllisible,
  type RecitInput,
} from "../services/griot/types";

const INPUT: RecitInput = {
  sujet: "Le braquage des agences BCEAO de Bouaké en 2003",
  angle: "crime",
  pays: "Côte d'Ivoire",
  duree: "45",
};

const SCRIPT_OK =
  "24 septembre 2003. Bouaké est aux mains de la rébellion. Des hommes armés entrent dans l'agence de la BCEAO. " +
  "Ils repartent avec 16 à 20 milliards de francs CFA. Un mois plus tard, les agences de Man et de Korhogo sont vidées. " +
  "Vingt-trois ans après, personne n'a jamais été inculpé. Les rapports existent. Les noms circulent. " +
  "À ton avis : pourquoi ce dossier n'a-t-il jamais été ouvert ?";

function reponseComplete() {
  const phrases = SCRIPT_OK.split(". ");
  const moitie = Math.ceil(phrases.length / 2);
  const p1 = phrases.slice(0, moitie).join(". ") + ".";
  const p2 = phrases.slice(moitie).join(". ");
  return {
    accroches: ["Casse jamais jugé 🇨🇮", "16 milliards envolés 🇨🇮", "Zéro inculpé 🇨🇮"],
    titre: "Le casse du siècle à Bouaké",
    script: `${p1} ${p2}`,
    duree_secondes: 45,
    plans: [
      { narration: p1, image: "Façade de la BCEAO", recherche: "BCEAO Bouake 2003" },
      { narration: p2, image: "Billets CFA", recherche: "CFA francs banknotes" },
    ],
    description: "Bouaké, 2003. Le dossier n'a jamais été ouvert.",
    question: "Pourquoi ce dossier n'a-t-il jamais été ouvert ?",
    hashtags: ["#histoire", "#afrique", "#bceao", "#crime", "#bouake", "#cotedivoire"],
    reponses: [
      { commentaire: "Source ?", reponse: "Presse ivoirienne d'époque — recoupe." },
      { commentaire: "C'était la guerre", reponse: "Même en guerre, 16 milliards laissent des traces." },
      { commentaire: "On sait qui c'est", reponse: "Des noms circulent, aucun n'a été inculpé." },
      { commentaire: "Et l'argent ?", reponse: "Des billets marqués ont refait surface." },
      { commentaire: "La suite ?", reponse: "Abonne-toi, elle arrive." },
    ],
    tiktok: { accroche: "16 milliards. Zéro jugement.", script: "Bouaké, 2003. 16 milliards volés. Personne n'a été jugé. Pourquoi ?" },
    a_verifier: ["Montant exact : 16 à 20 milliards selon les sources."],
    prochains_sujets: ["Sankara", "Béhanzin", "Man et Korhogo"],
  };
}

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

console.log("Cas 1 — réponse propre");
test("normalise sans perte et conserve l'invariant plans↔script", () => {
  const recit = normaliserRecit(extraireJson(JSON.stringify(reponseComplete())), INPUT);
  assert.equal(recit.titre, "Le casse du siècle à Bouaké");
  assert.equal(recit.plans.map((p) => p.narration).join(" "), recit.script);
  assert.equal(recit.accroches.length, 3);
  assert.equal(recit.reponses.length, 5);
  assert.ok(recit.a_verifier.length >= 1);
});

console.log("Cas 2 — JSON emballé dans des balises markdown");
test("extraireJson tolère les ``` malgré la consigne", () => {
  const emballee = "Voici le récit demandé :\n```json\n" + JSON.stringify(reponseComplete()) + "\n```\nBonne journée !";
  const recit = normaliserRecit(extraireJson(emballee), INPUT);
  assert.equal(recit.titre, "Le casse du siècle à Bouaké");
  assert.equal(recit.plans.map((p) => p.narration).join(" "), recit.script);
});

console.log("Cas 3 — champs manquants");
test("script seul → plans reconstruits, a_verifier JAMAIS vide, durée estimée", () => {
  const recit = normaliserRecit({ script: SCRIPT_OK }, INPUT);
  assert.ok(recit.plans.length >= 2, "plans reconstruits");
  assert.equal(recit.plans.map((p) => p.narration).join(" "), recit.script);
  assert.ok(recit.a_verifier.length >= 1, "a_verifier jamais vide");
  assert.ok(recit.a_verifier.some((v) => v.includes(VERIF_DEFAUT.slice(0, 20))));
  assert.ok(recit.duree_secondes > 10 && recit.duree_secondes < 120, `durée estimée: ${recit.duree_secondes}`);
  assert.ok(recit.hashtags.length >= 6 && recit.hashtags.length <= 9);
  assert.ok(recit.hashtags.every((h) => h.startsWith("#")));
  assert.equal(recit.titre, INPUT.sujet.slice(0, 80));
});

test("plans qui ne redonnent pas le script → redécoupage signalé", () => {
  const brut = reponseComplete();
  brut.plans = [{ narration: "Résumé réécrit qui ne colle pas.", image: "x", recherche: "y" }];
  const recit = normaliserRecit(brut as unknown as Record<string, unknown>, INPUT);
  assert.equal(recit.plans.map((p) => p.narration).join(" "), recit.script);
  assert.ok(recit.a_verifier.some((v) => v.includes("redécoupés")), "le redécoupage est signalé, pas silencieux");
});

console.log("Cas 4 — récit inutilisable");
test("script trop court → RecitInutilisable", () => {
  assert.throws(
    () => normaliserRecit({ script: "Trop court." }, INPUT),
    RecitInutilisable
  );
});
test("objet JSON valide mais vide → RecitInutilisable", () => {
  assert.throws(() => normaliserRecit({}, INPUT), RecitInutilisable);
});

console.log("Cas 5 — réponse illisible");
test("prose sans JSON → ReponseIllisible", () => {
  assert.throws(() => extraireJson("Désolé, je ne peux pas produire ce contenu."), ReponseIllisible);
});
test("réponse vide → ReponseIllisible", () => {
  assert.throws(() => extraireJson(""), ReponseIllisible);
});

console.log("Invariants produit");
test("les emojis sont retirés du script parlé (pas des accroches)", () => {
  const brut = reponseComplete();
  brut.script = brut.script + " Incroyable 😱";
  brut.plans = [];
  const recit = normaliserRecit(brut as unknown as Record<string, unknown>, INPUT);
  assert.ok(!/😱/u.test(recit.script), "emoji retiré du script");
  assert.ok(recit.accroches[0].includes("🇨🇮"), "drapeau conservé dans l'accroche");
});
test("phrases interdites détectées", () => {
  assert.deepEqual(
    phrasesInterditesPresentes("Chers amis, accrochez-vous : plongeons ensemble."),
    ["chers amis", "plongeons ensemble", "accrochez-vous"]
  );
  assert.deepEqual(phrasesInterditesPresentes(SCRIPT_OK), []);
});
test("le mock respecte lui-même les invariants (dev + tests d'écran)", () => {
  const recit = recitMock(INPUT);
  assert.equal(recit.plans.map((p) => p.narration).join(" "), recit.script);
  assert.ok(recit.a_verifier.length >= 1);
  assert.equal(recit.accroches.length, 3);
});
test("cibles de durée conformes au cahier (§5)", () => {
  assert.deepEqual(CIBLES_DUREE["45"], { secondes: 45, mots: 110, plans: 6 });
  assert.deepEqual(CIBLES_DUREE["75"], { secondes: 75, mots: 190, plans: 9 });
  assert.deepEqual(CIBLES_DUREE["120"], { secondes: 120, mots: 300, plans: 13 });
});

console.log(`\n${total - rate}/${total} tests verts`);
if (rate > 0) process.exit(1);
