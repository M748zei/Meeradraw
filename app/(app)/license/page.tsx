"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type Status = {
  configured: boolean;
  required: boolean;
  valid?: boolean;
  license?: {
    product?: string | null;
    expires_at?: string | null;
    is_active?: boolean;
  } | null;
  message?: string;
  trials?: { used: number; max: number; remaining: number; max_pages: number };
};

const STORE_URL = process.env.NEXT_PUBLIC_CHARIOW_STORE_URL;

export default function AccessPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (showFeedback = false) => {
    setLoading(true);
    if (showFeedback) setNotice(null);
    try {
      const reconcile = await fetch("/api/access/reconcile", { method: "POST" });
      const reconcileJson = await reconcile.json().catch(() => null);

      const response = await fetch("/api/license/status", { cache: "no-store" });
      const json = await response.json();
      if (!json.success) {
        throw new Error(json.error?.message || "Vérification impossible");
      }
      setStatus(json.data);

      if (showFeedback) {
        if (json.data?.valid) {
          setNotice("Ton achat est bien rattaché à ce compte.");
        } else if (!reconcile.ok && reconcileJson?.error?.message) {
          setNotice(reconcileJson.error.message);
        } else {
          setNotice(
            "Aucun nouvel achat n’a encore été trouvé pour l’e-mail de ce compte."
          );
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Nous n’arrivons pas à vérifier ton achat pour le moment."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(false), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

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
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="font-display text-3xl">Mon accès Meeradraw</h1>
        <p className="mt-2 text-ink-muted">
          Ton achat est retrouvé grâce à l’adresse e-mail de ton compte. Aucun
          code d’accès n’est nécessaire.
        </p>
      </div>

      {trialsExhausted ? (
        <Card className="border-sky-300 bg-gradient-to-br from-sky-50 to-mint-50">
          <p className="flex items-center gap-2 font-display text-lg">
            <Sparkles className="h-5 w-5 text-sky-600" /> Tu as adoré ?
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Tes {trials?.max} essais gratuits sont utilisés. L’accès Meeradraw
            inclut 120 crédits, soit environ deux livres complets.
          </p>
          {STORE_URL ? (
            <a href={STORE_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block">
              <Button>Prendre mon accès</Button>
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
            ({trials.max_pages} pages max par livre).{" "}
            <Link href="/create" className="font-semibold text-sky-700 underline">
              Créer pour mon enfant
            </Link>
          </p>
        </Card>
      ) : null}

      <Card className="space-y-4">
        <p className="text-sm text-ink-muted">Statut</p>
        {!status ? (
          <p className="text-sm">Vérification automatique…</p>
        ) : !configured ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-yellow-800">Mode développement</p>
            <p className="text-ink-muted">
              {status.message || "La vérification d’accès est désactivée en local."}
            </p>
          </div>
        ) : valid ? (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-semibold text-mint-800">
              <CheckCircle2 className="h-5 w-5" /> Accès actif
            </p>
            {status.license?.product ? <p>Offre : {status.license.product}</p> : null}
            {status.license?.expires_at ? (
              <p>
                Valable jusqu’au{" "}
                {new Date(status.license.expires_at).toLocaleDateString("fr-FR")}
              </p>
            ) : null}
            <Link href="/create" className="inline-block pt-1">
              <Button size="sm">Créer pour mon enfant</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-rose-700">
              Aucun achat actif n’a encore été rattaché à l’e-mail de ce compte.
            </p>
            <p className="text-ink-muted">
              Si tu viens de payer, vérifie que tu utilises exactement le même
              e-mail que sur DigiAfrik, puis relance la vérification.
            </p>
          </div>
        )}

        {notice ? (
          <p className="rounded-xl bg-cream-50 px-3 py-2 text-sm text-ink-muted">
            {notice}
          </p>
        ) : null}

        {configured && !valid ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={loading}
            onClick={() => void refresh(true)}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Vérification…" : "Retrouver mon achat"}
          </Button>
        ) : null}
      </Card>

      {!valid && STORE_URL ? (
        <p className="text-center text-sm text-ink-muted">
          Pas encore d’accès ?{" "}
          <a
            href={STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-sky-700 underline"
          >
            Découvrir l’offre Meeradraw
          </a>
        </p>
      ) : null}

      <p className="flex items-center justify-center gap-1.5 text-xs text-ink-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-mint-500" />
        Rattachement sécurisé, limité à l’adresse e-mail vérifiée de l’achat.
      </p>
    </div>
  );
}
