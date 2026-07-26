import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { createSessionCookie, clearSessionCookie } from "@/lib/firebase/session";
import { getAdminAuth, getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { buildNewProfile } from "@/lib/api-auth";
import { isDisposableEmail } from "@/lib/disposable-email";
import { hasVerifiedEmailOwnership } from "@/lib/email-ownership";
import { claimPendingCredits } from "@/services/chariow-sale";
import { AccessOpenService } from "@/services/access-open";
import {
  clearPurchaseContextCookie,
  getPurchaseContextCookie,
} from "@/lib/purchase-context";
import { clientIp, rateLimit } from "@/lib/rate-limit-store";
import { z } from "zod";

const schema = z.object({ idToken: z.string().min(10) });

export async function POST(request: Request) {
  try {
    rateLimit(`session:${clientIp(request)}`, { limit: 15, windowMs: 60_000 });
    const { idToken } = schema.parse(await request.json());
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    let emailOwnershipVerified = hasVerifiedEmailOwnership(
      Boolean(decoded.email_verified)
    );
    try {
      const userRecord = await getAdminAuth().getUser(decoded.uid);
      emailOwnershipVerified = hasVerifiedEmailOwnership(
        Boolean(userRecord.emailVerified),
        userRecord.providerData.map((provider) => provider.providerId)
      );
    } catch {
      /* Keep the verified Firebase token claim. */
    }

    // One account = one real email = the free trials. Throwaway domains are
    // rejected for email/password AND Google sign-ins; the just-created Auth
    // user is removed so the address can't be retried into a zombie account.
    if (isDisposableEmail(decoded.email)) {
      await getAdminAuth()
        .deleteUser(decoded.uid)
        .catch(() => undefined);
      throw new AppError("VALIDATION_ERROR", "Utilise une adresse email valide.", 403);
    }

    await createSessionCookie(idToken);

    if (isFirebaseAdminConfigured()) {
      const db = getAdminDb();
      const ref = db.collection("users").doc(decoded.uid);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set(buildNewProfile(decoded));
      }
      // Purchases made with this email before the account existed (or while
      // the webhook raced signup) land now — idempotent per sale.
      if (decoded.email && emailOwnershipVerified) {
        await claimPendingCredits(db, decoded.uid, decoded.email).catch((err) =>
          console.error("claimPendingCredits failed", err)
        );
        await new AccessOpenService(db)
          .claimPendingForUser(decoded.uid, decoded.email, true)
          .catch((err) =>
            console.warn(
              "claimPendingForUser failed",
              err instanceof Error ? err.message : err
            )
          );
      }

      // Post-purchase cookie context (from /ouvrir-mon-acces) — attach only when
      // the Auth email matches and is verified / Google.
      const purchaseCtx = await getPurchaseContextCookie();
      if (purchaseCtx?.saleId && decoded.email) {
        if (emailOwnershipVerified) {
          await new AccessOpenService(db)
            .attachToUser({
              userId: decoded.uid,
              userEmail: decoded.email,
              emailVerified: true,
              saleId: purchaseCtx.saleId,
            })
            .then(() => clearPurchaseContextCookie())
            .catch((err) =>
              console.warn("attach purchase on session failed", err instanceof Error ? err.message : err)
            );
        }
      }
    }

    return apiSuccess({ uid: decoded.uid });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", "Token invalide", 400));
    }
    return apiError(e);
  }
}

export async function DELETE() {
  try {
    await clearSessionCookie();
    return apiSuccess({ signedOut: true });
  } catch (e) {
    return apiError(e);
  }
}
