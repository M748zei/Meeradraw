import { Generateur } from "@/components/griot/generateur";
import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase/server";
import { lireSolde } from "@/services/hub-wallet";

export const dynamic = "force-dynamic";

export default async function GriotPage() {
  let solde: number | null = null;
  if (isSupabaseServerConfigured()) {
    const supabase = await getSupabaseServer();
    solde = await lireSolde(supabase);
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl text-ink">Ton prochain reel</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Donne le sujet, choisis l&apos;angle et la durée — Griot écrit tout :
          accroches, script, plans, description, hashtags.
        </p>
      </div>
      <Generateur soldeInitial={solde} />
    </div>
  );
}
