import { detectImageFormat, toPngBuffer } from "@/lib/image-format";

/**
 * Le cœur fal du studio — TOUT ce qui reste du provider MeeraDraw, gardé
 * verbatim (brief Scarabée Studio §6) : timeout, erreurs non réessayables,
 * et l'allègement automatique du prompt quand fal renvoie un 422
 * `content_policy_violation` (incident prod e3fc2591 : c'est ce qui évite
 * qu'une génération meure au lieu de réessayer).
 *
 * Le pipeline livre de coloriage (QC visuel, verrouillage d'identité,
 * re-rolls) a été supprimé avec le produit livre — voir DECISIONS.md.
 */
const FAL_TIMEOUT_MS = Number(process.env.FAL_TIMEOUT_MS || 90_000);

/** Permanent fal failures — never retry (wastes wall-clock; some may still bill). */
export class NonRetryableFalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableFalError";
  }
}

export function isNonRetryableFalError(err: unknown): boolean {
  if (err instanceof NonRetryableFalError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /feature_not_supported|cannot be 'DESIGN'|style_preset|Exhausted balance|User is locked|invalid_request|422/i.test(
      msg
    ) ||
    /strict visual quality gate|Premium character reference failed|Premium cover|Premium book is missing/i.test(
      msg
    ) ||
    /fal\.ai error:.*"type"\s*:\s*"feature_not_supported"/i.test(msg)
  );
}
// Boost texts + verdict-driven routing live in services/ai/qc-boosts.ts so the
// reliability suite can test the routing decisions against the real strings.

/**
 * Réécrit un prompt refusé par le filtre de contenu de fal.
 *
 * On retire les clauses qui décrivent un CORPS (anatomie, membres, proportions,
 * cadrage sur le personnage) — ce sont elles qui, accolées au mot « child »,
 * font réagir le filtre — et on garde la scène, le décor et le contrat
 * d'impression, qui sont l'essentiel du rendu. Le résultat est plafonné à
 * 900 caractères : un prompt court passe beaucoup plus facilement.
 *
 * Exporté pour que la suite de fiabilité puisse le tester sans réseau.
 */
export function allegerPromptRefuse(prompt: string): string {
  if (!prompt) return "";
  const aRetirer: RegExp[] = [
    /\bREAL CHILD proportions[^.]*\./gi,
    /\b(accurate )?child anatomy[^.]*\./gi,
    /\bKeep all heads and limbs inside the safe area\.?/gi,
    /\bShow the complete body and action with breathing room around hands and feet[^.]*\./gi,
    /\bhero uses (no more than|about)[^.]*\./gi,
    /\bfriendly eyes WITH clear dark pupils[^.]*\./gi,
    /\bEach reference keeps its own separate design[^.]*\./gi,
    /\bA human body is human all over[^.]*\./gi,
    /\bevery body is whole[^.]*\./gi,
    /\bCOMPOSITION BLUEPRINT:[^.]*\./gi,
  ];
  let net = prompt;
  for (const r of aRetirer) net = net.replace(r, " ");
  net = net.replace(/\s{2,}/g, " ").trim();
  // Un prompt court passe mieux : on garde le début, qui porte l'identité et
  // la scène, et on coupe à la dernière phrase complète.
  if (net.length > 900) {
    const coupe = net.slice(0, 900);
    const dernierPoint = coupe.lastIndexOf(". ");
    net = dernierPoint > 300 ? coupe.slice(0, dernierPoint + 1) : coupe;
  }
  return net;
}

export async function callFal(
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
  fetchBytes = false
): Promise<{
  url: string;
  provider: string;
  /** PNG bytes for the quality guards (converted from webp/etc when needed). */
  bytes?: Uint8Array;
  /** The raw fal URL is unusable downstream (webp) → upload the PNG buffer instead. */
  needsUpload?: boolean;
  /** PNG buffer to persist when needsUpload is true. */
  pngBuffer?: Buffer;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`fal.ai timeout after ${FAL_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    const msg = `fal.ai error: ${text}`;

    // ─────────────────────────────────────────────────────────────────────
    // Refus du filtre de contenu : réessayer une fois avec un prompt allégé.
    //
    // fal renvoie `content_policy_violation` en HTTP 422, et 422 était classé
    // « définitif » → la génération entière mourait (prod gen e3fc2591 : livre
    // payé perdu à la couverture, portraits déjà réussis jetés). Or ce n'est
    // pas un refus du SUJET, c'est un refus d'une TOURNURE : nos prompts font
    // 2000 caractères et empilent les consignes d'anatomie, de cadrage et de
    // corps ; il suffit d'une formulation malheureuse à côté du mot « child ».
    //
    // On renvoie donc une fois la scène seule, sans l'échafaudage technique.
    // Une image un peu moins cadrée vaut infiniment mieux qu'un livre perdu.
    if (/content_policy_violation|flagged by a content checker/i.test(text)) {
      const promptComplet = typeof body.prompt === "string" ? body.prompt : "";
      const promptAllege = allegerPromptRefuse(promptComplet);
      if (promptAllege && promptAllege !== promptComplet) {
        console.warn(
          `[fal] prompt refusé par le filtre de contenu (${promptComplet.length} car.) → nouvelle tentative allégée (${promptAllege.length} car.)`
        );
        return callFal(endpoint, key, { ...body, prompt: promptAllege }, fetchBytes);
      }
      // Déjà allégé et toujours refusé : on laisse remonter comme erreur
      // réessayable, la boucle de re-roll changera la graine et la scène.
      throw new Error(msg);
    }

    if (
      res.status === 422 ||
      res.status === 402 ||
      /feature_not_supported|cannot be 'DESIGN'|Exhausted balance|User is locked/i.test(
        text
      )
    ) {
      throw new NonRetryableFalError(msg);
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as {
    images?: Array<{ url: string }>;
  };

  const url = data.images?.[0]?.url;
  if (!url || typeof url !== "string") {
    throw new Error("No image returned from fal.ai (empty images array)");
  }

  // Fetch the rendered bytes so the caller's quality guard can decide whether to re-roll
  // (blank / colored / poor-environment). The guards only decode PNG and pdf-lib only
  // embeds PNG/JPG, so we normalize: PNG stays as-is; webp/other is converted to PNG and
  // flagged for upload (its raw fal webp URL is unusable downstream). JPEG is kept (usable
  // by pdf-lib) but a PNG copy is still produced so the guards can analyze it.
  // We never throw on a blank/odd result here — quality is handled by the re-roll loop.
  if (fetchBytes) {
    try {
      const raw = new Uint8Array((await fetch(url).then((r) => r.arrayBuffer())) as ArrayBuffer);
      const fmt = detectImageFormat(raw);
      if (fmt === "png") {
        return {
          url,
          provider: "fal.ai",
          bytes: raw,
          needsUpload: false,
          pngBuffer: Buffer.from(raw),
        };
      }
      const pngBuffer = await toPngBuffer(raw);
      const bytes = new Uint8Array(pngBuffer);
      // JPEG is directly embeddable by pdf-lib → keep the fal URL; anything else (webp,
      // gif, unknown) must be uploaded as the converted PNG.
      const needsUpload = fmt !== "jpeg";
      console.log(`[fal] image format=${fmt} → converted to PNG (needsUpload=${needsUpload})`);
      return { url, provider: "fal.ai", bytes, needsUpload, pngBuffer };
    } catch {
      // Couldn't fetch/convert bytes for analysis; ship the URL as-is.
    }
  }

  return { url, provider: "fal.ai" };
}
