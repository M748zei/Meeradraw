"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CREDIT_PACKS, formatFcfa } from "@/config/credits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatCredits } from "@/lib/utils";

const PHONE_COUNTRIES = [
  { code: "NE", label: "Niger (+227)" },
  { code: "SN", label: "Sénégal (+221)" },
  { code: "CI", label: "Côte d’Ivoire (+225)" },
  { code: "BJ", label: "Bénin (+229)" },
  { code: "TG", label: "Togo (+228)" },
  { code: "BF", label: "Burkina Faso (+226)" },
  { code: "ML", label: "Mali (+223)" },
  { code: "CM", label: "Cameroun (+237)" },
  { code: "GN", label: "Guinée (+224)" },
  { code: "CD", label: "RD Congo (+243)" },
  { code: "GA", label: "Gabon (+241)" },
  { code: "FR", label: "France (+33)" },
];

function CreditsInner() {
  const search = useSearchParams();
  const success = search.get("success");
  const need = search.get("need");
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(
    success ? "Crédits ajoutés avec succès ✦" : null
  );
  // Chariow checkout needs a Mobile Money phone: asked once, saved to profile.
  const [phonePack, setPhonePack] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("NE");

  async function buy(packId: string, phone?: { number: string; country_code: string }) {
    setLoading(packId);
    setMessage(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_id: packId, ...(phone ? { phone } : {}) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Erreur");
      if (json.data.need_phone) {
        setPhonePack(packId);
        return;
      }
      if (json.data.checkout_url) {
        window.location.assign(json.data.checkout_url);
        return;
      }
      if (json.data.completed) {
        setMessage("Achat confirmé — tes crédits arrivent dans quelques secondes.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(null);
    }
  }

  function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    const digits = phoneNumber.replace(/\D/g, "");
    if (digits.length < 6 || !phonePack) return;
    const pack = phonePack;
    setPhonePack(null);
    void buy(pack, { number: digits, country_code: phoneCountry });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-3xl">Recharger mes crédits</h1>
        <p className="mt-2 text-ink-muted">
          Chaque génération affiche son coût avant de commencer. Aucune surprise.
          Paiement Mobile Money ou carte, crédits ajoutés automatiquement.
        </p>
        {need ? (
          <Card className="mt-4 border-sky-200 bg-sky-50">
            Ton projet est prêt. Il te manque seulement {need} crédits.
          </Card>
        ) : null}
        {message ? (
          <p className="mt-4 text-sm font-semibold text-mint-800">{message}</p>
        ) : null}
      </div>

      {phonePack ? (
        <Card className="border-sky-200 bg-sky-50/70">
          <form onSubmit={submitPhone} className="space-y-3">
            <p className="font-semibold">Ton numéro Mobile Money</p>
            <p className="text-sm text-ink-muted">
              Il pré-remplit la page de paiement (Orange Money, Wave, MoMo…).
              Demandé une seule fois.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value)}
                className="h-11 rounded-2xl border border-cream-200 bg-white px-3 text-sm"
              >
                {PHONE_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Input
                type="tel"
                inputMode="numeric"
                placeholder="Ex : 90000000"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
                minLength={6}
                className="flex-1"
              />
              <Button type="submit">Continuer</Button>
            </div>
          </form>
        </Card>
      ) : null}

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
            {"unlocksAccess" in pack && pack.unlocksAccess ? (
              <span className="absolute -top-3 right-4 rounded-full bg-mint-500 px-3 py-0.5 text-xs font-semibold text-white">
                Débloque le studio
              </span>
            ) : null}
            <h3 className="font-display text-xl">{pack.name}</h3>
            <p className="mt-1 text-sm text-ink-muted">{pack.description}</p>
            <p className="mt-4 font-display text-3xl text-sky-700">
              {formatCredits(pack.credits)}
            </p>
            <p className="text-sm text-ink-muted">{formatFcfa(pack.priceFcfa)}</p>
            <Button
              className="mt-5 w-full"
              onClick={() => buy(pack.id)}
              disabled={loading === pack.id}
            >
              {loading === pack.id ? "Ouverture…" : "Recharger"}
            </Button>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-ink-muted">
        Les crédits n&apos;expirent pas. Après paiement, ils apparaissent
        automatiquement sur ton compte.
      </p>
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
