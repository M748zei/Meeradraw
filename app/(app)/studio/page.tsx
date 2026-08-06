import { GenerateurStudio } from "@/components/studio/generateur";
import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase/server";
import { lireSolde } from "@/services/hub-wallet";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  let solde: number | null = null;
  if (isSupabaseServerConfigured()) {
    const supabase = await getSupabaseServer();
    solde = await lireSolde(supabase);
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl text-ink">Ton prochain visuel</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Décris la scène en une phrase, choisis le style, le cadre — le studio
          peint le reste.
        </p>
      </div>
      <GenerateurStudio soldeInitial={solde} />
    </div>
  );
}
