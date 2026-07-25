import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminAuth, getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/firebase/session";
import {
  clearPurchaseContextCookie,
  getPurchaseContextCookie,
} from "@/lib/purchase-context";
import { clientIp, rateLimit } from "@/lib/rate-limit-store";
import { AccessOpenService } from "@/services/access-open";
import { z } from "zod";

const schema = z.object({
  sale: z.string().min(3).max(120).optional(),
  sale_id: z.string().min(3).max(120).optional(),
});

/**
 * Attach a verified Chariow purchase to the authenticated session user.
 * Email must match the Chariow buyer email and be verified (Google or confirmed).
 */
export async function POST(request: Request) {
  try {
    rateLimit(`access-attach:${clientIp(request)}`, { limit: 20, windowMs: 60_000 });

    if (!isFirebaseAdminConfigured()) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Nous n’arrivons pas encore à confirmer votre achat. Réessayez dans quelques instants. Aucun nouveau paiement ne vous sera demandé.",
        503
      );
    }

    const session = await getSessionUser();
    if (!session?.uid) {
      throw new AppError("UNAUTHORIZED", "Connectez-vous pour ouvrir votre accès.", 401);
    }

    const body = schema.parse(await request.json().catch(() => ({})));
    const ctx = await getPurchaseContextCookie();
    const saleId = body.sale || body.sale_id || ctx?.saleId;
    if (!saleId) {
      throw new AppError("VALIDATION_ERROR", "Nous n’avons pas retrouvé votre achat.", 400);
    }

    // Prefer live Auth record for email_verified (session cookie may omit it).
    let email = (session.email as string | undefined) || null;
    let emailVerified = Boolean(session.email_verified);
    try {
      const user = await getAdminAuth().getUser(session.uid);
      email = user.email || email;
      emailVerified = Boolean(user.emailVerified);
      // Google / federated providers count as verified ownership.
      if (!emailVerified && user.providerData.some((p) => p.providerId === "google.com")) {
        emailVerified = true;
      }
    } catch {
      /* keep session fields */
    }

    const result = await new AccessOpenService(getAdminDb()).attachToUser({
      userId: session.uid,
      userEmail: email,
      emailVerified,
      saleId,
    });

    await clearPurchaseContextCookie();
    return apiSuccess(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", "Référence d’achat invalide.", 400));
    }
    return apiError(e);
  }
}
