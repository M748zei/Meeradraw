"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg items-center justify-center px-4">
      <Card className="w-full space-y-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-sky-600">
          Meeradraw
        </p>
        <h1 className="font-display text-2xl text-ink">Petit souci technique</h1>
        <p className="text-sm text-ink-muted">
          Nous n&apos;avons pas pu charger cette page. Réessaie — tes créations
          sont en sécurité.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button onClick={reset}>Réessayer</Button>
          <Link href="/dashboard">
            <Button variant="secondary">Retour au studio</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
