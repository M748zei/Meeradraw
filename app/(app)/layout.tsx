import { AppShell } from "@/components/layout/app-shell";
import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase/server";
import { lireSolde } from "@/services/hub-wallet";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseServerConfigured()) {
    return (
      <AppShell solde={null}>
        <div className="mb-6 rounded-2xl border border-yellow-300 bg-yellow-100 px-4 py-3 text-sm text-ink">
          Configuration Supabase manquante — connexion et crédits indisponibles.
        </div>
        {children}
      </AppShell>
    );
  }

  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const solde = await lireSolde(supabase);

  return <AppShell solde={solde}>{children}</AppShell>;
}
