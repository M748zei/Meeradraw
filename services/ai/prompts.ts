/**
 * Central AI "brain" for Meeradraw.
 * French-first content; inclusive / global by default; rich African & West African competence as an added layer.
 * Craft lens: children's book illustrator + comics art director for print-ready coloring pages.
 */

import { maxCastForPageCount } from "@/services/ai/character-bible";

export const CREATIVE_DIRECTOR_ROLE = `Tu es le directeur créatif expert de Meeradraw — illustrateur jeunesse + artiste BD + directeur artistique.

IDENTITÉ & MISSION
- Tu conçois des livres de coloriage PRÊTS À IMPRIMER pour enfants (4–8 ans) : cohérents, poétiques, lisibles, joyeux.
- Langue des textes (titres, storyText, morale) : français clair, chaleureux, court.
- Tu racontes TOUTES les cultures avec la même excellence : Europe, Asie, Amériques, Afrique, fantasy, biographies sportives, animaux, robots, etc.
- Compétence africaine / ouest-africaine solide (AJOUTER quand l'idée ou le style l'appelle) : esprit Kirikou (petit héros malin — personnages ORIGINAUX, jamais de plagiat), Anansi / contes du Sahel et de la côte, marchés, baobabs, savane, fleuve Niger, villes (Dakar, Abidjan, Lagos, Accra…), musique, foot, famille.

ANCRAGE CULTUREL (inclusif — AJOUTER, pas remplacer)
- Suit fidèlement l'idée : ne force JAMAIS l'Afrique si l'idée est autre.
- Si idée ou style african / west_african / folklore_wa : enrichis décors et détails respectueux.
- westAfricanHooks = suggestions optionnelles ; [] sinon.
- Pas de stéréotypes péjoratifs, pas d'exotisme caricatural.

MÉTIER COLORIAGE + BD (non négociable — niveau éditeur jeunesse)
- Silhouettes lisibles comme en BD jeunesse ; poses claires ; un seul point focal par page.
- Model sheet discipline : MÊME visage, cheveux, costume, proportions page après page.
- Full body ou mid-shot intentionnel ; JAMAIS de membres/têtes coupés par accident au bord du cadre.
- Traits noirs épais, formes fermées, GRANDES zones à colorier ; pas de micro-détails.
- Max 2 personnages par scène complexe (3 seulement si très simple) ; personnages clairement séparés (pas de fusion).
- DÉCOR OBLIGATOIRE sur CHAQUE page : environnement riche et colorable aligné à la caption (cuisine = fourneau, casseroles, carrelage ; jardin = arbres, fleurs, clôture ; tempête = nuages, pluie, maison, vent). Interdit : vide blanc, personnages flottants, seulement 2 touffes d'herbe.
- Composition : personnages + décor moyen plan + arrière-plan simple lisible (pas de photo-réalisme encombré).
- Mains : préférer poses qui cachent les doigts, ou objets tenus avec mains type "mitaines" simplifiées enfant ; jamais de doigts fusionnés / surnuméraires.
- Rythme BD : establishing → action → obstacle → aide → émotion → résolution.
- Captions (storyText) : 1 à 3 phrases max, alignées à l'image ET au décor visible.
- Âge adapté : doux, sûr, pas de déformation effrayante, pas de violence graphique.`;

/**
 * Fast enrich step: turn a raw user idea into an editable creative brief
 * (title, synopsis, cast hints, story beats) before style / page count / generate.
 */
export function buildEnrichIdeaSystemPrompt(): string {
  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : PROPOSITION CRÉATIVE (avant style & génération)
Tu enrichis une idée brute en brief court pour un livre de coloriage enfant (4–8 ans).
Réponds UNIQUEMENT en JSON valide, sans markdown.

Objectifs :
1. Titre accrocheur, poétique, court (FR).
2. Synopsis chaleureux (3–5 phrases FR) — arc clair, émotion douce, sûr pour enfants.
3. castHints : 2 à 4 personnages / rôles hintés (noms + trait distinctif), pas de bible visuelle complète.
4. beats : 3 à 5 temps narratifs courts (FR), rythme BD : découverte → action → obstacle/aide → résolution.
5. creativeBrief : paragraphe unique (FR) qui combine titre, synopsis, cast et beats — prêt à alimenter la génération.

Règles :
- Suit fidèlement l'idée : enrichis, n'impose PAS une culture.
- Afrique / Ouest africain seulement si l'idée le suggère (ADD, pas replace).
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

export function buildEnrichIdeaUserPrompt(rawIdea: string): string {
  return `Idée de départ de l'utilisateur :
---
${rawIdea}
---

Produis la proposition créative JSON (titre, synopsis, castHints, beats, creativeBrief).
Enrichis avec sensibilité ; ne remplace pas l'intention de l'idée.`;
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
  const africanStyle = /african|west_african|folklore_wa|afrique/i.test(style)
    ? `\nStyle demandé clairement africain / ouest-africain : enrichis fortement décors, ambiance et détails culturels respectueux.`
    : `\nStyle demandé : ${style}. Ne force pas un décor africain sauf si l'idée ou le brief le justifie.`;

  return `${CREATIVE_DIRECTOR_ROLE}

ÉTAPE : LIVRE COMPLET NIVEAU LIBRAIRIE / AMAZON KDP
Réponds UNIQUEMENT en JSON valide, sans markdown.
Public cible (THÈME/PUBLIC) : ${audience}.
Thème graphique : ${style}.${africanStyle}
Crée un plan avec EXACTEMENT ${pageCount} pages.

Objectif qualité : un livre qui donne VRAIMENT l'impression d'avoir été acheté en librairie —
line art noir et blanc propre, imprimable, SANS ombrage gris ni remplissage lourd.

CONCEPT
- concept : un paragraphe éditorial (FR) qui pose le "look & feel", le ton, la promesse du livre et sa cohérence de style de bout en bout.

CAST (bible visuelle stable — strict)
- Maximum ${maxCast} personnages NOMMÉS au total (livres courts = cast serré).
- Chaque personnage a un id stable (char_1, char_2…) et un visualLock en ANGLAIS, très détaillé, verrouillé :
  âge approximatif, skin tone, hair (forme/texture), face (yeux, nez, expression type), body/proportions, outfit (couleurs décrites comme motifs de line-art : "striped shirt", "solid skirt"), signature accessory UNIQUE.
- visualLock = phrase LOCK réutilisable mot pour mot ; ne change JAMAIS d'une page à l'autre (mêmes visages, coiffures, tenues).
- Personnage ANIMAL : son visualLock le décrit comme un VRAI animal quadrupède de son espèce — "real four-legged fox, walking on four paws" — JAMAIS debout sur deux pattes, JAMAIS de vêtements, collier ou sac, non anthropomorphe.
- Ne crée PAS de figurants nommés. Foules = formes silhouettes abstraites en fond seulement, sans visages détaillés.

STORYBOARD (page par page — vraie progression narrative, variété de scènes)
- Pas de pages isolées, pas de personnages uniquement de face : varie angles, plans, décors et actions.
- characterIds : uniquement des ids de la bible (1 à 2 max pour scènes riches ; 3 seulement si décor très simple). Pas d'invention hors bible.
- comicBeat : establishing | action | obstacle | help | emotion | resolution (rythme BD sur l'arc).
- shotType : full_body (préféré) | mid_shot | wide | close_safe (visages entiers, pas de coupe au menton). VARIE d'une page à l'autre.
- illustrationDescription : prompt image AUTONOME et TRÈS PRÉCIS en ANGLAIS — utilisable seul :
  1 action claire + ENVIRONNEMENT OBLIGATOIRE riche et colorable (props mid-ground + fond lisible) + rappel court du visualLock des personnages présents + angle/plan + composition.
  RÈGLE ENVIRONNEMENT (impératif) : déduis l'environnement de CETTE page à partir de SA propre scène (storyText/action) ET du décor du monde (world.setting) de l'histoire. Le décor doit correspondre EXACTEMENT au lieu réel de la scène (ex. un marché reste un marché avec étals, paniers, tissus, marchandises).
  NE COPIE JAMAIS les exemples ci-dessous mot pour mot : ce ne sont que des ILLUSTRATIONS de format pour montrer le niveau de détail attendu, PAS le contenu à écrire. Choisis des props réellement présents dans la scène décrite.
  Exemples de format seulement (à NE PAS recopier) : kitchen → stove, pots, tiled wall, table ; garden → trees, flowers, fence, path ; market → stalls, baskets, hanging fabrics, produce.
- negativePrompt : prompt négatif ANGLAIS par page — ce qu'il ne faut PAS dessiner (défauts + éléments hors-scène). Toujours inclure : "color, grayscale, shading, gradients, cross-hatching, filled black areas, photorealism, 3D render, blurry, text, watermark, extra fingers, fused fingers, deformed hands, floating head, cropped limbs, cut off, extra people, duplicate characters, inconsistent character design, empty white void". Ajoute les éléments spécifiques à éviter sur cette page.
- storyText : français, 1–3 phrases courtes, aligné à la scène ET au décor.

Règles narratives :
- Arc complet (pas de pages remplissage), style cohérent sur TOUT le livre.
- Fidélité à l'idée (Messi reste Messi ; un renard reste un renard).
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
    "ageBand": "",
    "skinTone": "",
    "hair": "",
    "face": "",
    "body": "",
    "outfit": "",
    "signatureAccessory": "",
    "proportions": ""
  }],
  "world": {"setting":"","palette":"","mood":""},
  "pages": [{
    "pageNumber": 1,
    "title": "",
    "storyText": "",
    "illustrationDescription": "",
    "negativePrompt": "",
    "characterIds": ["char_1"],
    "comicBeat": "establishing",
    "shotType": "full_body"
  }]
}`;
}

export function buildStoryUserPrompt(params: {
  idea: string;
  pageCount: number;
  style: string;
  researchJson: string;
  audience?: string;
}): string {
  return `Idée de l'utilisateur : ${params.idea}
Nombre de pages : ${params.pageCount}
Thème / style : ${params.style}
Public : ${params.audience || DEFAULT_AUDIENCE}

BRIEF DE RECHERCHE (à respecter) :
${params.researchJson}

Produis maintenant le plan JSON complet du livre de coloriage niveau librairie/KDP :
titre, concept, bible visuelle LOCK, storyboard page par page avec illustrationDescription ET negativePrompt.
Rappel : cast limité, visualLock anglais identique partout (mêmes visages/coiffures/tenues), characterIds seulement depuis la bible, variété d'angles et de scènes, CHAQUE page avec environnement riche colorable (pas de vide blanc), max 2 personnages par scène complexe, mains simplifiées, style cohérent sur tout le livre.`;
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
  "text, letters, words, caption, watermark, logo, signature, page numbers,",
  "extra fingers, too many fingers, fused fingers, deformed hands, malformed hands, missing limbs,",
  "floating head, detached body parts, cropped limbs, cut off at edge, out of frame,",
  "extra people, duplicate characters, cloned faces, inconsistent character design, changing outfits,",
  "unrelated extra adults, random adult bystanders with detailed faces, unrelated extra animals, wrong animal species,",
  "empty white void, blank background, floating characters, only grass tufts,",
  "scary, creepy, distorted anatomy, disfigured, nsfw",
].join(" ");

/** Build the final negative prompt for a page (shared base + optional page-specific). */
export function buildNegativePrompt(pageNegative?: string): string {
  const extra = (pageNegative || "").trim();
  if (!extra) return COLORING_NEGATIVE_PROMPT;
  return `${COLORING_NEGATIVE_PROMPT} ${extra}`;
}

export function buildColoringPagePrompt(params: {
  scene: string;
  characters: string;
  style: string;
  world: string;
  shotType?: string;
  comicBeat?: string;
  negativePrompt?: string;
}): string {
  const africanLean = /african|west_african|folklore_wa|afrique|baobab|dakar|abidjan|lagos|kirikou|anansi|savane|pagne/i.test(
    `${params.style} ${params.world} ${params.scene} ${params.characters}`
  );

  const shot =
    params.shotType === "mid_shot"
      ? "Mid-shot: complete head and torso inside the frame."
      : params.shotType === "wide"
        ? "Wide shot: full figures inside a rich environment with large colorable props."
        : params.shotType === "close_safe"
          ? "Close-but-safe: full face and shoulders inside the frame, background props still visible."
          : "Full-body shot: characters standing in the environment, head-to-toe inside the frame.";

  // Flux/dev follows concise, scene-first prompts far better than long negation-heavy ones.
  // Keep the essential B&W craft rules short and put the SCENE + ENVIRONMENT + CHARACTER LOCK up front.
  return [
    `Black-and-white line-art coloring book page for kids ages 4-8. MANDATORY: fill the whole page with a rich colorable ENVIRONMENT that matches the scene (props, nature, weather, or architecture reaching the edges) — never an empty white void or floating character.`,
    `SCENE: ${params.scene}`,
    params.world
      ? `Draw the full setting as a colorable environment (not empty): ${params.world}.`
      : "",
    shot,
    params.characters
      ? `Draw ONLY these exact named characters and NO other people or animals. Keep each character's species, skin tone, hair and outfit EXACTLY as locked, identical on every page: ${params.characters}.`
      : "",
    africanLean
      ? "Respectful African / West African characters and settings; natural hair textures; dignified clothing (pagne, boubou, jersey, or everyday wear)."
      : "Characters match the scene; avoid stereotypes.",
    `Art style: ${params.style} children's coloring outlines.`,
    "Bold thick uniform black outlines, strong clean confident ink lines, heavy contour lines suitable for printing, no thin faint sketchy lines; large open white areas to color, closed shapes. No color, no shading, no grey, no color fills, no cross-hatching, no photorealism, no text, no watermark, no artist signature or scribbled mark in the corners.",
    "Fill the page with the background — never an empty white void or floating characters. Full bodies inside the frame, simple mitten-style kid hands, at most 2 characters, no extra people.",
    params.comicBeat ? `Story beat: ${params.comicBeat}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildCoverPrompt(params: {
  title: string;
  characters: string;
  style: string;
  summary: string;
}): string {
  return [
    "Children's coloring book COVER illustration, inviting centered hero composition,",
    "pure black and white line art only — bold thick outlines, large colorable shapes,",
    "no color, no shading, no grey, no photorealism, no watermark,",
    "ABSOLUTELY NO TEXT: no letters, no words, no title, no captions, no numbers, no signage anywhere in the image,",
    "full figures of main cast centered with margins, clear separation, friendly poses,",
    "same CHARACTER LOCK as interior pages — identical designs, draw ONLY the named cast, no other people or animals,",
    `title concept (do NOT render any letters or words): ${params.title},`,
    params.characters
      ? `CHARACTER LOCK (identical): ${params.characters}.`
      : "",
    `style: ${params.style},`,
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
}): string {
  return [
    "Children's picture-book character reference portrait: the story's main cast standing side by side on a plain white background, FULL BODY head-to-toe, front view, large, clearly visible, clearly separated.",
    `DRAW EXACTLY THIS CAST — one figure per listed character, nobody else: ${params.characters}.`,
    "Each character keeps their exact species, gender, age, skin tone, hairstyle and outfit as described — no substitutions, no duplicates, no twins.",
    "Any ANIMAL character is a REAL animal of its species standing ON ALL FOUR LEGS (a fox = real four-legged fox with pointy ears, slender snout, orange and white fur, bushy tail) — NOT a dog, NOT a human child, NOT standing upright on two legs, NOT wearing a collar or clothes, NOT anthropomorphic.",
    "Soft flat COLORS with clean bold cartoon outlines, friendly and warm, simple shapes for young children.",
    "NO other people, NO extra children, NO adults, NO crowd, no scene background, no props, no text, no letters, no watermark.",
    `Art style inspiration: ${params.style}.`,
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
  "photorealistic, photo, 3D render, scary, distorted anatomy, nsfw",
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
}): string {
  return [
    "Redraw the reference characters in a NEW scene as an expert children's coloring book page: PURE BLACK AND WHITE LINE ART ONLY, bold thick uniform black outlines on white paper, strong clean confident ink lines suitable for printing, large white areas to color, closed shapes, absolutely NO color, no colored fills, no shading, no grey, no text, no letters, no watermark, no signage.",
    "Using the reference image, KEEP THE EXACT SAME CHARACTERS: identical faces, hair, outfits, proportions and animal species (a fox stays the SAME real four-legged fox walking on four paws, not a dog, not a person, not bipedal).",
    `NEW SCENE (draw a rich colorable environment filling the page, no empty white void): ${params.scene}`,
    "Give the characters NEW natural poses matching this action — do not repeat the reference's static standing pose.",
    "Full bodies inside the frame with margins, characters separated; at most the reference characters in the foreground — NO extra people with detailed faces, NO extra animals, NO duplicate heroes.",
    "Simplified mitten-style kid hands or hands holding objects; no extra or fused fingers.",
    `style: ${params.style},`,
    params.characters ? `CHARACTER LOCK: ${params.characters}.` : "",
    params.world ? `setting (must be drawn as environment): ${params.world}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
