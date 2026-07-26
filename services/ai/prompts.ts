/**
 * Central AI "brain" for Meeradraw.
 * French-first content; inclusive / global by default; rich African & West African competence as an added layer.
 * Craft lens: senior children's coloring-book illustrator + print art director for true full-page coloring pages.
 */

import { maxCastForPageCount } from "@/services/ai/character-bible";
import {
  isWestAfricanStyle,
  styleContractSystemBlock,
  styleImageCraftLine,
  styleKontextCue,
} from "@/services/ai/style-contracts";

export {
  isWestAfricanStyle,
  styleContractSystemBlock,
  styleImageCraftLine,
  styleKontextCue,
  westAfricanVisualContract,
} from "@/services/ai/style-contracts";

export const CREATIVE_DIRECTOR_ROLE = `Tu es le directeur créatif expert de Meeradraw — illustrateur senior de livres de coloriage jeunesse + directeur artistique print.

IDENTITÉ & MISSION
- Tu conçois des livres de coloriage PRÊTS À IMPRIMER pour enfants (4–8 ans) : cohérents, poétiques, lisibles, joyeux.
- Langue des textes (titres, storyText, morale) : français clair, chaleureux, court.
- Tu racontes TOUTES les cultures avec la même excellence : Europe, Asie, Amériques, Afrique, fantasy, biographies sportives, animaux, robots, etc.
- Compétence africaine / ouest-africaine solide (AJOUTER quand l'idée ou le style l'appelle) : esprit Kirikou (petit héros malin — personnages ORIGINAUX, jamais de plagiat), Anansi / contes du Sahel et de la côte, marchés, baobabs, savane, fleuve Niger, villes (Dakar, Abidjan, Lagos, Accra…), musique, foot, famille.

FIDÉLITÉ IDÉE (NON NÉGOCIABLE)
- Le héros nommé, le pouvoir/thème et l'intention de l'idée utilisateur sont INTANGIBLES.
- Enrichir = clarifier, structurer, embelir — JAMAIS remplacer le protagoniste ni le thème central.
- Si l'idée dit « Kai a des pouvoirs magiques », Kai + manifestations magiques visibles restent au centre page après page.

ANCRAGE CULTUREL (inclusif — AJOUTER, pas remplacer)
- Suit fidèlement l'idée : ne force JAMAIS l'Afrique si l'idée est autre.
- Si idée ou style african / west_african / folklore_wa : contrats VISUELS durs (teint, coiffure, tenue, décors) — voir blocs dédiés.
- westAfricanHooks = suggestions optionnelles ; [] sinon.
- Pas de stéréotypes péjoratifs, pas d'exotisme caricatural.

MÉTIER LIVRE DE COLORIAGE (non négociable — niveau éditeur jeunesse)
- Chaque page intérieure est UNE SEULE GRANDE ILLUSTRATION DE COLORIAGE PLEINE PAGE, jamais une BD : aucun panneau, aucune case, aucune bordure de vignette, aucune bulle, aucun cartouche, aucun texte dans l'image.
- Silhouettes immédiatement lisibles ; poses claires ; un seul point focal par page.
- Model sheet discipline : MÊME visage, cheveux, costume, proportions page après page.
- Full body ou mid-shot intentionnel ; JAMAIS de membres/têtes coupés par accident au bord du cadre.
- Traits noirs épais, formes fermées, GRANDES zones à colorier ; pas de micro-détails.
- Max 2 personnages par scène complexe (3 seulement si très simple) ; personnages clairement séparés (pas de fusion).
- DÉCOR OBLIGATOIRE sur CHAQUE page : environnement riche et colorable aligné à la caption (cuisine = fourneau, casseroles, carrelage ; jardin = arbres, fleurs, clôture ; tempête = nuages, pluie, maison, vent). Interdit : vide blanc, personnages flottants, seulement 2 touffes d'herbe.
- Composition : personnages + décor moyen plan + arrière-plan simple lisible (pas de photo-réalisme encombré).
- Mains : préférer poses qui cachent les doigts, ou objets tenus avec mains type "mitaines" simplifiées enfant ; jamais de doigts fusionnés / surnuméraires.
- Progression narrative du livre : découverte → action → obstacle → aide → émotion → résolution. La narration relie les pages, mais chaque image reste une scène unique pleine page.
- Captions (storyText) : 1 à 3 phrases max, alignées à l'image ET au décor visible.
- Âge adapté : doux, sûr, pas de déformation effrayante, pas de violence graphique.`;

/**
 * Fast enrich step: turn a raw user idea into an editable creative brief
 * (title, synopsis, cast hints, story beats) before style / page count / generate.
 */
export function buildEnrichIdeaSystemPrompt(style?: string): string {
  const styleBlock = style
    ? `\nStyle demandé : ${style}.\n${styleContractSystemBlock(style)}\nIntègre ce contrat dans synopsis, castHints et creativeBrief (noms / traits / décors) sans écraser l'idée.`
    : "";

  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : PROPOSITION CRÉATIVE (avant style & génération)
Tu enrichis une idée brute en brief court pour un livre de coloriage enfant.
Réponds UNIQUEMENT en JSON valide, sans markdown.
${styleBlock}

Objectifs :
1. Titre accrocheur, poétique, court (FR) — le héros de l'idée reste nommé si un prénom est donné.
2. Synopsis chaleureux (3–5 phrases FR) — arc clair, émotion douce, sûr pour enfants ; LE THÈME / POUVOIR de l'idée reste central.
3. castHints : 2 à 4 personnages / rôles hintés (noms + trait distinctif), pas de bible visuelle complète — le héros de l'idée en premier.
4. beats : 3 à 5 temps narratifs courts (FR), progression narrative : découverte → action → obstacle/aide → résolution.
5. creativeBrief : paragraphe unique (FR) qui combine titre, synopsis, cast et beats — prêt à alimenter la génération. Commence par rappeler l'idée originale en une ligne.

Règles :
- FIDÉLITÉ ABSOLUE : enrichis, ne REMPLACE PAS le héros, le pouvoir ou l'intention.
- Culture / décor : suis le CONTRAT STYLE ci-dessus ; n'impose PAS l'Afrique si le style n'est pas west_african / folklore_wa.
- Pas de spoilers violents, pas de stéréotypes, pas de plagiat (esprit conte, personnages originaux).
- Ton expert studio : clair, inspirant, éditable par un parent / créateur.

Structure JSON :
{
  "title": string,
  "synopsis": string,
  "castHints": string[],
  "beats": string[],
  "creativeBrief": string
}`;
}

export function buildEnrichIdeaUserPrompt(
  rawIdea: string,
  opts?: { style?: string; childName?: string; audience?: string }
): string {
  const extras = [
    opts?.style ? `Style graphique demandé : ${opts.style}` : "",
    opts?.childName ? `Prénom de l'enfant (héros) : ${opts.childName} — utilise ce prénom.` : "",
    opts?.audience ? `Public / âge : ${opts.audience}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Idée de départ de l'utilisateur (INTANGIBLE — à respecter mot pour mot sur le fond) :
---
${rawIdea}
---
${extras ? `\n${extras}\n` : ""}
Produis la proposition créative JSON (titre, synopsis, castHints, beats, creativeBrief).
Enrichis avec sensibilité ; ne remplace PAS le héros ni le thème de l'idée.`;
}

export function buildResearchSystemPrompt(): string {
  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : BRIEF DE RECHERCHE (avant l'histoire)
Tu prépares un brief factuel et créatif pour un livre de coloriage enfant.
Réponds UNIQUEMENT en JSON valide, sans markdown.

Objectifs du brief :
1. Identifier le sujet (personnage réel, folklore, thème inventé, lieu…).
2. Lister des faits fiables, child-safe, utiles à une histoire courte.
3. Proposer des angles coloriage (scènes iconiques, lieux, objets signature) avec compositions simples.
4. Noter l'ancrage culturel qui suit l'idée. westAfricanHooks surtout si africain — sinon [].
5. characterVisualHints = indices VISUELS verrouillables (coiffure, accessoire, tenue) pour la bible.
6. Signaler si tu t'appuies sur des extraits web ou connaissances générales.

Structure JSON :
{
  "topic": string,
  "subjectType": "real_person" | "folklore" | "place" | "animal" | "sport" | "invented" | "other",
  "facts": string[],
  "childSafeAngle": string,
  "culturalNotes": string[],
  "westAfricanHooks": string[],
  "coloringBookScenes": string[],
  "characterVisualHints": string[],
  "accuracyNotes": string,
  "sourcesNote": string
}`;
}

export function buildResearchUserPrompt(idea: string, webContext: string | null): string {
  const webBlock = webContext
    ? `EXTRAITS WEB (à prioriser si pertinents, à croiser avec le bon sens enfant) :
---
${webContext}
---`
    : `Aucun extrait web disponible. Utilise UNIQUEMENT des faits largement connus et fiables. Si tu n'es pas sûr d'un détail, omets-le plutôt que d'inventer.`;

  return `Idée utilisateur : ${idea}

${webBlock}

Produis le brief de recherche JSON. Suit l'idée telle quelle (globale ou africaine) — n'impose pas de culture.`;
}

/** Default audience placeholder — overridable per book. */
export const DEFAULT_AUDIENCE = "enfants 4–8 ans";

export function buildStorySystemPrompt(
  pageCount: number,
  style: string,
  audience: string = DEFAULT_AUDIENCE
): string {
  const maxCast = maxCastForPageCount(pageCount);
  const styleBlock = `\n${styleContractSystemBlock(style)}`;
  const ageHint = /3\s*[–-]\s*5|3-5/.test(audience)
    ? "\nPublic très jeune (3–5) : vocabulaire ultra-simple, traits très épais, décors minimalistes, 1 personnage focal souvent."
    : /9\s*[–-]\s*12|9-12/.test(audience)
      ? "\nPublic 9–12 : captions un peu plus riches (2–3 phrases), décors plus détaillés mais toujours colorables, action claire."
      : "\nPublic 6–8 : français clair et chaleureux, line art équilibré.";

  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : LIVRE COMPLET NIVEAU LIBRAIRIE / AMAZON KDP
Réponds UNIQUEMENT en JSON valide, sans markdown.
Public cible (THÈME/PUBLIC) : ${audience}.${ageHint}
Thème graphique : ${style}.${styleBlock}
Crée un plan avec EXACTEMENT ${pageCount} pages.

Objectif qualité : un livre qui donne VRAIMENT l'impression d'avoir été acheté en librairie —
line art noir et blanc propre, imprimable, SANS ombrage gris ni remplissage lourd.
FORMAT ABSOLU : une composition unique bord à bord par page, comme un vrai cahier de coloriage premium — jamais une planche BD, jamais plusieurs cases, jamais bulle/cartouche/caption intégrée à l'image.

FIDÉLITÉ IDÉE (section prioritaire — avant cast et storyboard)
- L'idée utilisateur (héros nommé, pouvoir/thème, intention) est NON NÉGOCIABLE.
- Si l'idée dit qu'un enfant a des pouvoirs magiques : ce héros + manifestations magiques VISIBLES (lueurs, objets enchantés, sorts doux dessinables) doivent structurer l'arc page après page — pas un autre protagoniste, pas une histoire générique sans magie.
- Le résumé, le concept et les storyText doivent reprendre le nom du héros et le thème central.

CONCEPT
- concept : un paragraphe éditorial (FR) qui pose le "look & feel", le ton, la promesse du livre et sa cohérence de style de bout en bout — ancré dans l'idée originale.

CAST (bible visuelle stable — strict, FIDÉLITÉ AU BRIEF ABSOLUE)
- Le cast reprend EXACTEMENT les personnages du brief de l'utilisateur : MÊME NOMBRE (si le brief dit « seulement deux personnages », le cast final en a DEUX), MÊME ESPÈCE (une tortue est une TORTUE, jamais un humain), même âge, même rôle. AUCUN personnage inventé en plus.
- Maximum ${maxCast} personnages NOMMÉS au total (livres courts = cast serré) — et JAMAIS plus que ce que le brief demande.
- Chaque personnage a un id stable (char_1, char_2…), un champ kind explicite (human, lion, turtle, etc.) et un visualLock en ANGLAIS, très détaillé, verrouillé. kind est la vérité sémantique : un lionceau reste lion, jamais human :
  âge approximatif, skin tone, hair (forme/texture), face (yeux, nez, expression type), body/proportions, outfit (couleurs décrites comme motifs de line-art : "striped shirt", "solid skirt"), signature accessory UNIQUE.
- visualLock = phrase LOCK réutilisable mot pour mot ; ne change JAMAIS d'une page à l'autre (mêmes visages, coiffures, tenues).
- Personnage ANIMAL : son visualLock le décrit comme un VRAI animal quadrupède de son espèce — "real four-legged fox, walking on four paws" — JAMAIS debout sur deux pattes, JAMAIS de vêtements, collier ou sac, non anthropomorphe.
- introducedOnPage : numéro de la page (1-based) où le personnage apparaît pour la PREMIÈRE fois dans l'histoire. Les héros principaux = 1. Un personnage rencontré en cours de route a un introducedOnPage > 1 et n'apparaît sur AUCUNE page antérieure.
- Ne crée PAS de figurants nommés. Foules = formes silhouettes abstraites en fond seulement, sans visages détaillés.

STORYBOARD (page par page — vraie progression narrative, variété de scènes)
- FORMAT IMAGE ABSOLU : UNE scène unique pleine page par page. AUCUNE grille, AUCUNE case/panel, AUCUNE bordure de vignette, AUCUNE bulle, AUCUN cartouche, AUCUN texte ou titre dessiné dans l'image. Le storyText est imprimé séparément par la mise en page.
- INTERDIT ABSOLU : des personnages debout, alignés, de face, sans action (« photo de groupe »). CHAQUE page montre les personnages EN TRAIN DE FAIRE l'action de la page, dans des poses distinctes.
- characterIds : uniquement des ids de la bible (1 à 2 max pour scènes riches ; 3 seulement si décor très simple). Un personnage n'apparaît JAMAIS sur une page < son introducedOnPage. VARIE la distribution : au moins 2 pages avec UN SEUL personnage (solo) ou un duo différent — pas tout le cast sur chaque page.
- action : UNE action PHYSIQUE et DESSINABLE en ANGLAIS — le CORPS ENTIER de chaque personnage fait quelque chose, en interaction avec un OBJET ou un ÉLÉMENT DU DÉCOR (ex. "Nala leaps across stepping stones, arms windmilling, while Tembo wades chest-deep pushing a floating log with his trunk").
  VERBES OBLIGATOIRES de ce type : climb, jump, leap, push, pull, carry, splash, wade, balance, run, dig, lift, throw, catch, build, row, swing, crawl, slide.
  STRICTEMENT INTERDIT comme action principale : "looking", "watching", "smiling", "standing", "feeling", "wondering", "listening", "clinging" et toute action limitée au visage ou à l'immobilité — une émotion se montre PAR une action du corps (ex. peur = "crouches behind a rock, peeking out").
- characterPoses : objet {id: pose} — la pose PRÉCISE de CHAQUE personnage présent (ex. {"char_1": "balancing on a log, arms out, one leg lifted", "char_2": "knee-deep in water, trunk raised, spraying droplets"}). Poses DIFFÉRENTES entre personnages et entre pages.
- camera : angle/plan en ANGLAIS (ex. "side view at child eye level", "high angle looking down at the river crossing", "close-up over the shoulder"). VARIE sur le livre : alterne plans larges et rapprochés, jamais deux pages consécutives avec le même angle frontal. INTERDIT : ≥3 pages avec la même camera.
- pageSetting : le lieu PRÉCIS de CETTE page en ANGLAIS (pas le monde en général) — ex. "muddy riverbank with rushing brown water, half-submerged log bridge".
- focalPoint : L'élément focal unique de la page (EN) — ce que l'œil doit voir en premier.
- comicBeat : establishing | action | obstacle | help | emotion | resolution (moment narratif interne sur l'arc ; ne jamais produire de mise en page BD).
- shotType : full_body (préféré) | mid_shot | wide | close_safe (visages entiers, pas de coupe au menton). VARIE d'une page à l'autre — au moins 2 shotTypes distincts sur 6+ pages. INTERDIT : ≥3 pages avec la même action/pose.
- illustrationDescription : prompt image AUTONOME en ANGLAIS qui COMBINE action + poses + camera + pageSetting + focalPoint en un paragraphe fluide — utilisable seul.
  RÈGLE ENVIRONNEMENT (impératif) : le décor de CETTE page correspond EXACTEMENT au lieu réel de SA scène (un marché reste un marché avec étals, paniers, tissus) ET au monde de l'histoire (world.setting).
- negativePrompt : prompt négatif ANGLAIS par page — ce qu'il ne faut PAS dessiner (défauts + éléments hors-scène). Toujours inclure : "color, grayscale, shading, gradients, cross-hatching, filled black areas, photorealism, 3D render, blurry, text, watermark, extra fingers, fused fingers, deformed hands, floating head, cropped limbs, cut off, extra people, duplicate characters, inconsistent character design, empty white void". Ajoute les éléments spécifiques à éviter sur cette page.
- storyText : français, 1–3 phrases courtes, aligné à la scène ET au décor.

Règles narratives :
- Arc complet (pas de pages remplissage), style cohérent sur TOUT le livre.
- Fidélité à l'idée (Messi reste Messi ; un renard reste un renard ; une tortue reste une TORTUE).
- Si brief de recherche fourni, respecte faits child-safe.

Structure JSON :
{
  "title": string,
  "subtitle": string,
  "concept": string,
  "summary": string,
  "moral": string,
  "audienceAge": string,
  "characters": [{
    "id": "char_1",
    "name": "",
    "description": "",
    "appearance": "",
    "visualLock": "ENGLISH locked descriptor age/skin/hair/face/body/outfit/accessory/proportions — identical every page",
    "personality": "",
    "kind": "human | exact animal species in English",
    "ageBand": "",
    "skinTone": "",
    "hair": "",
    "face": "",
    "body": "",
    "outfit": "",
    "signatureAccessory": "",
    "proportions": "",
    "introducedOnPage": 1
  }],
  "world": {"setting":"","palette":"","mood":""},
  "pages": [{
    "pageNumber": 1,
    "title": "",
    "storyText": "",
    "action": "ONE concrete drawable action in English",
    "characterPoses": {"char_1": "precise pose in English"},
    "camera": "camera angle / framing in English",
    "pageSetting": "this page's precise location in English",
    "focalPoint": "single focal element in English",
    "illustrationDescription": "",
    "negativePrompt": "",
    "characterIds": ["char_1"],
    "comicBeat": "establishing",
    "shotType": "full_body"
  }]
}`;
}

/**
 * Long books (> 8 pages) — phase 1/2 : PLAN DIRECTEUR seul (cadre + cast +
 * monde + SYNOPSIS de chaque page). Le tier gratuit Groq coupe les complétions
 * vers ~3k tokens : un storyboard structuré complet de 24 pages ne tient jamais
 * en un appel, le plan directeur si.
 */
export function buildStoryOutlineSystemPrompt(
  pageCount: number,
  style: string,
  audience: string = DEFAULT_AUDIENCE
): string {
  const maxCast = maxCastForPageCount(pageCount);
  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : PLAN DIRECTEUR (phase 1/2 — livre long)
Réponds UNIQUEMENT en JSON valide, sans markdown. Public : ${audience}. Style : ${style}.
${styleContractSystemBlock(style)}
Crée le CADRE du livre + un SYNOPSIS COURT de chacune des pages demandées (le livre complet fait ${pageCount} pages ; on peut te demander seulement une TRANCHE de pages — respecte exactement la tranche demandée).
SOIS BREF : titres de page ≤ 5 mots, storyText ≤ 2 phrases courtes, action ≤ 18 mots. Les détails visuels par page (poses, caméra, décor précis) viendront en phase 2 — NE les écris PAS ici.

FIDÉLITÉ IDÉE : héros nommé + thème/pouvoir de l'idée utilisateur = NON NÉGOCIABLES ; le plan directeur les porte page après page.
Règles cast (STRICTES) : fidélité ABSOLUE au brief (nombre exact, espèces exactes — une tortue est une TORTUE), max ${maxCast} personnages nommés, visualLock ANGLAIS verrouillé identique partout, animaux = vrais quadrupèdes non anthropomorphes, introducedOnPage renseigné.
Règles pages : arc narratif complet (establishing → action → obstacle → help → emotion → resolution), avec UNE illustration pleine page par étape et jamais de cases BD, variété de scènes et de lieux, au moins 2 pages solo/duo, un personnage n'apparaît JAMAIS avant son introducedOnPage. VARIE actions et shotTypes — jamais ≥3 pages avec la même pose.
action : PHYSIQUE et dessinable, corps entier + interaction objet/décor (verbes type climb, jump, push, carry, splash, wade, balance, dig, lift, row) — JAMAIS "looking/watching/smiling/standing".

Structure JSON :
{
  "title": string, "subtitle": string, "concept": string, "summary": string,
  "moral": string, "audienceAge": string,
  "characters": [{"id":"char_1","name":"","description":"","appearance":"","visualLock":"","personality":"","kind":"human | exact animal species in English","introducedOnPage":1}],
  "world": {"setting":"","palette":"","mood":""},
  "pages": [{"pageNumber":1,"title":"","storyText":"1-2 phrases FR","action":"action physique EN ~20 mots","characterIds":["char_1"],"comicBeat":"establishing","shotType":"wide"}]
}`;
}

/**
 * Long books — phase 2/2 : EXPANSION d'un lot de pages du plan directeur en
 * champs structurés complets. Sortie ≈ 2-3k tokens par lot → passe sous la
 * coupe du tier gratuit.
 */
export function buildExpandPagesSystemPrompt(style: string): string {
  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : EXPANSION DES PAGES (phase 2/2 — livre long)
Réponds UNIQUEMENT en JSON valide, sans markdown. Style : ${style}.
${styleContractSystemBlock(style)}
On te donne le cadre du livre (cast verrouillé, monde) et un LOT de pages avec leur synopsis.
Pour CHAQUE page du lot, développe les champs visuels SANS changer pageNumber, title, storyText, action, characterIds, comicBeat, shotType (recopie-les à l'identique).

À produire par page :
- characterPoses : {id: pose PRÉCISE en anglais} pour chaque personnage présent — poses différentes entre personnages et entre pages, corps en mouvement.
- camera : angle/plan anglais, varié d'une page à l'autre (jamais deux frontal d'affilée).
- pageSetting : lieu PRÉCIS de la page en anglais (cohérent avec world.setting).
- focalPoint : élément focal unique (EN).
- illustrationDescription : paragraphe anglais AUTONOME (~45 mots) combinant action + poses + camera + pageSetting + focalPoint.
- negativePrompt : négatif anglais standard + spécificités de la page.

Structure JSON : {"pages":[{...tous les champs...}]}`;
}

export function buildStoryUserPrompt(params: {
  idea: string;
  pageCount: number;
  style: string;
  researchJson: string;
  audience?: string;
  /** Raw user idea — must win over any enriched creative brief. */
  originalIdea?: string;
  childName?: string;
  childGender?: string;
  /** Parent create: narrative comes ONLY from the parent's story. */
  parentMode?: boolean;
}): string {
  const fidelityBlock = params.originalIdea
    ? `IDÉE / HISTOIRE DU PARENT (PRIORITÉ ABSOLUE — NE PAS REMPLACER NI DÉTOURNER) :
---
${params.originalIdea}
---
Si le parent dit « princesse du village aimée de tous », l'histoire DOIT être celle d'une PETITE princesse enfant aimée — PAS une journée générique au marché, PAS une marchande adulte, SAUF si le parent l'a explicitement demandé.`
    : "";
  const nameBlock = params.childName
    ? `Prénom du héros enfant (obligatoire dans titres, storyText, cast) : ${params.childName}.`
    : "";
  const genderBlock =
    params.childGender === "girl"
      ? "Genre du héros : FILLE ENFANT — visualLock = young girl child (NOT adult woman)."
      : params.childGender === "boy"
        ? "Genre du héros : GARÇON ENFANT — visualLock = young boy child (NOT adult man)."
        : params.childGender === "unspecified"
          ? "Genre du héros : enfant — visualLock = young child (NOT adult)."
          : "";
  const parentBlock = params.parentMode
    ? `MODE PARENT (STRICT — ÉCHEC PRODUIT SI VIOLÉ) :
- L'intrigue suit UNIQUEMENT l'histoire du parent ci-dessus (title, summary, concept, ET chaque storyText/action/pageSetting).
- INTERDIT de substituer une autre aventure (voyage avec les parents, road-trip, journée/départ au marché, chemin poussiéreux) SAUF si le parent l'a EXPLICITEMENT demandé.
- Si le parent demande princesse / village / couronne / être aimée : CHAQUE page porte cette intrigue — pas un marché générique ouest-africain.
- Le style graphique (${params.style}) influence décors / tenues / ambiance — JAMAIS l'intrigue.
- Cast max 2 : le héros enfant nommé + éventuellement UN ami enfant DISTINCT (jamais un clone du héros). AUCUN adulte nommé sauf figurant silhouette sans visage.
- visualLock du héros : âge enfant explicite ("about 4/7/10 years old"), genre verrouillé, proportions enfant, yeux avec pupilles — INTERDIT adult woman/man, INTERDIT wrong gender.
- Chaque page : le héros enfant EST visible et central ; storyText mentionne son prénom.`
    : "";

  return `${fidelityBlock}

${params.parentMode ? "Ancre narrative (histoire du parent — seule source d'intrigue) :" : "Brief créatif / idée pipeline :"} ${params.idea}
Nombre de pages : ${params.pageCount}
Thème / style : ${params.style}
Public : ${params.audience || DEFAULT_AUDIENCE}
${nameBlock}
${genderBlock}
${parentBlock}

BRIEF DE RECHERCHE (à respecter, sans écraser l'idée originale) :
${params.researchJson}

Produis maintenant le plan JSON complet du livre de coloriage niveau librairie/KDP :
titre, concept, bible visuelle LOCK (avec introducedOnPage), storyboard page par page avec action CONCRÈTE, characterPoses, camera, pageSetting, focalPoint, illustrationDescription ET negativePrompt.
Rappel : FIDÉLITÉ histoire du parent d'abord ; héros = ENFANT au bon genre ; cast serré ; visualLock anglais identique partout ; characterIds seulement depuis la bible ; variété d'angles et de poses ; CHAQUE page avec environnement riche colorable ; max 2 personnages par scène.`;
}

/**
 * KDP-grade negative prompt (for models that support `negative_prompt`, e.g. SDXL/SD).
 * Flux ignores negatives, so its craft constraints are kept short and positive in
 * `buildColoringPagePrompt` instead of folding this whole list into the prompt.
 */
export const COLORING_NEGATIVE_PROMPT = [
  "color, colored, grayscale, gray shading, shadows, gradients, cross-hatching, hatching,",
  "filled black areas, solid black fills, screentones, texture noise,",
  "photorealistic, photo, 3D render, painting, watercolor, realistic rendering,",
  "blurry, low quality, messy lines, sketchy, unfinished,",
  "text, letters, words, caption, watermark, logo, signature, page numbers, speech bubbles, dialogue balloons, text boxes,",
  "comic strip, comic book page, manga page, panels, multiple panels, split panels, panel borders, gutters, storyboard grid, collage layout,",
  "extra fingers, too many fingers, fused fingers, deformed hands, malformed hands, missing limbs,",
  "floating head, detached body parts, cropped limbs, cut off at edge, out of frame,",
  "extra people, duplicate characters, cloned faces, inconsistent character design, changing outfits,",
  "unrelated extra adults, random adult bystanders with detailed faces, unrelated extra animals, wrong animal species,",
  "empty white void, blank background, floating characters, only grass tufts,",
  "scary, creepy, distorted anatomy, disfigured, nsfw,",
  "blank white eyes, hollow eyes, empty eyes, staring void eyes, pupil-less eyes, black empty sockets,",
  "horror, nightmare, traumatic face, uncanny valley, dead stare,",
  "elongated skull, deformed head, misshapen cranium, giant forehead blob, stretched face",
].join(" ");

/**
 * Anti-lineup negative: the #1 audit defect was every page showing the cast
 * standing in a row, front-facing, only the background changing (the Kontext
 * reference lineup bleeding into the composition). Sent as a REAL negative to
 * models that support it (Ideogram); folded as positive "do not" clauses into
 * Kontext prompts (Flux family ignores negative_prompt).
 */
export const ANTI_LINEUP_NEGATIVE =
  "characters standing in a row, front-facing lineup, model sheet, character reference sheet, static group photo, characters posing side by side, everyone facing the camera, characters standing still doing nothing";

/** Soft, printable child faces — injected into covers and pages. */
export const CHILD_SAFE_FACE_POSITIVE =
  "Friendly warm cartoon child faces: each eye MUST show a clear dark pupil AND iris inside a neat eye outline (closed shapes to color), soft rounded cheeks, gentle smile, natural round child head proportions — NEVER blank white eyes, NEVER hollow staring eyes, NEVER elongated or deformed skull, NEVER creepy.";

export const CHILD_SAFE_FACE_NEGATIVE =
  "blank white eyes, hollow eyes, empty eyes, pupil-less eyes, staring void eyes, black empty sockets, creepy face, horror, nightmare, uncanny valley, traumatic expression, dead stare, sharp teeth, elongated skull, deformed head, misshapen cranium, giant forehead blob";

/** Mandatory rich scenery so children have lots to color beyond the hero. */
export const RICH_ENVIRONMENT_POSITIVE =
  "SINGLE FULL-PAGE COLORING SCENE: one continuous edge-to-edge composition, never comic panels, never a grid, never split frames, never speech bubbles or text boxes. MANDATORY RICH COLORABLE ENVIRONMENT edge-to-edge: ground/path, sky or canopy, 4–6 large props from THIS scene (trees, huts, rocks, flowers, fences, pots, cloths — market stalls only if the scene is a market). Hero ≤40% of frame. FORBIDDEN: empty white void, floating character, portrait on blank paper.";

/**
 * Injected identically on every page of a book so Ideogram does not switch
 * "artist hand" / line weight mid-book (parent text-only path especially).
 */
export const BOOK_SERIES_STYLE_LOCK =
  "BOOK SERIES LOCK (identical every page): same controlled thick black outline system with gently varied organic emphasis, same children's book ink hand, same character face/hair/outfit proportions, same world drawing language — looks like ONE professional artist drew the whole book. Never switch style, never become sketchier, thinner or more detailed than adjacent pages.";

/** Gender-specific positives/negatives for parent hero identity. */
export function heroGenderPromptBits(gender?: string | null): {
  positive: string;
  negative: string;
} {
  if (gender === "girl") {
    return {
      positive:
        "HERO GENDER LOCK: this hero is a YOUNG GIRL child — feminine child face and hair, NEVER a boy, NEVER an adult woman or man.",
      negative:
        "boy, young boy, little boy, male child, son, brother, adult woman, adult man, twin, clone, duplicate child, identical twin, crowd of children, extra children, extra kids",
    };
  }
  if (gender === "boy") {
    return {
      positive:
        "HERO GENDER LOCK: this hero is a YOUNG BOY child — masculine child face and hair, NEVER a girl, NEVER an adult man or woman.",
      negative:
        "girl, young girl, little girl, female child, daughter, sister, adult woman, adult man, twin, clone, duplicate child, identical twin, crowd of children, extra children, extra kids",
    };
  }
  return {
    positive:
      "HERO LOCK: ONE young child hero only — never an adult, never duplicate clones of the hero.",
    negative:
      "adult, twin, clone, duplicate child, identical twin, crowd of children, extra children, extra kids",
  };
}

/** Build the final negative prompt for a page (shared base + anti-lineup + optional page/world-specific). */
export function buildNegativePrompt(
  pageNegative?: string,
  worldNegative?: string,
  heroGender?: string | null
): string {
  const genderNeg = heroGenderPromptBits(heroGender).negative;
  return [
    COLORING_NEGATIVE_PROMPT,
    ANTI_LINEUP_NEGATIVE,
    CHILD_SAFE_FACE_NEGATIVE,
    "wrong art style mid-book, inconsistent line weight, different artist style, sketchy thin lines mixed with thick, photoreal jump, painterly style",
    genderNeg,
    (pageNegative || "").trim(),
    (worldNegative || "").trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Setting-bible negative: derived from the universe's forbidden elements (never hardcoded). */
export function buildWorldNegative(forbiddenElements?: string[]): string {
  const list = (forbiddenElements || []).map((e) => e.trim()).filter(Boolean);
  if (!list.length) return "";
  return list.map((e) => `no ${e.replace(/^no\s+/i, "")}`).join(", ");
}

export function buildColoringPagePrompt(params: {
  scene: string;
  characters: string;
  style: string;
  world: string;
  shotType?: string;
  comicBeat?: string;
  negativePrompt?: string;
  /** 2–4 setting-bible elements to anchor the world on this page. */
  settingElements?: string[];
  /** Parent books: lock gender + series hand. */
  heroGender?: string | null;
  consistencyMode?: boolean;
}): string {
  const craft = styleImageCraftLine(params.style);
  const genderBits = heroGenderPromptBits(params.heroGender);

  const shot =
    params.shotType === "mid_shot"
      ? "Mid-shot: complete head and torso inside the frame."
      : params.shotType === "wide"
        ? "Wide shot: full figures inside a rich environment with large colorable props."
        : params.shotType === "close_safe"
          ? "Close-but-safe: full face and shoulders inside the frame, background props still visible."
          : "Full-body action shot: characters actively moving in the environment, head-to-toe inside the frame.";

  const settingLine = (params.settingElements || []).filter(Boolean).slice(0, 4);

  return [
    "TRUE COLORING-BOOK PAGE — ONE SINGLE FULL-PAGE CONTINUOUS SCENE. NO comic panels, NO split frames, NO grid, NO gutters, NO speech bubbles, NO captions or text inside the image.",
    craft,
    params.consistencyMode ? BOOK_SERIES_STYLE_LOCK : "",
    genderBits.positive,
    `SCENE: ${params.scene}`,
    params.world
      ? `Draw the full setting as a colorable environment (not empty): ${params.world}.`
      : "",
    settingLine.length
      ? `World anchors to include in the scenery (draw the ones that fit this scene): ${settingLine.join(", ")}.`
      : "",
    shot,
    params.characters
      ? `Draw ONLY these exact named characters and NO other people or animals — EXACTLY the named cast, zero background children, zero clone twins of the hero. Keep each character's species, gender, skin tone, hair and outfit EXACTLY as locked, identical on every page: ${params.characters}.`
      : "",
    "The characters are IN THE MIDDLE OF THE ACTION described in the scene — dynamic distinct poses, NOT standing in a row, NOT posing front-facing side by side, NOT a static group photo.",
    CHILD_SAFE_FACE_POSITIVE,
    RICH_ENVIRONMENT_POSITIVE,
    "Prefer a wide or full-body shot inside a busy scene — avoid tight portrait close-ups with empty backgrounds.",
    "Full bodies inside the frame, simple mitten-style kid hands, at most 2 characters, no extra people.",
    params.comicBeat ? `Narrative moment across the book: ${params.comicBeat}; this does NOT mean comic layout.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Poster-grade cover (audit fix T6): heroes IN ACTION in the world's signature
 * setting — never a flat lineup on a beige void — with the top band reserved for
 * the hand-lettered title. Ideogram V3 renders lettering well, so the title is
 * part of the prompt (benchmark showed this beats a server-side overlay for charm;
 * a vision QC re-roll catches illegible lettering).
 */
export function buildCoverPrompt(params: {
  title: string;
  characters: string;
  style: string;
  summary: string;
  /** Concrete action scene for the cover (falls back to summary). */
  action?: string;
  /** Signature world elements from the setting bible. */
  settingElements?: string[];
  /** When set, render the title as hand-lettering in the reserved top band. */
  renderTitle?: boolean;
}): string {
  const anchors = (params.settingElements || []).filter(Boolean).slice(0, 4);
  const titleClause = params.renderTitle
    ? `TITLE LETTERING: render the exact title text "${params.title}" in playful, bold, child-friendly hand-lettering INSIDE the reserved top band — large, perfectly legible, correctly spelled, black outline letters (colorable), no other text anywhere.`
    : "ABSOLUTELY NO TEXT: no letters, no words, no title, no captions, no numbers, no signage anywhere in the image.";
  return [
    "Children's coloring book COVER — a lively POSTER, not a character sheet:",
    "vertical composition with the TOP THIRD kept visually calm (simple sky or canopy) as a reserved title band,",
    titleClause,
    `MAIN SCENE (lower two thirds): the heroes IN THE MIDDLE OF AN ACTION — ${params.action || params.summary} —`,
    "dynamic distinct poses telling the story at a glance; NOT standing in a row, NOT a front-facing lineup, NOT posing side by side on an empty background.",
    CHILD_SAFE_FACE_POSITIVE,
    anchors.length
      ? `Set them in the world's signature scenery: ${anchors.join(", ")} — rich colorable environment filling the frame.`
      : "Rich colorable signature environment of the story filling the frame.",
    "Pure black and white line art only — bold thick outlines, large colorable shapes, no color, no shading, no grey, no photorealism, no watermark.",
    "The cover may show the full main cast (that is its job) but IN SCENE and in action, clear separation, friendly energy,",
    "same CHARACTER LOCK as interior pages — identical designs, draw ONLY the named cast, no other people or animals,",
    params.characters ? `CHARACTER LOCK (identical): ${params.characters}.` : "",
    styleImageCraftLine(params.style),
    `story mood: ${params.summary}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Hero cast portrait used as the identity reference for reference-guided (Kontext) pages.
 *
 * PROVEN formulation (phase-2 A/B, public/_phase2ab/_hero.png): a COLORED flat-cartoon
 * cast portrait — NOT a B&W turnaround. The colored portrait reliably renders the correct
 * cast (girl + real fox), gives the edit model a much stronger identity signal (skin tone,
 * hair, outfit pattern, species), and is programmatically checkable (a degenerate B&W
 * "two generic kids" sheet fails the colored gate). Pages themselves are converted back
 * to pure B&W line art by the reference-guided scene prompt + the color guard.
 *
 * Structure: cast lock UP FRONT (a lock buried at the end of a long craft preamble is
 * exactly what produced the wrong "two boys" hero), then species/count enforcement.
 */
export function buildCharacterSheetPrompt(params: {
  characters: string;
  style: string;
  /** Exact number of characters in the brief — the sheet must contain EXACTLY this many figures. */
  castCount?: number;
  /** When true, keep likeness of a real child photo (Kontext/img2img). */
  identityFromPhoto?: boolean;
}): string {
  const referenceCraft =
    "PREMIUM COLORED CHARACTER DESIGN REFERENCE: soft flat colors, crisp organic outlines, clean readable silhouette, accurate child anatomy or natural animal anatomy, plain white background. This is NOT a coloring page: no B&W-only rule, no scenery, no text.";
  const countClause = params.castCount
    ? `EXACTLY ${params.castCount} figure${params.castCount > 1 ? "s" : ""} in the image — count them: ${params.castCount}, not one more, not one less.`
    : "";
  if (params.identityFromPhoto) {
    return [
      "Transform the reference PHOTO into ONE friendly children's picture-book CHARACTER PORTRAIT of THIS SAME CHILD (colored flat cartoon), FULL BODY head-to-toe on a plain white background.",
      "CRITICAL LIKENESS: keep the child's face shape, skin tone, hairstyle, age and expression recognizable — soft cartoon, NOT photorealistic, NOT a different child, NOT an adult.",
      CHILD_SAFE_FACE_POSITIVE,
      `CHARACTER LOCK to honor: ${params.characters}.`,
      "EXACTLY ONE figure — the hero child only. No siblings, no crowd, no adults.",
      countClause,
      referenceCraft,
      "Soft flat COLORS, clean bold cartoon outlines, warm and joyful. NO text, no letters, no watermark, no scary eyes, no adult proportions.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "Children's picture-book character reference portrait: the story's main cast side by side on a plain white background, FULL BODY head-to-toe, large, clearly visible, clearly separated. HUMAN characters face the viewer standing; ANIMAL characters are shown in SIDE PROFILE standing naturally on ALL FOUR LEGS.",
    `DRAW EXACTLY THIS CAST — one figure per listed character, nobody else: ${params.characters}.`,
    countClause,
    CHILD_SAFE_FACE_POSITIVE,
    referenceCraft,
    "Each character keeps their exact species, gender, age, skin tone, hairstyle and outfit as described — no substitutions, no duplicates, no twins.",
    "Any ANIMAL character is a REAL animal of its species standing ON ALL FOUR LEGS in natural side profile (a fox = real four-legged fox with pointy ears, slender snout, bushy tail; an elephant = real elephant calf on four legs with its trunk down) — NOT a dog, NOT a human child, NOT standing upright on two legs, NOT wearing a collar or clothes, NOT anthropomorphic.",
    "Soft flat COLORS with clean bold cartoon outlines, friendly and warm, simple shapes for young children.",
    "NO other people, NO extra children, NO adults, NO crowd, no scene background, no props, no text, no letters, no watermark.",
  ].join(" ");
}

/**
 * Negative prompt for the hero cast portrait (Ideogram accepts real negatives).
 * Generic on purpose (no hardcoded species/genders — the cast varies per book):
 * blocks cast drift (extra/duplicate people), species drift (animal → human/dog),
 * and the degenerate B&W output the colored gate would reject anyway.
 */
export const CHARACTER_SHEET_NEGATIVE_PROMPT = [
  "black and white, monochrome, line art only, uncolored, coloring page,",
  "extra people, extra children, extra adults, crowd, background people,",
  "duplicate characters, identical twins, same character twice, character replaced by a different character,",
  "animal drawn as a human, animal replaced by a child, wrong animal species,",
  "bipedal animal, animal standing on two legs, animal wearing clothes, animal wearing a collar, anthropomorphic animal,",
  "scene background, landscape, props, furniture,",
  "text, letters, words, labels, watermark, logo, signature,",
  "photorealistic, photo, 3D render, scary, distorted anatomy, nsfw,",
  CHILD_SAFE_FACE_NEGATIVE,
].join(" ");

/**
 * Prompt when guiding from the hero cast portrait (Kontext / img2img).
 * The reference is COLORED (strong identity signal); the output must be pure B&W.
 *
 * ORDER IS LOAD-BEARING (verified across runs): the "redraw as PURE BLACK AND WHITE
 * coloring page" directive must come FIRST, before the scene. An action-first variant
 * made Kontext keep the reference's colors on 6/6 pages (colorRatio ~0.83) and bake in
 * signage text. This structure mirrors the phase-2 A/B winner (0 colored / 0 blank),
 * with one added clause for pose variety so pages don't repeat the static portrait pose.
 */
export function buildReferenceGuidedScenePrompt(params: {
  scene: string;
  characters: string;
  style: string;
  world: string;
  /** The page's ONE concrete action — drives the identity/composition decoupling. */
  action?: string;
  /** 2–4 setting-bible anchors for this scene. */
  settingElements?: string[];
}): string {
  const anchors = (params.settingElements || []).filter(Boolean).slice(0, 4);
  // Ultra-short for Kontext: identity + this page's action/camera only (long prose → lineup bleed).
  // Prefer compact when scene is already structured (refScene / buildCompactScene).
  if ((params.scene || "").length < 420) {
    return [
      "TRUE COLORING-BOOK PAGE: ONE SINGLE FULL-PAGE CONTINUOUS B&W SCENE. NO comic panels, NO split frames, NO grid, NO gutters, NO speech bubbles, NO captions or text. Keep ONLY identity from reference (faces, hair, outfits, species). DISCARD reference poses AND plain white background completely.",
      params.action ? `ACTION mid-motion: ${params.action}.` : "",
      `SCENE with RICH ENVIRONMENT filling the page: ${params.scene}`,
      anchors.length ? `Draw these props large: ${anchors.join(", ")}.` : "",
      RICH_ENVIRONMENT_POSITIVE,
      CHILD_SAFE_FACE_POSITIVE,
      styleKontextCue(params.style),
      "New camera + dynamic poses. Wide scene, hero smaller in frame. No blank void. No color, no text.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    // ORDER IS LOAD-BEARING (see history above): B&W directive FIRST, before the scene.
    "Redraw the reference characters in a NEW scene as an expert children's coloring book page: ONE SINGLE FULL-PAGE CONTINUOUS COMPOSITION — NEVER comic panels, split frames, grids, gutters, speech bubbles, captions or text boxes. PURE BLACK AND WHITE LINE ART ONLY, bold thick uniform black outlines on white paper, strong clean confident ink lines suitable for printing, large white areas to color, closed shapes, absolutely NO color, no colored fills, no shading, no grey, no text, no letters, no watermark, no signage.",
    // Audit fix T2: decouple IDENTITY (keep) from COMPOSITION (discard). The reference
    // is a front-facing lineup and used to dictate every page's composition.
    "From the reference image keep ONLY the characters' IDENTITY: same faces, hair, outfits, proportions and animal species (a fox stays the SAME real four-legged fox walking on four paws, not a dog, not a person, not bipedal).",
    "DISCARD the reference's COMPOSITION COMPLETELY: this is a NEW scene with NEW poses and a NEW camera angle. Do NOT reproduce the reference's standing row, front-facing lineup, poses, spacing or plain background in any way.",
    params.action
      ? `THE CHARACTERS ARE ACTIVELY DOING THIS, mid-motion: ${params.action}.`
      : "",
    `NEW SCENE (draw a rich colorable environment filling the page, no empty white void): ${params.scene}`,
    anchors.length
      ? `World anchors to include in the scenery where they fit: ${anchors.join(", ")}.`
      : "",
    isWestAfricanStyle(params.style)
      ? "HARD West African lock: deep/medium-deep brown skin, natural African hair, dignified West African clothing and scenery — never European-default cast."
      : styleImageCraftLine(params.style),
    "FORBIDDEN: characters standing in a row; front-facing lineup; static group photo; characters posing side by side; everyone facing the camera; characters standing still doing nothing; model-sheet layout.",
    "Full bodies inside the frame with margins, characters separated; at most the reference characters in the foreground — NO extra people with detailed faces, NO extra animals, NO duplicate heroes.",
    "Simplified mitten-style kid hands or hands holding objects; no extra or fused fingers.",
    `style: ${params.style},`,
    params.characters ? `CHARACTER LOCK: ${params.characters}.` : "",
    params.world ? `setting (must be drawn as environment): ${params.world}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Setting bible generation (audit fix T3): once per universe, a compact visual
 * world contract — recurring drawable elements + hard exclusions — so every page
 * of every book stays in the SAME world (no European street in an African
 * village, no suburban houses on an alien planet).
 */
export function buildSettingBibleSystemPrompt(): string {
  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : BIBLE DE DÉCOR DE L'UNIVERS
Réponds UNIQUEMENT en JSON valide, sans markdown.
Tu définis le contrat visuel du MONDE d'un univers de livres de coloriage.

Objectifs :
1. worldSummary : une ligne en ANGLAIS qui identifie le monde (ex. "rural West African savanna village at golden hour").
2. elements : 8 à 12 éléments VISUELS et DESSINABLES du monde, en ANGLAIS, concrets et colorables (ex. village africain → "giant baobab tree", "round banco clay houses with thatched roofs", "wax-print fabrics drying on a line", "open-air market stalls", "calabash bowls", "red laterite dirt path" ; espace → "sleek rocket ship", "ringed planets in the sky", "glowing crystal formations", "star fields").
3. forbiddenElements : 3 à 8 éléments visuels INTERDITS car hors-monde, en ANGLAIS (ex. monde africain rural → "European suburban houses", "modern glass windows", "paved city streets" ; espace → "suburban houses", "earthly streets"). Déduis-les du monde décrit — n'invente pas d'interdits sans rapport.

Règles : fidèle à l'univers décrit, respectueux (pas de stéréotypes), éléments simples à dessiner en line-art enfant.

Structure JSON :
{"worldSummary": string, "elements": string[], "forbiddenElements": string[]}`;
}

export function buildSettingBibleUserPrompt(params: {
  universeTitle: string;
  universeDescription?: string;
  worldSetting?: string;
  style?: string;
}): string {
  return [
    `Univers : ${params.universeTitle}`,
    params.universeDescription ? `Description : ${params.universeDescription}` : "",
    params.worldSetting ? `Monde de l'histoire en cours : ${params.worldSetting}` : "",
    params.style ? `Style graphique : ${params.style}\n${styleContractSystemBlock(params.style)}` : "",
    "",
    "Produis la bible de décor JSON (worldSummary, elements, forbiddenElements).",
  ]
    .filter(Boolean)
    .join("\n");
}
