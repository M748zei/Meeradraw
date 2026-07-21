import { AppShell } from "@/components/layout/app-shell";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/firebase/session";
import { redirect } from "next/navigation";

function isFirebaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isFirebaseConfigured()) {
    return (
      <AppShell credits={30} name="Créateur">
        <div className="mb-6 rounded-2xl border border-yellow-300 bg-yellow-100 px-4 py-3 text-sm text-ink">
          Mode démo : configurez Firebase dans <code>.env.local</code> pour activer
          l&apos;authentification et Firestore.
        </div>
        {children}
      </AppShell>
    );
  }

  const session = await getSessionUser();
  if (!session) redirect("/login");

  let credits = 30;
  let name: string | null = (session.name as string) || null;

  if (isFirebaseAdminConfigured()) {
    try {
      const snap = await getAdminDb().collection("users").doc(session.uid).get();
      if (snap.exists) {
        credits = (snap.data()?.credits as number) ?? 30;
        name = (snap.data()?.fullname as string) || name;
      }
    } catch {
      // ignore if admin not fully ready
    }
  }

  return <AppShell credits={credits} name={name}>{children}</AppShell>;
}
