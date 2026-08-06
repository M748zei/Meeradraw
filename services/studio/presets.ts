import type { Preset, PresetId } from "@/services/studio/types";

/**
 * Les six presets du lancement. `nuit-archive` est la recette relevée sur les
 * vrais visuels de la page (§3 du brief) ; les cinq autres sont des variations
 * de la même structure. Les blocs sont en anglais (vocabulaire auquel les
 * modèles de diffusion adhèrent le mieux) et STRICTEMENT AFFIRMATIFS.
 *
 * La caméra est commune et NON réglable : plan large ou moyen-large,
 * trois-quarts ou de dos — c'est ce qui empêche les visages de rater.
 */
export const CAMERA_COMMUNE =
  "Shot on a 35mm lens at chest height, wide or medium-wide framing, the subject stands about one third of the frame height, seen from three-quarters behind or from the back.";

const NUIT_ARCHIVE: Preset = {
  id: "nuit-archive",
  nom: "Nuit d'archive",
  description: "Clair-obscur nocturne, une seule lampe, sol mouillé — la signature de la page.",
  rendu:
    "Cinematic oil painting, matte painting craft, visible brushstrokes, canvas texture, painterly softness in every edge.",
  lumiere: {
    nuit: "Deep night scene lit by one single practical light inside the frame, a street lamp, a lantern, a headlight or an open doorway, chiaroscuro contrast, warm amber highlights carved out of cold blue darkness.",
    aube: "First pale light of dawn mixing with one still-lit practical lamp inside the frame, chiaroscuro fading into cold blue morning, amber lamp glow holding against the early sky.",
    jour: "Overcast daylight kept low and moody, one bright practical light inside the frame still reading warm, soft chiaroscuro, amber accents against grey-blue ambience.",
    crepuscule:
      "Blue-hour dusk, the sky a deep cobalt, one practical lamp inside the frame taking over the scene, chiaroscuro contrast, warm amber pooling in the falling dark.",
  },
  heureNative: "nuit",
  sol: "Wet reflective ground, dark puddles catching and stretching the lamplight.",
  atmosphere: "Fine drizzle and thin mist, glowing halos blooming around every light source.",
  etalonnage:
    "Color grade with teal shadows and amber highlights, lifted soft blacks, light film grain, gentle vignette.",
  vignette: { de: "#0b2530", vers: "#c97b1e" },
};

const HEURE_DOREE: Preset = {
  id: "heure-doree",
  nom: "Heure dorée",
  description: "Soleil bas, contre-jour, poussière dorée — pour les départs et les arrivées.",
  rendu: NUIT_ARCHIVE.rendu,
  lumiere: {
    nuit: "Last ember of sunset on the horizon, the scene mostly in warm dusk, long soft shadows merging into the coming night, rim light tracing the subject.",
    aube: "Low golden sun just above the horizon at daybreak, long shadows racing across the ground, warm rim light wrapping the subject seen against the light.",
    jour: "Low golden afternoon sun, elongated shadows, warm backlight wrapping the subject, sunbeams raking across the scene.",
    crepuscule:
      "Golden hour a minute before sunset, the sun a molten disc at the horizon, immense warm shadows, the subject rimmed in gold against the light.",
  },
  heureNative: "crepuscule",
  sol: "Dry packed earth, warm dust kicked up and hanging in the backlight.",
  atmosphere: "Golden dust haze in the air, sun flare softened by the atmosphere.",
  etalonnage:
    "Color grade rich in amber and honey tones with soft teal in the shadows, lifted blacks, light film grain, gentle vignette.",
  vignette: { de: "#7a3803", vers: "#f0b13c" },
};

const AFFICHE_RESISTANCE: Preset = {
  id: "affiche-resistance",
  nom: "Affiche de résistance",
  description: "Silhouette héroïque, aplats francs, papier d'époque — pour les figures et les dates.",
  rendu:
    "Vintage lithograph poster painted in oils, bold flat color masses over visible brush texture, screen-print edges, aged poster paper texture.",
  lumiere: {
    nuit: "One dramatic key light from below the horizon line, the silhouette carved in hard amber against a deep indigo poster sky.",
    aube: "Rising sun as a graphic halo behind the silhouette, hard rays of light fanning across the poster sky.",
    jour: "Hard single-direction daylight, the silhouette carved in bold shadow against a flat luminous sky.",
    crepuscule:
      "Sun sinking behind the silhouette, a graphic burst of amber rays across a darkening poster sky.",
  },
  heureNative: "jour",
  sol: "Simplified graphic ground plane, a strong horizon line anchoring the figure.",
  atmosphere: "Clean poster air, a subtle paper grain floating over the whole image.",
  etalonnage:
    "Limited poster palette of deep teal, warm amber and aged cream, inked blacks, heavy paper texture, printed grain.",
  vignette: { de: "#31261c", vers: "#b03a24" },
};

const DOCUMENT_EPOQUE: Preset = {
  id: "document-epoque",
  nom: "Document d'époque",
  description: "Tirage ancien retrouvé dans une malle — sépia, rayures, mémoire.",
  rendu:
    "Hand-tinted archival print painted in oils, silver gelatin tonality, softly faded edges, fine scratches and dust of an old photographic plate, painterly rendering throughout.",
  lumiere: {
    nuit: "Dim oil-lamp interior glow of an old plate exposure, soft pooled light, deep enveloping sepia shadows.",
    aube: "Pale veiled morning light of an early photographic plate, long exposure softness, gentle enveloping glow.",
    jour: "Flat veiled daylight of an old plate camera exposure, soft even glow, shadows dissolving into warm paper tone.",
    crepuscule:
      "Fading afternoon light of a long plate exposure, soft warm gloom gathering at the edges of the frame.",
  },
  heureNative: "jour",
  sol: "Dusty ground rendered in soft sepia masses, details melting into the print's grain.",
  atmosphere: "Veiled air, the soft bloom of an old lens, edges of the print gently faded.",
  etalonnage:
    "Sepia and warm silver monochrome grade, cream paper base, heavy photographic grain, darkened print borders.",
  vignette: { de: "#3a2f22", vers: "#a98a5c" },
};

const PORTRAIT_ARCHIVE: Preset = {
  id: "portrait-archive",
  nom: "Portrait d'archive",
  description: "Une figure, un décor qui raconte — le sujet reste à distance de mémoire.",
  rendu: NUIT_ARCHIVE.rendu,
  lumiere: {
    nuit: "One warm practical lamp to the side of the figure, chiaroscuro modelling, the surroundings falling into deep painted darkness.",
    aube: "Soft window light of early morning raking across the scene, cool ambience with one warm accent on the figure.",
    jour: "Soft directional daylight from a high window, gentle chiaroscuro, the room breathing around the figure.",
    crepuscule:
      "Low warm light of day's end raking through an opening, long soft shadows climbing the walls around the figure.",
  },
  heureNative: "jour",
  sol: "Worn floor grounding the figure, its texture painted in broad quiet strokes.",
  atmosphere: "Still air with fine floating dust caught in the light shaft.",
  etalonnage: NUIT_ARCHIVE.etalonnage,
  vignette: { de: "#1e2a2e", vers: "#8c6b4a" },
};

const PLEIN_JOUR_POUSSIERE: Preset = {
  id: "plein-jour-poussiere",
  nom: "Plein jour, poussière",
  description: "Soleil dur de midi, brume de chaleur, couleurs cuites — les scènes de foule et de route.",
  rendu: NUIT_ARCHIVE.rendu,
  lumiere: {
    nuit: "Full moon flooding an open landscape with pale hard light, crisp moon shadows on bright dust.",
    aube: "Already-strong morning sun climbing fast, hard clean shadows, heat building over the dust.",
    jour: "Harsh vertical midday sun, short hard shadows pooled under every figure, blinding bright dust.",
    crepuscule:
      "Late hard sun still high enough to bite, long dusty shadows beginning to stretch across the ground.",
  },
  heureNative: "jour",
  sol: "Bleached dusty ground, heat shimmer rising off the packed earth.",
  atmosphere: "Dry dust haze whitening the distance, heat shimmer bending the horizon.",
  etalonnage:
    "Sun-baked grade of bleached amber and chalky teal, bright lifted exposure, light film grain, soft vignette.",
  vignette: { de: "#8a6b35", vers: "#d9c9a3" },
};

export const PRESETS: Record<PresetId, Preset> = {
  "nuit-archive": NUIT_ARCHIVE,
  "heure-doree": HEURE_DOREE,
  "affiche-resistance": AFFICHE_RESISTANCE,
  "document-epoque": DOCUMENT_EPOQUE,
  "portrait-archive": PORTRAIT_ARCHIVE,
  "plein-jour-poussiere": PLEIN_JOUR_POUSSIERE,
};
