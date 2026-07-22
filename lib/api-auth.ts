import { AppError } from "@/lib/errors";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/firebase/session";
import type { Profile } from "@/types/database";
import { FREE_TRIALS_MAX } from "@/config/credits";

export function buildNewProfile(session: {
  uid: string;
  name?: unknown;
  email?: unknown;
  picture?: unknown;
}): Profile {
  const now = new Date().toISOString();
  return {
    id: session.uid,
    fullname: (session.name as string) || null,
    email: (session.email as string) || "",
    avatar_url: (session.picture as string) || null,
    subscription_plan: "free",
    // No welcome credits: new accounts get FREE_TRIALS_MAX free trial books
    // instead (paid credits only ever come from Chariow purchases).
    credits: 0,
    free_trials_used: 0,
    free_trials_max: FREE_TRIALS_MAX,
    preferred_language: "fr",
    created_at: now,
    updated_at: now,
  };
}

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
    profile = buildNewProfile(session);
    if (isFirebaseAdminConfigured()) {
      await ref.set(profile);
    }
  }

  return {
    user: { id: session.uid, email: session.email as string | undefined },
    profile,
    db,
  };
}
