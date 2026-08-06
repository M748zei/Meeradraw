import { callFal, NonRetryableFalError } from "@/services/ai/fal-provider";
import type { Format } from "@/services/studio/types";

/**
 * Génération d'une image du studio via fal — réutilise `callFal`, le cœur
 * éprouvé du moteur : timeout, erreurs non réessayables, et surtout
 * l'allègement automatique du prompt sur 422 `content_policy_violation`
 * (c'est ce qui évite qu'une génération meure au lieu de réessayer).
 *
 * Une variante = un appel (chaque variante est régénérable seule).
 */

/** Modèles proposés au mode avancé — identifiants courts, jamais d'URL cliente. */
export const MODELES: Record<string, string> = {
  "flux-2-pro": "https://fal.run/fal-ai/flux-2-pro",
  "flux-general": "https://fal.run/fal-ai/flux-general",
  "ideogram-v3": "https://fal.run/fal-ai/ideogram/v3",
};
export const MODELE_IDS = Object.keys(MODELES) as [string, ...string[]];

/** Endpoint par défaut — remplacé par la comparaison mesurée quand fal sera rechargé. */
export function studioEndpoint(modele?: string): string {
  if (modele && MODELES[modele]) return MODELES[modele];
  return process.env.FAL_STUDIO_ENDPOINT?.trim() || "https://fal.run/fal-ai/flux-2-pro";
}

const TAILLES: Record<Format, string> = {
  "9:16": "portrait_16_9",
  "4:5": "portrait_4_3",
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
};

export function studioDisponible(): boolean {
  return Boolean(process.env.FAL_KEY?.trim());
}

/** Corps de requête minimal et affirmatif — jamais de negative_prompt (§4 règle 1). */
export function buildStudioBody(params: {
  prompt: string;
  format: Format;
  seed?: number;
  endpoint?: string;
}): Record<string, unknown> {
  const endpoint = params.endpoint || studioEndpoint();
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    image_size: TAILLES[params.format],
    num_images: 1,
  };
  if (/ideogram/i.test(endpoint)) {
    // Ideogram V3 : expand_prompt:false pour que NOTRE prompt exact soit rendu.
    body.rendering_speed = "QUALITY";
    body.expand_prompt = false;
  } else {
    body.output_format = "jpeg";
    body.enable_safety_checker = true;
  }
  if (typeof params.seed === "number" && Number.isFinite(params.seed)) {
    body.seed = Math.abs(Math.trunc(params.seed)) % 2147483647;
  }
  return body;
}

export async function genererImageStudio(params: {
  prompt: string;
  format: Format;
  seed?: number;
  endpoint?: string;
}): Promise<{ url: string }> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new NonRetryableFalError("FAL_KEY absente — studio indisponible.");
  }
  const endpoint = params.endpoint || studioEndpoint();
  const { url } = await callFal(endpoint, key, buildStudioBody({ ...params, endpoint }));
  return { url };
}

/** Action tarifaire du hub selon le nombre de variantes (1→2 cr, 2→3, 4→6). */
export function actionPourVariantes(variantes: 1 | 2 | 4): string {
  return `studio.image${variantes}`;
}
