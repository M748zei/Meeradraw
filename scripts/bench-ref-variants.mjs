/**
 * Benchmark T2.3 — casser le « rang d'oignons » : compare 3 stratégies de
 * référence Kontext + 2 stratégies de couverture sur un mini-livre savane fixe.
 *
 *  (a) kontext/dev + sheet lineup complet + prompt découplé (prod actuelle)
 *  (b) kontext/dev + référence CROPPÉE au personnage de la page (pages solo)
 *  (c) kontext MULTI (flux-pro/kontext/max/multi) + crops séparés (pages duo)
 *  Cover : Ideogram lettré (titre dans l'image) vs Kontext sans texte
 *
 * Scoring : QC vision Groq (lineup ? action visible ?) + inspection visuelle
 * des PNG sauvés dans bench-out/<ts>/.
 *
 * Usage : node --env-file=.env.local scripts/bench-ref-variants.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const FAL_KEY = process.env.FAL_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
if (!FAL_KEY || !GROQ_KEY) throw new Error("FAL_KEY / GROQ_API_KEY requis (.env.local)");

const IDEOGRAM = "https://fal.run/fal-ai/ideogram/v3";
const KONTEXT = process.env.FAL_REF_ENDPOINT || "https://fal.run/fal-ai/flux-kontext/dev";
const KONTEXT_MULTI = "https://fal.run/fal-ai/flux-pro/kontext/max/multi";
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";

const OUT = `bench-out/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(OUT, { recursive: true });

// ---------- Cast + storyboard fixes (savane, rivière en crue) ----------
const CAST = [
  {
    id: "char_1",
    name: "Nala",
    kind: "human",
    lock: "[char_1] Nala — ALWAYS DRAW EXACTLY: small girl ~6 years, warm brown skin, short afro puffs tied with two beads, round face, big bright eyes, yellow sleeveless dress with zigzag hem, bare feet, beaded bracelet on right wrist; identical every page",
  },
  {
    id: "char_2",
    name: "Tembo",
    kind: "elephant",
    lock: "[char_2] Tembo — ALWAYS DRAW EXACTLY: real four-legged African elephant calf, standing on all four legs, large flapping ears, short trunk, small white tusks, wrinkled skin, friendly eyes; NOT anthropomorphic, no clothes; identical every page",
  },
];
const FULL_LOCK = CAST.map((c) => c.lock).join(" | ");
const WORLD = "African savanna riverbank during a flood — tall grass, acacia and baobab trees, rushing brown river";
const SETTING_ELEMENTS = ["giant baobab tree", "acacia trees", "rushing flooded river", "tall savanna grass"];

const PAGES = [
  {
    n: 1,
    cast: ["char_1", "char_2"],
    action:
      "Nala balances barefoot on a half-submerged log crossing the flooded river, arms out wide, while Tembo wades chest-deep beside her pushing against the current with his trunk raised",
    camera: "dynamic side view at water level",
  },
  {
    n: 2,
    cast: ["char_1", "char_2"],
    action:
      "Tembo curls his trunk around Nala and lifts her high onto his back while rain pours and the river churns below",
    camera: "three-quarter low angle",
  },
  {
    n: 3,
    cast: ["char_1"],
    action:
      "Nala kneels at the muddy riverbank, leaning forward, studying a line of stepping stones half covered by rushing water",
    camera: "high angle looking down",
  },
  {
    n: 4,
    cast: ["char_2"],
    action:
      "Tembo braces all four legs wide against the rushing current, trunk curled tightly around a floating branch, water splashing against his sides",
    camera: "front three-quarter view with visible water motion",
  },
];

// ---------- Prompts (miroir de services/ai/prompts.ts) ----------
function refPrompt({ scene, action, locks }) {
  return [
    "Redraw the reference characters in a NEW scene as an expert children's coloring book page: PURE BLACK AND WHITE LINE ART ONLY, bold thick uniform black outlines on white paper, large white areas to color, closed shapes, absolutely NO color, no shading, no grey, no text, no watermark.",
    "From the reference image keep ONLY the characters' IDENTITY: same faces, hair, outfits, proportions and animal species (an elephant stays a REAL four-legged elephant).",
    "DISCARD the reference's COMPOSITION COMPLETELY: this is a NEW scene with NEW poses and a NEW camera angle. Do NOT reproduce the reference's standing row, front-facing lineup, poses, spacing or plain background in any way.",
    `THE CHARACTERS ARE ACTIVELY DOING THIS, mid-motion: ${action}.`,
    `NEW SCENE (rich colorable environment filling the page, no empty white void): ${scene}`,
    `World anchors: ${SETTING_ELEMENTS.join(", ")}.`,
    "FORBIDDEN: characters standing in a row; front-facing lineup; static group photo; characters posing side by side; everyone facing the camera; characters standing still doing nothing; model-sheet layout.",
    "Full bodies inside the frame with margins; simplified mitten-style kid hands.",
    `CHARACTER LOCK: ${locks}.`,
    `setting: ${WORLD}.`,
  ].join(" ");
}

function sheetPrompt() {
  return [
    "Children's picture-book character reference portrait: the story's main cast standing side by side on a plain white background, FULL BODY head-to-toe, front view, clearly separated.",
    `DRAW EXACTLY THIS CAST — one figure per listed character, nobody else: ${FULL_LOCK}.`,
    "EXACTLY 2 figures in the image — count them: 2, not one more, not one less.",
    "Any ANIMAL character is a REAL animal of its species on ALL FOUR LEGS — NOT anthropomorphic.",
    "Soft flat COLORS with clean bold cartoon outlines, no scene background, no props, no text.",
  ].join(" ");
}

function coverIdeogramPrompt(title) {
  return [
    "Children's coloring book COVER — a lively POSTER, not a character sheet:",
    "vertical composition with the TOP THIRD kept visually calm as a reserved title band,",
    `TITLE LETTERING: render the exact title text "${title}" in playful, bold, child-friendly hand-lettering INSIDE the reserved top band — large, perfectly legible, correctly spelled, black outline letters (colorable), no other text anywhere.`,
    `MAIN SCENE (lower two thirds): the heroes IN THE MIDDLE OF AN ACTION — ${PAGES[0].action} —`,
    "dynamic distinct poses; NOT standing in a row, NOT a front-facing lineup.",
    `Signature scenery: ${SETTING_ELEMENTS.join(", ")} — rich colorable environment filling the frame.`,
    "Pure black and white line art only — bold thick outlines, no color, no shading, no photorealism.",
    `CHARACTER LOCK (identical): ${FULL_LOCK}.`,
  ].join(" ");
}

const NEG =
  "color, grayscale, shading, gradients, cross-hatching, filled black areas, photorealism, blurry, watermark, extra fingers, fused fingers, floating head, cropped limbs, extra people, duplicate characters, empty white void, characters standing in a row, front-facing lineup, model sheet, static group photo, characters posing side by side";

// ---------- fal / vision helpers ----------
async function fal(endpoint, body) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${endpoint.split("fal-ai/")[1]} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("no image");
  return url;
}

async function save(url, name) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const png = await sharp(buf).png().toBuffer();
  writeFileSync(`${OUT}/${name}.png`, png);
  return url;
}

async function vision(url, action) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 900,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Children's coloring page. Requested action: "${action}". Q1 lineup: are characters simply standing in a row, front-facing, static, no action? Q2: is the action actually visible? Answer ONLY JSON: {"lineup": bool, "action_visible": bool, "note": "short"}`,
            },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const raw = (await res.json()).choices?.[0]?.message?.content || "";
  const after = raw.includes("</think>") ? raw.slice(raw.lastIndexOf("</think>") + 8) : raw;
  const m = after.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

// ---------- Run ----------
const results = [];
const run = async (label, action, fn) => {
  try {
    const url = await fn();
    await save(url, label);
    const v = await vision(url, action);
    results.push({ label, ...v });
    console.log(
      `${label}: lineup=${v?.lineup} action=${v?.action_visible} ${v?.note || ""}`
    );
  } catch (err) {
    results.push({ label, error: String(err.message).slice(0, 140) });
    console.warn(`${label}: ÉCHEC — ${err.message}`);
  }
};

console.log("1) Model sheet (Ideogram, coloré)…");
const sheetUrl = await fal(IDEOGRAM, {
  prompt: sheetPrompt(),
  image_size: "square_hd",
  num_images: 1,
  rendering_speed: "QUALITY",
  style: "DESIGN",
  expand_prompt: false,
  negative_prompt:
    "black and white, monochrome, line art only, extra people, duplicate characters, animal drawn as a human, bipedal animal, scene background, text, watermark",
});
await save(sheetUrl, "00-sheet");
console.log("   sheet OK");

// Crops (sheet = 2 personnages côte à côte → moitié gauche / moitié droite)
const sheetBuf = Buffer.from(await (await fetch(sheetUrl)).arrayBuffer());
const meta = await sharp(sheetBuf).metadata();
const half = Math.floor(meta.width / 2);
async function cropToUrl(left, name) {
  const buf = await sharp(sheetBuf).extract({ left, top: 0, width: half, height: meta.height }).png().toBuffer();
  writeFileSync(`${OUT}/${name}.png`, buf);
  // fal accepte les data URLs en image_url
  return `data:image/png;base64,${buf.toString("base64")}`;
}
const cropNala = await cropToUrl(0, "00-crop-nala");
const cropTembo = await cropToUrl(half, "00-crop-tembo");
const cropOf = { char_1: cropNala, char_2: cropTembo };

for (const p of PAGES) {
  const locks = CAST.filter((c) => p.cast.includes(c.id)).map((c) => c.lock).join(" | ");
  const scene = `${p.action}. CAMERA: ${p.camera}. SETTING: ${WORLD}.`;
  const prompt = refPrompt({ scene, action: p.action, locks });

  // (a) full lineup ref + prompt découplé
  await run(`a-full-p${p.n}`, p.action, () =>
    fal(KONTEXT, { prompt, image_url: sheetUrl, guidance_scale: Number(process.env.FAL_REF_GUIDANCE || 3.5), num_images: 1, output_format: "png" })
  );

  if (p.cast.length === 1) {
    // (b) crop du personnage seul
    await run(`b-crop-p${p.n}`, p.action, () =>
      fal(KONTEXT, { prompt, image_url: cropOf[p.cast[0]], guidance_scale: Number(process.env.FAL_REF_GUIDANCE || 3.5), num_images: 1, output_format: "png" })
    );
  } else {
    // (c) multi-références (crops séparés)
    await run(`c-multi-p${p.n}`, p.action, () =>
      fal(KONTEXT_MULTI, { prompt, image_urls: p.cast.map((id) => cropOf[id]), num_images: 1, output_format: "png" })
    );
  }
}

// Covers
const TITLE = "Nala et Tembo";
await run("cover-ideogram-1", PAGES[0].action, () =>
  fal(IDEOGRAM, { prompt: coverIdeogramPrompt(TITLE), image_size: "portrait_4_3", num_images: 1, rendering_speed: "QUALITY", style: "DESIGN", expand_prompt: false, negative_prompt: NEG })
);
await run("cover-ideogram-2", PAGES[0].action, () =>
  fal(IDEOGRAM, { prompt: coverIdeogramPrompt(TITLE), image_size: "portrait_4_3", num_images: 1, rendering_speed: "QUALITY", style: "DESIGN", expand_prompt: false, negative_prompt: NEG })
);
await run("cover-kontext-notext", PAGES[0].action, () =>
  fal(KONTEXT, {
    prompt: refPrompt({ scene: `Coloring book COVER poster: ${PAGES[0].action}. ABSOLUTELY NO TEXT anywhere.`, action: PAGES[0].action, locks: FULL_LOCK }),
    image_url: sheetUrl,
    guidance_scale: Number(process.env.FAL_REF_GUIDANCE || 3.5),
    num_images: 1,
    output_format: "png",
  })
);

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const ok = results.filter((r) => !r.error);
const lineups = ok.filter((r) => r.lineup).length;
const actions = ok.filter((r) => r.action_visible).length;
console.log(`\nBilan: ${ok.length} images | lineup détecté: ${lineups} | action visible: ${actions}/${ok.length}`);
console.log(`Images + verdicts → ${OUT}/`);
