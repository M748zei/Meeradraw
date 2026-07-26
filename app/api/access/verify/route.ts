import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/firebase/session";
import { setPurchaseContextCookie } from "@/lib/purchase-context";
import { clientIp, rateLimit } from "@/lib/rate-limit-store";
import { AccessOpenService } from "@/services/access-open";
import { z } from "zod";

const schema = z.object({
  sale: z.string().min(3).max(120).optional(),
  sale_id: z.string().min(3).max(120).optional(),
});

/**
 * Server-side Chariow sale verification for /ouvrir-mon-acces.
 * Never trusts the URL alone — always re-fetches the sale via CHARIOW_API_KEY.
 */
export async function POST(request: Request) {
  try {
    rateLimit(`access-verify:${clientIp(request)}`, { limit: 30, windowMs: 60_000 });
    const body = schema.parse(await request.json().catch(() => ({})));
    const saleId = body.sale || body.sale_id || null;

    if (!isFirebaseAdminConfigured()) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Nous n’arrivons pas encore à confirmer votre achat. Réessayez dans quelques instants. Aucun nouveau paiement ne vous sera demandé.",
        503
      );
    }

    const session = await getSessionUser();
    const outcome = await new AccessOpenService(getAdminDb()).verifySale(
      saleId,
      session?.uid ?? null
    );

    if (outcome.state === "ready") {
      await setPurchaseContextCookie({
        saleId: outcome.saleId,
        email: outcome.email,
        productId: outcome.productId,
      });
      // Never echo the full email when accountExists — only masked + flags.
      return apiSuccess({
        state: outcome.state,
        saleId: outcome.saleId,
        emailMasked: outcome.emailMasked,
        accountExists: outcome.accountExists,
        unlocksAccess: outcome.unlocksAccess,
        credits: outcome.credits,
        packName: outcome.packName,
      });
    }

    return apiSuccess(outcome);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", "Référence d’achat invalide.", 400));
    }
    return apiError(e);
  }
}
