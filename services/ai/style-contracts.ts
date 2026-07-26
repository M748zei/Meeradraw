/**
 * Hard per-style prompt contracts — the product heart of Meeradraw.
 * Every STYLE_OPTIONS id gets concrete, testable craft rules (not soft hints).
 */

export type StyleId =
  | "simple"
  | "kawaii"
  | "cartoon"
  | "cute"
  | "adventure"
  | "fantasy"
  | "west_african"
  | "folklore_wa";

export type StyleContract = {
  id: StyleId | string;
  /** Short EN line for image models (page / cover / sheet / Kontext). */
  imageCraft: string;
  /** Ultra-short EN cue for Kontext (identity path) — keep under ~120 chars. */
  kontextCue: string;
  /** VisualLock field requirements for story LLM (EN descriptors). */
  visualLockRules: string;
  /** Décor / world bias for story + setting (FR or EN, actionable). */
  worldBias: string;
  /** Forbidden look for this style. */
  forbidden: string;
  /** Optional density: how busy the line art may be. */
  density: "sparse" | "balanced" | "rich";
};

const BASE_COLORING =
  "Professional hand-inked children's-book line art with clean ORGANIC contours and gently varied line weight, closed shapes, large colorable white areas, pure B&W, no grey shading, no color fills, no photorealism, no text, no watermark. Natural expressive child faces with modest readable eyes, dark pupils and iris — never emoji eyes, giant glossy eyes, generic vector clipart, elongated heads or malformed anatomy.";

const CONTRACTS: Record<StyleId, StyleContract> = {
  simple: {
    id: "simple",
    density: "balanced",
    kontextCue: "Premium preschool ink: simple large shapes, rich scene, organic varied outlines.",
    imageCraft: `${BASE_COLORING} PREMIUM PRESCHOOL style: simple large closed shapes and clear silhouettes, but a COMPLETE scene with foreground, midground and background plus 6–10 large colorable props/zones. Easy for ages 3–5 without looking empty or cheap.`,
    visualLockRules:
      "visualLock: age, simple skin tone, simple hair shape, round friendly face, chunky body, ONE solid outfit color described as line pattern, ONE accessory max. Keep descriptors short.",
    worldBias:
      "Décors complets mais simples : premier plan, plan moyen et arrière-plan, avec 6–10 grands éléments fermés à colorier. Pas de micro-détail ni de grand vide.",
    forbidden:
      "no fine hatching, no tiny patterns, no crowded backgrounds, no empty scenery, no generic clipart, no giant glossy eyes, no complex architecture",
  },
  kawaii: {
    id: "kawaii",
    density: "balanced",
    kontextCue: "Kawaii: big round heads, tiny bodies, soft chubby cute shapes.",
    imageCraft: `${BASE_COLORING} KAWAII style: oversized round heads, tiny bodies, big sparkly eyes, soft chubby cheeks, pastel-friendly open shapes, cute props (stars, hearts as OPTIONAL background accents only if scene fits — no text). Rounded everything.`,
    visualLockRules:
      "visualLock: kawaii proportions (big head, small body), round eyes, soft cheeks, skin tone, bobble/puffy hair, pastel outfit described as line patterns, tiny signature accessory.",
    worldBias:
      "Monde doux et rond : formes organiques, nuages mous, petites maisons arrondies, props mignons — jamais effrayant.",
    forbidden:
      "no sharp angles, no scary teeth, no thin angular faces, no blank white eyes, no elongated skull, no deformed head, no realistic anatomy, no dark horror mood",
  },
  cartoon: {
    id: "cartoon",
    density: "rich",
    kontextCue: "Cartoon kids-comics: expressive gesture, dynamic silhouette, bold staging.",
    imageCraft: `${BASE_COLORING} CARTOON / comics-for-kids: expressive silhouettes, clear gesture lines, squash-and-stretch poses, readable comic staging, bold contours, secondary action in props. Dynamic camera.`,
    visualLockRules:
      "visualLock: age, skin, hair, face with a signature expression baseline, athletic or comic body proportions, outfit with 1–2 clear patterns, signature accessory — identical every page.",
    worldBias:
      "Décors BD jeunesse lisibles : plans clairs, un focal fort, props qui soutiennent l'action (pas de photo-réalisme).",
    forbidden:
      "no static mugshot poses, no photoreal faces, no muddy overlapping characters, no thin unfinished sketch lines",
  },
  cute: {
    id: "cute",
    density: "balanced",
    kontextCue: "Cute children's book: warm soft child proportions, cozy friendly faces.",
    imageCraft: `${BASE_COLORING} CUTE children's book style: warm friendly faces, soft child proportions, gentle smiles, cozy readable scenes, medium detail, inviting and safe.`,
    visualLockRules:
      "visualLock: childlike proportions, warm skin tone, soft hair, friendly eyes/nose/mouth, cozy outfit, one signature accessory — stable wording every page.",
    worldBias:
      "Ambiance chaleureuse : maison, jardin, école douce, nature accueillante. Émotion douce.",
    forbidden:
      "no harsh angles, no scary distortion, no blank white eyes, no elongated skull, no deformed head, no overcrowded panels, no cold clinical look",
  },
  adventure: {
    id: "adventure",
    density: "rich",
    kontextCue: "Adventure: mid-motion action, strong silhouette, energetic camera.",
    imageCraft: `${BASE_COLORING} ADVENTURE style: clear action focal, strong silhouettes mid-motion (run, climb, leap, push), bold environment props that support the stunt, energetic camera angles, one hero focus.`,
    visualLockRules:
      "visualLock: age, skin, hair, determined face baseline, active body proportions, practical adventure outfit, signature gear (backpack, scarf, tool) — identical every page.",
    worldBias:
      "Lieux d'aventure dessinables : sentier, rivière, colline, grotte, pont, forêt — chaque page un défi physique visible.",
    forbidden:
      "no static standing lineup, no passive watching poses as the main action, no empty void backgrounds",
  },
  fantasy: {
    id: "fantasy",
    density: "rich",
    kontextCue: "Soft fantasy: gentle visible magic as drawable shapes, whimsical clear lines.",
    imageCraft: `${BASE_COLORING} SOFT FANTASY style: gentle magic made VISIBLE as drawable shapes (sparkles as open stars, glowing orbs as circles, enchanted vines, soft castles), whimsical but clear outlines, never scary dark fantasy.`,
    visualLockRules:
      "visualLock: age, skin, hair, face, body, fantasy-tinged outfit (cape, soft crown, patterned robe) + ONE magical signature prop — identical every page. Magic must be drawable line shapes.",
    worldBias:
      "Monde féerique doux : clairière magique, château simple, pont de nuages, bibliothèque enchantée — magie visible et colorable.",
    forbidden:
      "no horror, no blood, no demonic imagery, no photoreal CGI look, no illegible swirl chaos",
  },
  west_african: {
    id: "west_african",
    density: "rich",
    kontextCue:
      "West African HARD: deep brown skin, natural African hair, pagne/boubou/jersey; market/baobab world — no European-default cast.",
    imageCraft: `${BASE_COLORING} WEST AFRICAN visual lock HARD: human characters with deep or medium-deep brown skin; natural African hair (coils, braids, twists, afro, cornrows, locs); dignified clothes (pagne, boubou, dashiki, jersey, everyday West African wear). Settings: market, baobab, courtyard, village, West African city. NEVER European-default pale cast or suburban European street. No caricature.`,
    visualLockRules:
      "visualLock MUST include: explicit skinTone (deep/medium-deep brown), African hair texture, face, body, West African outfit (pagne/boubou/jersey/everyday), signature accessory. Forbidden: pale European default, blond straight hair by default, tribal caricature.",
    worldBias:
      "Décors ouest-africains : marché, baobab, cour familiale, village, ville (Dakar, Abidjan, Lagos, Accra…), savane, fleuve — dignes et joyeux.",
    forbidden:
      "no European-default cast, no tribal caricature, no pejorative stereotypes, no exoticizing costume parody",
  },
  folklore_wa: {
    id: "folklore_wa",
    density: "rich",
    kontextCue:
      "West African folktale HARD: deep brown skin, African hair, pagne/boubou + gentle drawable magic; original hero.",
    imageCraft: `${BASE_COLORING} WEST AFRICAN FOLKTALE style HARD: same West African identity lock (deep/medium-deep brown skin, natural African hair, dignified pagne/boubou/everyday wear) PLUS gentle folktale magic as drawable shapes. Clever small hero energy, village/savanna/river world. Original characters only — never copy copyrighted heroes. No caricature.`,
    visualLockRules:
      "visualLock MUST include: explicit skinTone (deep/medium-deep brown), African hair texture, face, body, West African outfit, ONE folklore signature prop (amulet, calabash, talking drum — respectful). Original hero — no plagiarism.",
    worldBias:
      "Conte ouest-africain : village, baobab, fleuve, savane, nuit étoilée douce — magie respectueuse, personnages originaux (esprit Kirikou/Anansi sans plagiat).",
    forbidden:
      "no European-default cast, no tribal caricature, no copying Kirikou/Anansi likeness or names as plagiarism, no scary occult imagery",
  },
};

export function normalizeStyleId(style: string): StyleId | string {
  const s = (style || "cute").trim().toLowerCase().replace(/\s+/g, "_");
  if (s in CONTRACTS) return s as StyleId;
  if (/afrique|african/.test(s)) return "west_african";
  if (/folklore/.test(s)) return "folklore_wa";
  return s;
}

export function getStyleContract(style: string): StyleContract {
  const id = normalizeStyleId(style);
  if (id in CONTRACTS) return CONTRACTS[id as StyleId];
  // Unknown style: balanced cute-like contract with the raw style name echoed.
  return {
    id,
    density: "balanced",
    kontextCue: `Style ${style}: clear kids coloring silhouettes, dynamic poses.`,
    imageCraft: `${BASE_COLORING} Style cue: ${style}. Friendly children's coloring outlines, clear silhouettes, dynamic poses, rich colorable environment.`,
    visualLockRules:
      "visualLock: age, skin tone, hair, face, body, outfit patterns, signature accessory — identical wording every page.",
    worldBias: `Respecte le style « ${style} » sans forcer une culture non demandée.`,
    forbidden: "no photorealism, no empty void, no static lineup poses, no stereotypes",
  };
}

export function isWestAfricanStyle(style: string): boolean {
  const id = normalizeStyleId(style);
  return id === "west_african" || id === "folklore_wa";
}

/** Full FR system block for story / enrich / outline. */
export function styleContractSystemBlock(style: string): string {
  const c = getStyleContract(style);
  return `CONTRAT STYLE « ${c.id} » (OBLIGATOIRE — pas un hint soft)
- Craft image : ${c.imageCraft}
- visualLock : ${c.visualLockRules}
- Monde / décors : ${c.worldBias}
- Interdits : ${c.forbidden}
- Densité line-art : ${c.density}.`;
}

/** Dense EN craft for Ideogram / text-only pages & covers. */
export function styleImageCraftLine(style: string): string {
  return getStyleContract(style).imageCraft;
}

/** Ultra-short EN cue for Kontext identity path. */
export function styleKontextCue(style: string): string {
  return getStyleContract(style).kontextCue;
}

/** Legacy alias kept for callers. */
export function westAfricanVisualContract(): string {
  return styleContractSystemBlock("west_african");
}
