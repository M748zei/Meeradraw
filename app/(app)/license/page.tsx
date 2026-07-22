"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckCircle2, KeyRound, ShieldCheck, Sparkles } from "lucide-react";

type Status = {
  configured: boolean;
  required: boolean;
  valid?: boolean;
  license?: {
    status?: string;
    product?: string | null;
    expires_at?: string | null;
    masked_key?: string | null;
    is_active?: boolean;
  } | null;
  message?: string;
  trials?: { used: number; max: number; remaining: number; max_pages: number };
};

const STORE_URL = process.env.NEXT_PUBLIC_CHARIOW_STORE_URL;

export default function AccessPage() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/license/status");
    const json = await res.json();
    if (json.success) setStatus(json.data);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: key }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Déblocage impossible");
      await refresh();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  const valid = status?.valid;
  const configured = status?.configured;
  const trials = status?.trials;
  const trialsExhausted = Boolean(
    configured && !valid && trials && trials.remaining <= 0
  );

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-mint-100 text-sky-700">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="font-display text-3xl">Ton accès</h1>
        <p className="mt-2 text-ink-muted">
          Après ton achat, entre ici le code d&apos;accès reçu par email pour
          débloquer ton studio.
        </p>
        {STORE_URL ? (
          <p className="mt-2 text-sm">
            Pas encore d&apos;accès ?{" "}
            <a
              href={STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-sky-700 underline"
            >
              Prendre mon accès Meeradraw
            </a>
          </p>
        ) : null}
      </div>

      {trialsExhausted ? (
        <Card className="border-sky-300 bg-gradient-to-br from-sky-50 to-mint-50">
          <p className="flex items-center gap-2 font-display text-lg">
            <Sparkles className="h-5 w-5 text-sky-600" /> Tu as adoré ?
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Tes {trials?.max} essais gratuits sont utilisés. Débloque ton accès
            Meeradraw pour créer des livres complets (jusqu&apos;à 24 pages) et
            recharger des crédits quand tu veux.
          </p>
          {STORE_URL ? (
            <a href={STORE_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block">
              <Button>Débloquer mon accès</Button>
            </a>
          ) : null}
        </Card>
      ) : null}

      {!valid && trials && trials.remaining > 0 ? (
        <Card className="border-mint-200 bg-mint-50/60">
          <p className="text-sm">
            <span className="font-semibold">
              Il te reste {trials.remaining} essai{trials.remaining > 1 ? "s" : ""} gratuit
              {trials.remaining > 1 ? "s" : ""}
            </span>{" "}
            ({trials.max_pages} pages max par livre) — tu peux créer sans accès
            pour découvrir Meeradraw.
          </p>
        </Card>
      ) : null}

      <Card className="space-y-3">
        <p className="text-sm text-ink-muted">Statut</p>
        {!status ? (
          <p className="text-sm">Vérification…</p>
        ) : !configured ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-yellow-800">Mode développement</p>
            <p className="text-ink-muted">
              {status.message ||
                "Vérification d'accès désactivée. Les générations sont autorisées en local."}
            </p>
            <Link href="/dashboard" className="inline-block">
              <Button size="sm" variant="secondary">
                Continuer vers le studio
              </Button>
            </Link>
          </div>
        ) : valid ? (
          <div className="space-y-1 text-sm">
            <p className="flex items-center gap-2 font-semibold text-mint-800">
              <CheckCircle2 className="h-5 w-5" /> Accès actif
            </p>
            {status.license?.product ? <p>Produit : {status.license.product}</p> : null}
            {status.license?.masked_key ? <p>Code : {status.license.masked_key}</p> : null}
            {status.license?.expires_at ? (
              <p>Expire : {new Date(status.license.expires_at).toLocaleDateString("fr-FR")}</p>
            ) : (
              <p>Durée : selon ton offre</p>
            )}
            <Link href="/dashboard" className="mt-2 inline-block">
              <Button size="sm" variant="secondary">
                Retour au studio
              </Button>
            </Link>
          </div>
        ) : (
          <p className="text-sm text-rose-700">
            {status.message || "Aucun accès actif. Entre ton code d'accès ci-dessous."}
          </p>
        )}
      </Card>

      <Card>
        <form onSubmit={activate} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold">Code d&apos;accès</label>
            <Input
              placeholder="ABC-123-XYZ-789"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              minLength={6}
              disabled={!configured}
            />
          </div>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading || !configured}>
            {loading
              ? "Déblocage…"
              : configured
                ? "Débloquer mon accès"
                : "Déblocage indisponible (API non configurée)"}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-400" />
            Vérification sécurisée. Ton code d&apos;accès n&apos;est jamais partagé.
          </p>
        </form>
      </Card>
    </div>
  );
}
