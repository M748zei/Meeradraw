import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { clearSessionCookie, getSessionUser } from "@/lib/firebase/session";
import { formatCredits } from "@/lib/utils";

export default async function ProfilePage() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    return (
      <Card>
        <h1 className="font-display text-2xl">Profil démo</h1>
        <p className="mt-2 text-ink-muted">Configurez Firebase pour gérer votre compte.</p>
      </Card>
    );
  }

  const session = await getSessionUser();
  if (!session) redirect("/login");

  let profile: Record<string, unknown> | null = null;
  if (isFirebaseAdminConfigured()) {
    const snap = await getAdminDb().collection("users").doc(session.uid).get();
    profile = snap.exists ? snap.data()! : null;
  }

  async function signOut() {
    "use server";
    await clearSessionCookie();
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="font-display text-3xl">Profil</h1>
      <Card className="space-y-3">
        <div><p className="text-sm text-ink-muted">Nom</p><p className="font-semibold">{(profile?.fullname as string) || (session.name as string) || "—"}</p></div>
        <div><p className="text-sm text-ink-muted">Email</p><p className="font-semibold">{(profile?.email as string) || (session.email as string)}</p></div>
        <div><p className="text-sm text-ink-muted">Plan</p><p className="font-semibold capitalize">{(profile?.subscription_plan as string) || "free"}</p></div>
        <div><p className="text-sm text-ink-muted">Crédits</p><p className="font-semibold">{formatCredits((profile?.credits as number) ?? 0)}</p></div>
      </Card>
      <form action={signOut}>
        <Button type="submit" variant="secondary" className="w-full">Se déconnecter</Button>
      </form>
    </div>
  );
}
