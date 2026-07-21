import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { createSessionCookie, clearSessionCookie } from "@/lib/firebase/session";
import { getAdminAuth, getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { FREE_CREDITS_ON_SIGNUP } from "@/config/credits";
import { z } from "zod";

const schema = z.object({ idToken: z.string().min(10) });

export async function POST(request: Request) {
  try {
    const { idToken } = schema.parse(await request.json());
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    await createSessionCookie(idToken);

    if (isFirebaseAdminConfigured()) {
      const db = getAdminDb();
      const ref = db.collection("users").doc(decoded.uid);
      const snap = await ref.get();
      if (!snap.exists) {
        const now = new Date().toISOString();
        await ref.set({
          id: decoded.uid,
          fullname: decoded.name || decoded.email?.split("@")[0] || null,
          email: decoded.email || "",
          avatar_url: decoded.picture || null,
          subscription_plan: "free",
          credits: FREE_CREDITS_ON_SIGNUP,
          preferred_language: "fr",
          created_at: now,
          updated_at: now,
        });
        await ref.collection("credit_ledger").add({
          operation: "credit",
          amount: FREE_CREDITS_ON_SIGNUP,
          balance_after: FREE_CREDITS_ON_SIGNUP,
          reason: "Bonus de bienvenue",
          created_at: now,
        });
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
