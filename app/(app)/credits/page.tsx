"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CREDIT_PACKS } from "@/config/credits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, formatCredits } from "@/lib/utils";

function CreditsInner() {
  const search = useSearchParams();
  const success = search.get("success");
  const need = search.get("need");
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(
    success ? "Crédits ajoutés avec succès ✦" : null
  );

  async function buy(packId: string) {
    setLoading(packId);
    setMessage(null);
    try {
      const res = await fetch("/api/credits/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_id: packId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Erreur");
      if (json.data.checkout_url) {
        window.location.assign(json.data.checkout_url);
        return;
      }
      if (json.data.demo) {
        setMessage(
          `Mode démo : +${json.data.credits_added} crédits (solde ${json.data.balance})`
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-3xl">Crédits</h1>
        <p className="mt-2 text-ink-muted">
          Chaque génération affiche son coût avant de commencer. Aucune surprise.
        </p>
        {need ? (
          <Card className="mt-4 border-sky-200 bg-sky-50">
            Votre projet est prêt. Il vous manque seulement {need} crédits.
          </Card>
        ) : null}
        {message ? (
          <p className="mt-4 text-sm font-semibold text-mint-800">{message}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CREDIT_PACKS.map((pack) => (
          <Card
            key={pack.id}
            className={cn(
              "relative",
              "popular" in pack && pack.popular ? "border-sky-300 ring-2 ring-sky-100" : ""
            )}
          >
            {"popular" in pack && pack.popular ? (
              <span className="absolute -top-3 right-4 rounded-full bg-sky-500 px-3 py-0.5 text-xs font-semibold text-white">
                Populaire
              </span>
            ) : null}
            <h3 className="font-display text-xl">{pack.name}</h3>
            <p className="mt-1 text-sm text-ink-muted">{pack.description}</p>
            <p className="mt-4 font-display text-3xl text-sky-700">
              {formatCredits(pack.credits)}
            </p>
            <p className="text-sm text-ink-muted">
              {(pack.priceEur / 100).toFixed(2).replace(".", ",")} €
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() => buy(pack.id)}
              disabled={loading === pack.id}
            >
              {loading === pack.id ? "Ouverture…" : "Acheter"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function CreditsPage() {
  return (
    <Suspense>
      <CreditsInner />
    </Suspense>
  );
}
