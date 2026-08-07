/**
 * Vignettes du catalogue (§2 du parcours v2) — UNE image par preset, générée
 * par le preset lui-même avec ses réglages exacts : une seule passe, graine
 * fixe, aucune retouche, aucune sélection parmi plusieurs essais. Ce que la
 * carte montre est ce que l'utilisateur obtiendra.
 *
 * Usage : node --import tsx scripts/generer-vignettes.mjs [id ...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const l of readFileSync(path.join(RACINE, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { compilerPrompt } = await import(path.join(RACINE, "services/studio/compiler.ts"));
const { PRESETS } = await import(path.join(RACINE, "services/studio/presets.ts"));
const { PRESET_IDS } = await import(path.join(RACINE, "services/studio/types.ts"));
const { buildStudioBody, studioEndpoint } = await import(
  path.join(RACINE, "services/studio/generation.ts")
);
const { callFal } = await import(path.join(RACINE, "services/ai/fal-provider.ts"));

/** Sujets de démonstration pour les presets qui ne déclarent pas de phrase. */
const PERSONNAGES_DEMO = {
  "portrait-pro": [{ role: "une femme" }],
  "portrait-studio": [{ role: "un homme" }],
  "portrait-traditionnel": [{ role: "une femme" }],
  "portrait-archive": [{ role: "un homme" }],
  "avatar-illustre": [{ role: "une femme" }],
  "portrait-couple": [{ role: "un homme" }, { role: "une femme" }],
  "hommage": [{ role: "un homme d'âge mûr" }],
  "affiche-resistance": [{ role: "une résistante" }, { role: "un soldat" }, { role: "un étudiant" }],
};

function saisieDemo(preset) {
  const s = {};
  for (const c of preset.champs) {
    if (c.type === "phrase") s.phrase = c.exemples[0];
    if (c.type === "texte") s.textes = { ...s.textes, [c.cle]: c.exemples[0] };
  }
  if (PERSONNAGES_DEMO[preset.id]) s.personnages = PERSONNAGES_DEMO[preset.id];
  return s;
}

const GRAINE = 314159; // fixe : la vignette est reproductible, pas sélectionnée
const key = process.env.FAL_KEY.trim();
const endpoint = studioEndpoint();
const cibles = process.argv.slice(2).length ? process.argv.slice(2) : [...PRESET_IDS];
let ok = 0;
for (const id of cibles) {
  const preset = PRESETS[id];
  const prompt = compilerPrompt({ preset: id, saisie: saisieDemo(preset), format: preset.format });
  const sortie = path.join(RACINE, "public/presets", `${id}.webp`);
  try {
    const { url } = await callFal(
      endpoint,
      key,
      buildStudioBody({ prompt, format: preset.format, seed: GRAINE, endpoint })
    );
    const jpg = `/tmp/vignette-${id}.jpg`;
    writeFileSync(jpg, Buffer.from(await (await fetch(url)).arrayBuffer()));
    // Conversion + réduction (pas une retouche : ni recadrage ni correction).
    execSync(
      `node -e "require('sharp')('${jpg}').resize({width:480}).webp({quality:78}).toFile('${sortie}').then(()=>{})"`,
      { cwd: RACINE }
    );
    ok += 1;
    console.log(`OK  ${id}`);
  } catch (e) {
    console.log(`ERR ${id} — ${String(e).slice(0, 140)}`);
  }
}
console.log(`${ok}/${cibles.length} vignettes générées dans public/presets/`);
