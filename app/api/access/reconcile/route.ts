import { requireUser } from "@/lib/api-auth";
import { hasVerifiedEmailOwnership } from "@/lib/email-ownership";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminAuth } from "@/lib/firebase/admin";
import { rateLimit } from "@/lib/rate-limit-store";
import { AccessOpenService } from "@/services/access-open";

/**
 * Reconciles completed Chariow purchases with the authenticated account.
 * This is safe to retry: purchase attachment and credit grants are idempotent.
 */
export async function POST() {
  try {
    const { db, user } = await requireUser();
    rateLimit(`access-reconcile:${user.id}`, { limit: 8, windowMs: 60_000 });

    if (!user.email) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Aucune adresse e-mail n’est associée à ce compte.",
        400
      );
    }

    const record = await getAdminAuth().getUser(user.id);
    const emailVerified = hasVerifiedEmailOwnership(
      record.emailVerified,
      record.providerData.map((provider) => provider.providerId)
    );
    if (!emailVerified) {
      throw new AppError(
        "FORBIDDEN",
        "Confirmez votre adresse e-mail avant de récupérer votre achat.",
        403
      );
    }

    const result = await new AccessOpenService(db).claimPendingForUser(
      user.id,
      user.email,
      true
    );
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
