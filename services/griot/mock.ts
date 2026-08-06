import type { Recit, RecitInput } from "@/services/griot/types";

/**
 * Récit fictif pour MOCK_AI=true et pour la suite de tests — calqué sur la
 * publication réelle du Scarabée Noir (casse BCEAO, §6.1) pour que l'écran
 * de dev montre la vraie forme du produit.
 */
export function recitMock(input: RecitInput): Recit {
  const script =
    "Le plus gros casse de l'histoire de l'Afrique de l'Ouest n'a jamais été jugé. " +
    "24 septembre 2003. Bouaké est aux mains de la rébellion. Des hommes armés entrent dans l'agence de la BCEAO. " +
    "Ils repartent avec 16 à 20 milliards de francs CFA. " +
    "Un mois plus tard, les 28 et 29 octobre, les agences de Man et de Korhogo sont vidées à leur tour. " +
    "Vingt-trois ans après, personne n'a jamais été inculpé. Les billets marqués ont refait surface. " +
    "Les rapports existent. Les noms circulent depuis vingt ans. " +
    "Et le dossier n'est jamais passé devant un tribunal. " +
    "À ton avis : pourquoi ce dossier n'a-t-il jamais été ouvert ?";
  const phrases = script.split(". ").map((p) => (p.endsWith(".") || p.endsWith("?") ? p : `${p}.`));
  const parPlan = Math.ceil(phrases.length / 6);
  const plans = [];
  for (let i = 0; i < phrases.length; i += parPlan) {
    plans.push({
      narration: phrases.slice(i, i + parPlan).join(" "),
      image: "Archive sobre : façade de banque, billets CFA, une du journal d'époque.",
      recherche: "BCEAO Bouake 2003 robbery archive photo",
    });
  }
  // Invariant §5 : la concaténation des narrations redonne le script.
  const scriptExact = plans.map((p) => p.narration).join(" ");
  return {
    accroches: [
      "Le plus gros casse de l'histoire de l'Afrique de l'Ouest n'a jamais été jugé 🇨🇮",
      "16 à 20 milliards volés, zéro inculpé 🇨🇮",
      "Trois agences de la BCEAO vidées. Personne devant un tribunal 🇨🇮",
    ],
    titre: `[MOCK] ${input.sujet.slice(0, 60)}`,
    script: scriptExact,
    duree_secondes: 45,
    plans,
    description:
      "Bouaké, 2003. Des hommes armés vident l'agence de la BCEAO. Vingt-trois ans après, le dossier n'a jamais été ouvert. Abonne-toi : chaque jour, une histoire vraie que l'Afrique n'a jamais oubliée.",
    question: "À ton avis : pourquoi ce dossier n'a-t-il jamais été ouvert ?",
    hashtags: ["#histoire", "#afrique", "#cotedivoire", "#bceao", "#crime", "#histoirevraie"],
    reponses: [
      { commentaire: "C'était la guerre, normal", reponse: "Même en guerre, un casse de 16 milliards laisse des traces. Les billets marqués sont réapparus — c'est ça la vraie question." },
      { commentaire: "On connaît les coupables", reponse: "Des noms circulent depuis vingt ans, mais aucun n'a été inculpé. Tant que le dossier reste fermé, ce ne sont que des rumeurs." },
      { commentaire: "Source ?", reponse: "Rapports d'époque et presse ivoirienne — les références sont en description. Recoupe, c'est fait pour ça." },
      { commentaire: "Et l'argent alors ?", reponse: "Une partie des billets marqués a refait surface dans la sous-région. Le reste, personne ne sait officiellement." },
      { commentaire: "Fais Sankara ensuite", reponse: "Il arrive. Abonne-toi pour ne pas le rater." },
    ],
    tiktok: {
      accroche: "16 milliards volés. Zéro jugement. Personne n'en parle.",
      script:
        "24 septembre 2003. Bouaké. Des hommes armés vident l'agence de la BCEAO. 16 à 20 milliards de francs CFA. Vingt-trois ans après, personne n'a été inculpé. Pourquoi ?",
    },
    a_verifier: [
      "Recoupe les dates, les noms et les montants avec une source avant de publier.",
      "Montant exact du casse : les estimations vont de 16 à 20 milliards FCFA selon les sources.",
    ],
    prochains_sujets: [
      "L'assassinat de Thomas Sankara — le procès de 2022",
      "Béhanzin et les Amazones du Dahomey",
      "Les braquages des agences de Man et Korhogo, octobre 2003",
    ],
  };
}
