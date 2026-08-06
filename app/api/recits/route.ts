import { randomUUID } from "crypto";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit-store";
import { genererRecit, moteurDisponible } from "@/services/griot/engine";
import { COUT_RECIT, debiterRecit, rembourserRecit } from "@/services/hub-wallet";
import { ANGLES, DUREES } from "@/services/griot/types";

const schema = z.object({
  sujet: z.string().min(8, "Décris ton sujet en quelques mots (8 caractères minimum).").max(400),
  angle: z.enum(ANGLES),
  pays: z.string().max(60).optional(),
  duree: z.enum(DUREES),
});

export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireUser();
    rateLimit(`recits:${user.id}`, { limit: 6, windowMs: 60_000 });

    const input = schema.parse(await request.json());

    // Refuser AVANT de débiter si le service est connu indisponible (§7.3).
    if (!moteurDisponible()) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Le service de génération est indisponible pour le moment. Tes crédits n'ont pas été touchés.",
        503
      );
    }

    // Débit d'abord — la même ref sert au remboursement (idempotence des deux côtés).
    const ref = `griot:${randomUUID()}`;
    const debit = await debiterRecit(supabase, ref);
    if (!debit.ok) {
      if (debit.raison === "SOLDE_INSUFFISANT") {
        throw new AppError(
          "INSUFFICIENT_CREDITS",
          `Il te faut ${debit.cout ?? COUT_RECIT} crédits pour un récit. Recharge sur DigiAfrik, ton solde te suit partout.`,
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

    try {
      const recit = await genererRecit(input);

      const { error: insertError } = await supabase.from("griot_recits").insert({
        user_id: user.id,
        ref,
        sujet: input.sujet,
        angle: input.angle,
        pays: input.pays ?? null,
        duree: input.duree,
        titre: recit.titre,
        contenu: recit,
        statut: "pret",
      });
      if (insertError) {
        // Le récit existe : on le livre quand même, mais on le dit (§7.8).
        console.error("[recits] sauvegarde échouée — récit livré non archivé", {
          ref,
          error: insertError.message,
        });
      }

      return apiSuccess({
        recit,
        ref,
        solde: debit.solde,
        sauvegarde: !insertError,
      });
    } catch (genErr) {
      // Remboursement automatique, même ref (§7.2). Jamais silencieux.
      const refund = await rembourserRecit(supabase, ref);
      if (refund.ok) {
        throw new AppError(
          "GENERATION_FAILED",
          "La génération a échoué. Tes crédits t'ont été rendus — relance, le sujet passe souvent au second essai.",
          502
        );
      }
      console.error(
        `[recits] GÉNÉRATION ÉCHOUÉE ET REMBOURSEMENT ÉCHOUÉ — intervention requise. ref=${ref}`,
        genErr instanceof Error ? genErr.message : genErr
      );
      throw new AppError(
        "INTERNAL_ERROR",
        `La génération a échoué et le remboursement automatique n'a pas pu être confirmé. Note cette référence : ${ref} — le support te recréditera.`,
        500
      );
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(
        new AppError("VALIDATION_ERROR", e.issues[0]?.message ?? "Entrée invalide.", 400)
      );
    }
    return apiError(e);
  }
}

/** Les 10 derniers récits de l'utilisateur (historique de l'écran). */
export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("griot_recits")
      .select("id, sujet, angle, pays, duree, titre, contenu, statut, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) {
      throw new AppError("INTERNAL_ERROR", "Impossible de charger tes récits.", 503);
    }
    return apiSuccess({ recits: data ?? [] });
  } catch (e) {
    return apiError(e);
  }
}
