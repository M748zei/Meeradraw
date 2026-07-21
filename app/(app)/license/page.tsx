"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";

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
};

const STORE_URL = process.env.NEXT_PUBLIC_CHARIOW_STORE_URL;

export default function LicensePage() {
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
      if (!json.success) throw new Error(json.error?.message || "Activation impossible");
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

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-mint-100 text-sky-700">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="font-display text-3xl">Licence Chariow</h1>
        <p className="mt-2 text-ink-muted">
          Meeradraw se vend sur Chariow. Après votre achat, entrez ici la clé
          reçue par e-mail pour débloquer le studio.
        </p>
        {STORE_URL ? (
          <p className="mt-2 text-sm">
            Pas encore de licence ?{" "}
            <a
              href={STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-sky-700 underline"
            >
              Acheter sur Chariow
            </a>
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            Lien boutique : configurez{" "}
            <code className="text-xs">NEXT_PUBLIC_CHARIOW_STORE_URL</code> pour
            afficher le bouton d&apos;achat.
          </p>
        )}
      </div>

      <Card className="space-y-3">
        <p className="text-sm text-ink-muted">Statut</p>
        {!status ? (
          <p className="text-sm">Vérification…</p>
        ) : !configured ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-yellow-800">Mode développement</p>
            <p className="text-ink-muted">
              {status.message ||
                "Vérification Chariow désactivée (pas de CHARIOW_API_KEY). Les générations sont autorisées en local."}
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
              <CheckCircle2 className="h-5 w-5" /> Licence active
            </p>
            {status.license?.product ? <p>Produit : {status.license.product}</p> : null}
            {status.license?.masked_key ? <p>Clé : {status.license.masked_key}</p> : null}
            {status.license?.expires_at ? (
              <p>Expire : {new Date(status.license.expires_at).toLocaleDateString("fr-FR")}</p>
            ) : (
              <p>Durée : selon votre offre Chariow</p>
            )}
            <Link href="/dashboard" className="mt-2 inline-block">
              <Button size="sm" variant="secondary">
                Retour au studio
              </Button>
            </Link>
          </div>
        ) : (
          <p className="text-sm text-rose-700">
            {status.message ||
              "Aucune licence active. Activez votre clé Chariow ci-dessous."}
          </p>
        )}
      </Card>

      <Card>
        <form onSubmit={activate} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold">Clé de licence</label>
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
              ? "Activation…"
              : configured
                ? "Activer ma licence"
                : "Activation indisponible (API non configurée)"}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-400" />
            Vérification sécurisée auprès de Chariow. Votre clé n&apos;est jamais partagée.
          </p>
        </form>
      </Card>
    </div>
  );
}
