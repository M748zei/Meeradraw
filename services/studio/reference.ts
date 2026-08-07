import sharp from "sharp";
import { callFal } from "@/services/ai/fal-provider";

/**
 * Image de référence (chantiers 4-5).
 *
 * PRODUIT — méthode par défaut : le détourage-composite, PAS la régénération.
 *   1. détourer la photo envoyée (BiRefNet chez fal) ;
 *   2. générer UNIQUEMENT le décor avec le preset (zone libre) ;
 *   3. reposer le produit détouré avec une ombre portée douce au sol.
 *   Le produit n'est JAMAIS redessiné : l'étiquette reste pixel pour pixel.
 *
 * STOCKAGE : la photo envoyée n'est jamais écrite chez nous. Elle transite en
 * mémoire (data-URL) vers fal pour le détourage ; le détouré et les décors
 * vivent sur fal.media (le CDN de fal, quelques jours, comme toute image
 * générée) ; le composite revient au navigateur en data-URL dans la réponse —
 * côté serveur, rien ne persiste après la génération.
 *
 * SELFIE — le chemin de ressemblance passe par flux-2-pro/edit avec le selfie
 * en référence (gagnant de la comparaison du 07/08, voir DECISIONS.md) ; le
 * bloc « personnes » de l'ancrage est retiré par le compilateur en amont.
 */

const ENDPOINT_DETOURAGE =
  process.env.FAL_DETOURAGE_ENDPOINT?.trim() || "https://fal.run/fal-ai/birefnet/v2";
const ENDPOINT_IDENTITE =
  process.env.FAL_IDENTITE_ENDPOINT?.trim() || "https://fal.run/fal-ai/flux-2-pro/edit";

function clefFal(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY absente — références indisponibles.");
  return key;
}

/**
 * Détoure la photo produit : PNG transparent, pixels du produit intacts.
 * BiRefNet renvoie `{image:{url}}` (vérifié sur la réponse brute du 07/08),
 * pas le `{images:[...]}` des modèles de génération — d'où l'appel direct.
 */
export async function detourerProduit(dataUrl: string): Promise<Buffer> {
  const res = await fetch(ENDPOINT_DETOURAGE, {
    method: "POST",
    headers: { Authorization: `Key ${clefFal()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: dataUrl }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(`détourage fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { image?: { url?: string } };
  if (!data.image?.url) throw new Error("détourage fal : réponse sans image");
  return Buffer.from(await (await fetch(data.image.url)).arrayBuffer());
}

/**
 * Repose le produit détouré sur le décor, avec une ombre portée douce au sol
 * (les presets produit éclairent en boîte à lumière / jour ombragé : l'ombre
 * juste sous l'objet est la plus cohérente). Le produit est UNIQUEMENT réduit
 * (jamais agrandi, jamais déformé) : l'étiquette reste nette.
 */
/**
 * Échelle et ligne de pose par preset : un packshot remplit le cadre, un
 * produit posé sur un étal de marché reste à l'échelle de l'étal (vu à
 * l'image le 07/08 : à 50 % de largeur, le flacon était géant au marché).
 */
const REGLAGES_COMPOSITE: Record<string, { largeur: number; base: number }> = {
  "produit-fond-uni": { largeur: 0.5, base: 0.78 },
  "produit-en-main": { largeur: 0.3, base: 0.72 },
  "vitrine-boutique": { largeur: 0.28, base: 0.8 },
  "flyer-promo": { largeur: 0.42, base: 0.86 },
  "plat-restaurant": { largeur: 0.55, base: 0.8 },
};

export async function composerProduit(
  decorJpeg: Buffer,
  produitPng: Buffer,
  presetId?: string
): Promise<Buffer> {
  const reglage = REGLAGES_COMPOSITE[presetId ?? ""] ?? { largeur: 0.42, base: 0.78 };
  const decor = sharp(decorJpeg);
  const { width: W = 1024, height: H = 1024 } = await decor.metadata();

  // Le détouré garde le cadre de la photo d'origine : on le ROGNE à sa boîte
  // alpha, sinon les marges transparentes font flotter le produit au-dessus de
  // la surface (vu à l'image le 07/08).
  const rogne = await sharp(produitPng)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const largeurCible = Math.round(W * reglage.largeur);
  const produit = await sharp(rogne)
    .resize({ width: largeurCible, withoutEnlargement: true })
    .png()
    .toBuffer();
  const { width: pw = largeurCible, height: ph = largeurCible } = await sharp(produit).metadata();

  // Position : centré, la BASE du produit posée aux trois quarts du cadre
  // (la zone libre du décor).
  const gauche = Math.round((W - pw) / 2);
  const bas = Math.round(H * reglage.base);
  const haut = bas - ph;

  // Ombre au sol : silhouette alpha écrasée, floutée, adoucie (α×0,4),
  // collée à la base du produit.
  const hOmbre = Math.max(24, Math.round(ph * 0.12));
  const ombre = await sharp(produit)
    .ensureAlpha()
    .linear([0, 0, 0, 0.4], [0, 0, 0, 0]) // RGB → noir, alpha adouci
    .resize({ width: Math.round(pw * 1.06), height: hOmbre, fit: "fill" })
    .blur(14)
    .png()
    .toBuffer();

  return decor
    .composite([
      {
        input: ombre,
        left: Math.round(gauche - pw * 0.03),
        top: Math.round(bas - hOmbre / 2),
        blend: "multiply",
      },
      { input: produit, left: gauche, top: haut },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * « Intégration poussée » (option NON cochée par défaut) : le modèle repeint le
 * produit dans la scène — l'étiquette PEUT être altérée, l'UI prévient.
 * Sert aussi de chemin d'identité pour le selfie (le visage de la référence).
 */
export async function genererAvecReference(params: {
  prompt: string;
  referenceDataUrl: string;
  format: string;
  seed?: number;
}): Promise<{ url: string }> {
  const tailles: Record<string, string> = {
    "9:16": "portrait_16_9",
    "4:5": "portrait_4_3",
    "1:1": "square_hd",
    "16:9": "landscape_16_9",
  };
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    image_urls: [params.referenceDataUrl],
    image_size: tailles[params.format] ?? "square_hd",
    output_format: "jpeg",
    enable_safety_checker: true,
  };
  if (typeof params.seed === "number" && Number.isFinite(params.seed)) {
    body.seed = Math.abs(Math.trunc(params.seed)) % 2147483647;
  }
  const { url } = await callFal(ENDPOINT_IDENTITE, clefFal(), body);
  return { url };
}
