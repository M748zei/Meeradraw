import { randomUUID, randomInt } from "crypto";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit-store";
import { compilerPrompt } from "@/services/studio/compiler";
import {
  actionPourVariantes,
  genererImageStudio,
  MODELE_IDS,
  studioDisponible,
  studioEndpoint,
} from "@/services/studio/generation";
import {
  composerProduit,
  detourerProduit,
  genererAvecReference,
} from "@/services/studio/reference";
import { PRESETS } from "@/services/studio/presets";
import { debiterAction, rembourserAction } from "@/services/hub-wallet";
import { FORMATS, HEURES, PRESET_IDS, REGIONS } from "@/services/studio/types";

export const maxDuration = 300;

const saisieSchema = z.object({
  phrase: z.string().max(300).optional(),
  personnages: z
    .array(
      z.object({
        role: z.string().max(80).optional(),
        tenue: z.string().max(120).optional(),
        action: z.string().max(120).optional(),
      })
    )
    .max(3)
    .optional(),
  objets: z.array(z.string().max(120)).max(3).optional(),
  textes: z.record(z.string().max(40), z.string().max(160)).optional(),
  annee: z.coerce.number().int().min(1400).max(2100).optional(),
  lieu: z.string().max(80).optional(),
});

const schema = z.object({
  preset: z.enum(PRESET_IDS),
  saisie: saisieSchema,
  heure: z.enum(HEURES).optional(),
  format: z.enum(FORMATS),
  variantes: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  // Mode avancé — replié pour l'utilisateur ordinaire.
  region: z.enum(REGIONS).optional(),
  promptLibre: z.string().max(500).optional(),
  modele: z.enum(MODELE_IDS).optional(),
  graine: z.coerce.number().int().min(1).max(2_000_000_000).optional(),
  // Image de référence (chantiers 4-5). La photo transite en data-URL, elle
  // n'est jamais écrite sur nos serveurs (voir services/studio/reference.ts).
  reference: z
    .object({
      type: z.enum(["produit", "selfie"]),
      dataUrl: z
        .string()
        .regex(/^data:image\/(jpeg|png|webp);base64,/, "Format d'image invalide.")
        .max(9_000_000, "Photo trop lourde — 6 Mo maximum."),
    })
    .optional(),
  // « Intégration poussée » : le modèle repeint le produit — étiquette altérable.
  integrationPoussee: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireUser();
    rateLimit(`images:${user.id}`, { limit: 10, windowMs: 60_000 });

    const input = schema.parse(await request.json());

    // Refuser AVANT de débiter si le service est connu indisponible.
    if (!studioDisponible()) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Le studio est indisponible pour le moment. Tes crédits n'ont pas été touchés.",
        503
      );
    }

    // L'utilisateur ne voit jamais ce prompt — c'est la recette du preset.
    // compilerPrompt jette si la phrase manque alors que le preset la déclare.
    let prompt: string;
    try {
      prompt = compilerPrompt(input);
    } catch (err) {
      throw new AppError(
        "VALIDATION_ERROR",
        err instanceof Error ? err.message : "Entrée invalide.",
        400
      );
    }

    // La référence n'est acceptée que si le preset la déclare.
    if (input.reference && PRESETS[input.preset].reference !== input.reference.type) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Ce style n'accepte pas ce type d'image de référence.",
        400
      );
    }

    // Le détourage se fait AVANT le débit : s'il échoue, zéro crédit touché.
    let produitPng: Buffer | null = null;
    if (input.reference?.type === "produit" && !input.integrationPoussee) {
      produitPng = await detourerProduit(input.reference.dataUrl).catch(() => null);
      if (!produitPng) {
        throw new AppError(
          "GENERATION_FAILED",
          "Le détourage de ta photo a échoué — rien n'a été débité. Réessaie avec une photo où le produit se détache mieux du fond.",
          502
        );
      }
    }

    // Débit d'abord — la même ref sert au remboursement (idempotence des deux côtés).
    // Avec référence : 3 crédits l'image au lieu de 2 (packs 5 et 9).
    const action = input.reference
      ? `studio.imageref${input.variantes}`
      : actionPourVariantes(input.variantes);
    const ref = `studio:${randomUUID()}`;
    const debit = await debiterAction(supabase, action, ref);
    if (!debit.ok) {
      if (debit.raison === "SOLDE_INSUFFISANT") {
        throw new AppError(
          "INSUFFICIENT_CREDITS",
          `Il te faut ${debit.cout ?? "des"} crédits pour ${input.variantes} image${input.variantes > 1 ? "s" : ""}. Recharge sur DigiAfrik, ton solde te suit partout.`,
          402
        );
      }
      if (debit.raison === "NON_CONNECTE") {
        throw new AppError("UNAUTHORIZED", "Connexion requise", 401);
      }
      throw new AppError(
        "INTERNAL_ERROR",
        "Le portefeuille n'a pas répondu. Rien n'a été débité — réessaie dans un instant.",
        503
      );
    }

    // Une variante = un appel (chacune reste régénérable seule). La graine du
    // mode avancé rend une image reproductible ; sinon elle est tirée au sort.
    const graine = input.graine ?? randomInt(1, 2_000_000_000);
    const endpoint = studioEndpoint(input.modele);

    let genererUne: (seed: number) => Promise<string>;
    if (produitPng) {
      // Détourage-composite (défaut) : le produit n'est JAMAIS redessiné.
      const promptDecor = compilerPrompt({ ...input, decorProduit: true });
      genererUne = async (seed) => {
        const { url } = await genererImageStudio({ prompt: promptDecor, format: input.format, seed, endpoint });
        const decor = Buffer.from(await (await fetch(url)).arrayBuffer());
        const composite = await composerProduit(decor, produitPng, input.preset);
        return `data:image/jpeg;base64,${composite.toString("base64")}`;
      };
    } else if (input.reference) {
      // Selfie (identité) ou « intégration poussée » produit : le modèle peint
      // à partir de la référence. Pour un selfie, le compilateur a déjà retiré
      // le bloc « personnes » de l'ancrage (avecSelfie).
      const promptRef =
        input.reference.type === "selfie"
          ? `${compilerPrompt({ ...input, avecSelfie: true })} The person in the reference image is the subject: preserve their exact face, features and hair faithfully.`
          : `${prompt} The product in the reference image appears in the scene, its shape, colors and label preserved faithfully.`;
      const dataUrl = input.reference.dataUrl;
      genererUne = async (seed) => {
        const { url } = await genererAvecReference({
          prompt: promptRef,
          referenceDataUrl: dataUrl,
          format: input.format,
          seed,
        });
        return url;
      };
    } else {
      genererUne = async (seed) => {
        const { url } = await genererImageStudio({ prompt, format: input.format, seed, endpoint });
        return url;
      };
    }

    const resultats = await Promise.allSettled(
      Array.from({ length: input.variantes }, (_, i) => genererUne(graine + i * 7919))
    );
    const urls = resultats
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);
    const echecs = resultats.filter((r) => r.status === "rejected");
    for (const e of echecs) {
      console.error("[images] variante échouée", {
        ref,
        erreur: e.status === "rejected" ? String(e.reason).slice(0, 300) : "",
      });
    }

    if (urls.length === 0) {
      // Tout a échoué : remboursement automatique, même ref. Jamais silencieux.
      const refund = await rembourserAction(supabase, action, ref);
      if (refund.ok) {
        throw new AppError(
          "GENERATION_FAILED",
          "La génération a échoué. Tes crédits t'ont été rendus — relance, la scène passe souvent au second essai.",
          502
        );
      }
      console.error(
        `[images] GÉNÉRATION ÉCHOUÉE ET REMBOURSEMENT ÉCHOUÉ — intervention requise. ref=${ref}`
      );
      throw new AppError(
        "INTERNAL_ERROR",
        `La génération a échoué et le remboursement automatique n'a pas pu être confirmé. Note cette référence : ${ref} — le support te recréditera.`,
        500
      );
    }

    // Réussite partielle : on livre ce qui existe et on le DIT (§7.8 d'hier
    // vaut toujours : aucune limite silencieuse).
    return apiSuccess({
      urls,
      demandees: input.variantes,
      livrees: urls.length,
      ref,
      graine,
      solde: debit.solde,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(
        new AppError("VALIDATION_ERROR", e.issues[0]?.message ?? "Entrée invalide.", 400)
      );
    }
    return apiError(e);
  }
}
