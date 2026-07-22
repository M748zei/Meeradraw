import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div>
        <p className="font-display text-6xl text-sky-600">404</p>
        <h1 className="mt-2 font-display text-2xl text-ink">
          Cette page s&apos;est envolée du livre
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-ink-muted">
          L&apos;adresse n&apos;existe pas (ou plus). Retourne au studio pour
          continuer à créer.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/dashboard">
          <Button>Aller au studio</Button>
        </Link>
        <Link href="/">
          <Button variant="secondary">Page d&apos;accueil</Button>
        </Link>
      </div>
    </main>
  );
}
