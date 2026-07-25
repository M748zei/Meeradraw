import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export const metadata = { title: "Merci — Meeradraw" };

/**
 * Post-checkout landing for credit recharges.
 * If a sale id is present, prefer the dedicated open-access flow (covers the
 * Accès Meeradraw product and any buyer arriving via a shared redirect URL).
 */
export default async function MerciPage({
  searchParams,
}: {
  searchParams: Promise<{ sale?: string; sale_id?: string }>;
}) {
  const params = await searchParams;
  const sale = params.sale || params.sale_id;
  if (sale) {
    redirect(`/ouvrir-mon-acces?sale=${encodeURIComponent(sale)}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint-100 text-mint-700">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="font-display text-3xl">Merci pour ton achat ✦</h1>
        <p className="text-ink-muted">
          Tes crédits sont en route — ils apparaissent sur ton compte dans
          quelques secondes. Si c&apos;est ton premier achat, ouvre ton accès
          depuis le lien reçu par e-mail.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/credits">
            <Button>Voir mes crédits</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="secondary">Aller au studio</Button>
          </Link>
        </div>
        <p className="text-xs text-ink-muted">
          Un souci ? Écris à{" "}
          <a href="mailto:support.digiafrik@gmail.com" className="underline">
            support.digiafrik@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
