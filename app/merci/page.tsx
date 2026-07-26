"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeRechargeReturnPath } from "@/lib/recharge-return";
import { trackMetaEvent } from "@/components/analytics/meta-pixel";

type PurchaseState = "checking" | "confirmed" | "delayed" | "not_found";

function MerciContent() {
  const router = useRouter();
  const search = useSearchParams();
  const sale = search.get("sale") || search.get("sale_id");
  const returnTo = useMemo(
    () => safeRechargeReturnPath(search.get("return_to")),
    [search]
  );
  const [state, setState] = useState<PurchaseState>(sale ? "checking" : "not_found");
  const [credits, setCredits] = useState<number | null>(null);
  const purchaseTracked = useRef(false);

  useEffect(() => {
    if (!sale) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delays = [0, 1500, 2500, 4000, 6000, 8000, 10000];

    async function check(attempt: number) {
      try {
        const response = await fetch(
          `/api/credits/purchase-status?sale=${encodeURIComponent(sale!)}`,
          { cache: "no-store" }
        );
        const json = await response.json();
        if (!cancelled && response.ok && json.data?.state === "confirmed") {
          setCredits(json.data.credits);
          setState("confirmed");
          if (!purchaseTracked.current) {
            purchaseTracked.current = true;
            trackMetaEvent(
              "Purchase",
              {
                content_name: "Crédits MeeraDraw",
                content_ids: [`credits-${json.data.credits}`],
                content_type: "product",
                currency: "XOF",
              },
              { eventID: `chariow-${sale}` }
            );
          }
          if (returnTo) {
            timer = setTimeout(() => router.replace(returnTo), 2200);
          }
          return;
        }
        if (!cancelled && response.ok && json.data?.state === "not_found") {
          setState("not_found");
          return;
        }
      } catch {
        // A temporary network error uses the same bounded retry schedule.
      }

      const next = attempt + 1;
      if (!cancelled && next < delays.length) {
        timer = setTimeout(() => void check(next), delays[next]);
      } else if (!cancelled) {
        setState("delayed");
      }
    }

    void check(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [returnTo, router, sale]);

  const confirmed = state === "confirmed";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            confirmed ? "bg-mint-100 text-mint-700" : "bg-sky-100 text-sky-700"
          }`}
        >
          {confirmed ? (
            <CheckCircle2 className="h-8 w-8" />
          ) : (
            <LoaderCircle className="h-8 w-8 animate-spin" />
          )}
        </div>

        {confirmed ? (
          <>
            <h1 className="font-display text-3xl">Paiement confirmé ✨</h1>
            <p className="text-ink-muted">
              {credits
                ? `${credits} crédits ont été ajoutés à ton compte.`
                : "Tes crédits ont été ajoutés à ton compte."}
              {returnTo ? " Nous te ramenons à ton livre…" : ""}
            </p>
          </>
        ) : state === "not_found" ? (
          <>
            <h1 className="font-display text-3xl">Paiement introuvable</h1>
            <p className="text-ink-muted">
              Reviens depuis la page de paiement Chariow ou vérifie que tu es
              connecté au bon compte MeeraDraw.
            </p>
          </>
        ) : state === "delayed" ? (
          <>
            <h1 className="font-display text-3xl">Confirmation en cours</h1>
            <p className="text-ink-muted">
              Chariow met un peu plus de temps que prévu. Aucun nouveau paiement
              ne sera demandé : tes crédits apparaîtront dès la confirmation.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl">Nous confirmons ton paiement</h1>
            <p className="text-ink-muted">
              Reste sur cette page quelques instants. Tes crédits seront ajoutés
              automatiquement.
            </p>
          </>
        )}

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          {returnTo ? (
            <Button onClick={() => router.replace(returnTo)} disabled={!confirmed}>
              Reprendre mon livre
            </Button>
          ) : (
            <Link href="/create">
              <Button disabled={!confirmed}>Créer un livre</Button>
            </Link>
          )}
          <Link href="/credits">
            <Button variant="secondary">Voir mes crédits</Button>
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

export default function MerciPage() {
  return (
    <Suspense>
      <MerciContent />
    </Suspense>
  );
}
