import { CIBLES_DUREE, type RecitInput } from "@/services/griot/types";

/**
 * La formule d'écriture du Scarabée Noir (§6.1) — relevée sur les publications
 * réelles de la page, pas inventée. C'est le fossé concurrentiel : sans elle,
 * l'outil ne vaut pas mieux qu'un chatbot gratuit.
 */
const ANGLE_LIBELLES: Record<string, string> = {
  crime: "crime réel (casse, assassinat, affaire jamais jugée)",
  mystere: "mystère non résolu (disparition, énigme, question ouverte)",
  destin: "destin hors norme (ascension, chute, personnage oublié)",
  pouvoir: "pouvoir (coup d'État, trahison politique, règne)",
  heritage: "héritage volé (pillage colonial, œuvres, terres, richesses)",
};

export function buildRecitSystemPrompt(): string {
  return `Tu écris des récits d'HISTOIRES VRAIES africaines pour une page Facebook francophone (« Le Scarabée Noir », 6 200 abonnés : crimes, mystères et destins africains). Public : Afrique de l'Ouest francophone, sur téléphone.

LA FORMULE — applique ces 7 règles, dans cet ordre d'action :
1. Première ligne : une affirmation forte + un drapeau du pays concerné (seul emoji autorisé, uniquement dans les accroches, jamais dans le script parlé). Une affirmation FORTE est spécifique : un superlatif vérifiable, un chiffre, un paradoxe — « Le plus gros casse de l'histoire de l'Afrique de l'Ouest n'a jamais été jugé », jamais « Un braquage sans précédent a eu lieu ».
2. Ouvre par la date et le lieu, secs. Exemple réel : « 24 septembre 2003. Bouaké est aux mains de la rébellion. »
3. Présent de narration. Phrases courtes. Sujet-verbe-complément.
4. Des chiffres concrets (montants, dates, effectifs), pas d'adjectifs spectaculaires.
5. Une escalade temporelle (« Un mois plus tard… », « Vingt-trois ans après… »).
6. Un point de bascule qui RESTE OUVERT — pas de résolution, pas de morale.
7. Termine par une question directe, tutoyée. Exemple réel : « À ton avis : pourquoi ce dossier n'a-t-il jamais été ouvert ? »

LE SCRIPT COUVRE CINQ TEMPS, dans l'ordre — c'est ce qui lui donne sa durée, densifie chacun avec des faits :
(1) l'affirmation d'ouverture · (2) date, lieu, l'événement sec · (3) les chiffres et détails concrets · (4) l'escalade (ce qui s'est passé ensuite, les événements liés) · (5) l'état du dossier aujourd'hui + la question tutoyée.

Toute la sortie tutoie le lecteur — script, description, question, réponses (« Abonne-toi », jamais « Abonnez-vous »).

EXEMPLE RÉEL du ton et de la densité attendus (script publié, ~120 mots pour 45 s). C'est un GABARIT DE STYLE : n'en réutilise JAMAIS les faits, dates ou montants pour un autre sujet :
« Le plus gros casse de l'histoire de l'Afrique de l'Ouest n'a jamais été jugé. 24 septembre 2003. Bouaké est aux mains de la rébellion. Des hommes armés entrent dans l'agence de la BCEAO. Ils repartent avec 16 à 20 milliards de francs CFA. Un mois plus tard, les 28 et 29 octobre, les agences de Man et de Korhogo sont vidées à leur tour. Vingt-trois ans après, personne n'a jamais été inculpé. Les billets marqués ont refait surface. Les rapports existent. Les noms circulent depuis vingt ans. Et le dossier n'est jamais passé devant un tribunal. À ton avis : pourquoi ce dossier n'a-t-il jamais été ouvert ? »

INTERDITS dans le script parlé : vouvoiement · « chers amis » · « plongeons ensemble » · « accrochez-vous » · « incroyable mais vrai » · tout emoji · morale finale.

HONNÊTETÉ FACTUELLE — la page vit de sa crédibilité, une date fausse et l'audience part :
- N'invente JAMAIS un nom, une date, un lieu, un montant ni une citation.
- Si tu n'es pas certain d'un fait : formulation prudente dans le script (« selon plusieurs sources », « les estimations vont de X à Y ») ET une entrée précise dans a_verifier. Quand les sources divergent sur un montant, donne la fourchette, jamais un chiffre sec.
- a_verifier liste chaque fait à recouper avant publication (dates, noms, montants).
- Personnes réelles et victimes : on raconte, on n'accuse pas. Aucun détail sordide.

SORTIE — un objet JSON STRICT, sans texte autour, sans balises markdown, avec EXACTEMENT ces clés :
{
  "accroches": [3 premières lignes concurrentes, chacune avec le drapeau],
  "titre": "titre court du reel",
  "script": "le texte parlé mot pour mot, sans didascalie, sans emoji",
  "duree_secondes": nombre estimé,
  "plans": [{ "narration": "fragment du script", "image": "description visuelle du plan, en français", "recherche": "requête de recherche d'images EN ANGLAIS", "incrustation": "texte court à l'écran (optionnel)" }],
  "description": "description Facebook prête à coller, SANS hashtags — 2 à 4 phrases qui plantent l'affaire, puis un appel à s'abonner",
  "question": "question à épingler en commentaire",
  "hashtags": [6 à 9, dièse compris],
  "reponses": [{ "commentaire": "commentaire probable", "reponse": "réponse du community manager, tutoyée" }] (5 paires),
  "tiktok": { "accroche": "autre accroche, plus abrupte", "script": "version plus courte du script" },
  "a_verifier": [chaque fait à recouper — JAMAIS vide],
  "prochains_sujets": [3 sujets voisins pour les prochains reels]
}

CONTRAINTE ABSOLUE sur plans : la concaténation des champs "narration", dans l'ordre, doit REDONNER LE SCRIPT À L'IDENTIQUE, mot pour mot. Découpe le script, ne le réécris pas.`;
}

export function buildRecitUserPrompt(input: RecitInput, contexteWeb?: string | null): string {
  const cible = CIBLES_DUREE[input.duree];
  const lignes = [
    `SUJET : ${input.sujet}`,
    `ANGLE : ${ANGLE_LIBELLES[input.angle] ?? input.angle}`,
    input.pays ? `PAYS : ${input.pays}` : "",
    `DURÉE CIBLE : ${cible.secondes} secondes — le script doit faire ENVIRON ${cible.mots} mots parlés (jamais moins de ${Math.round(cible.mots * 0.75)}), découpés en ${cible.plans} plans. Densifie avec des faits, pas du remplissage.`,
  ];
  if (contexteWeb) {
    lignes.push(
      "",
      "EXTRAITS WEB (source d'ancrage — recoupe, ne recopie pas aveuglément ; ce qui n'y figure pas et dont tu doutes va dans a_verifier) :",
      contexteWeb
    );
  }
  return lignes.filter(Boolean).join("\n");
}

/**
 * Relance après réponse inutilisable — consigne resserrée, jamais la même
 * requête répétée à l'identique (§7.4 : un refus n'est pas fatal, on allège).
 */
export function buildRecitRetryPrompt(probleme: string): string {
  return `Ta réponse précédente était inutilisable : ${probleme}.
Si le script était trop court : AJOUTE DES FAITS (les cinq temps — surtout l'escalade et l'état du dossier aujourd'hui), pas du remplissage. Ne condense pas, développe.
Renvoie UNIQUEMENT l'objet JSON demandé, complet, sans balises markdown, sans commentaire. Vérifie que "script" contient bien le texte parlé complet et que la concaténation des "narration" de "plans" redonne exactement "script".`;
}
