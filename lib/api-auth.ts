import { AppError } from "@/lib/errors";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/firebase/session";
import type { Profile } from "@/types/database";
import { FREE_CREDITS_ON_SIGNUP } from "@/config/credits";

export async function requireUser() {
  const session = await getSessionUser();
  if (!session?.uid) {
    throw new AppError("UNAUTHORIZED", "Connexion requise", 401);
  }

  const db = getAdminDb();
  const ref = db.collection("users").doc(session.uid);
  const snap = await ref.get();

  let profile = snap.exists ? ({ id: snap.id, ...snap.data() } as Profile) : null;

  if (!profile) {
    profile = {
      id: session.uid,
      fullname: (session.name as string) || null,
      email: (session.email as string) || "",
      avatar_url: (session.picture as string) || null,
      subscription_plan: "free",
      credits: FREE_CREDITS_ON_SIGNUP,
      preferred_language: "fr",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (isFirebaseAdminConfigured()) {
      await ref.set(profile);
      await db.collection("users").doc(session.uid).collection("credit_ledger").add({
        operation: "credit",
        amount: FREE_CREDITS_ON_SIGNUP,
        balance_after: FREE_CREDITS_ON_SIGNUP,
        reason: "Bonus de bienvenue",
        created_at: new Date().toISOString(),
      });
    }
  }

  return {
    user: { id: session.uid, email: session.email as string | undefined },
    profile,
    db,
  };
}
