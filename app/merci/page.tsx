import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export const metadata = { title: "Merci — Meeradraw" };

/**
 * Post-checkout landing. The credits are granted by the Chariow webhook a few
 * seconds after payment — this page just reassures and routes back.
 */
export default function MerciPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint-100 text-mint-700">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="font-display text-3xl">Merci pour ton achat ✦</h1>
        <p className="text-ink-muted">
          Tes crédits sont en route — ils apparaissent sur ton compte dans
          quelques secondes. Si c&apos;est ton premier achat, pense aussi à
          entrer ton code d&apos;accès reçu par email.
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
          Un souci ? Réponds simplement à l&apos;email de confirmation d&apos;achat.
        </p>
      </div>
    </main>
  );
}
