"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GENERATION_TEAM } from "@/config/generation-steps";
import { RegeneratePageButton } from "@/components/books/regenerate-page-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { GenerationProgress } from "@/types/database";

function formatDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min} min ${sec.toString().padStart(2, "0")} s` : `${sec} s`;
}

function GenerateInner() {
  const { id: bookId } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const gidParam = search.get("gid");
  const [resolvedGid, setResolvedGid] = useState<string | null>(null);
  const generationId = gidParam || resolvedGid;
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(!gidParam);
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);

  // Resolve missing gid from the book / latest active generation.
  useEffect(() => {
    if (gidParam) return;
    let active = true;
    async function resolveGid() {
      try {
        const res = await fetch(`/api/books/${bookId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message || "Livre introuvable");
        const activeId =
          typeof json.data?.active_generation_id === "string"
            ? json.data.active_generation_id
            : null;
        if (!active) return;
        if (activeId) {
          setResolvedGid(activeId);
          router.replace(`/books/${bookId}/generate?gid=${activeId}`);
        } else {
          setError(
            "Aucune génération en cours pour ce livre. Relance la création depuis le studio."
          );
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Erreur");
        }
      } finally {
        if (active) setResolving(false);
      }
    }
    void resolveGid();
    return () => {
      active = false;
    };
  }, [bookId, gidParam, router]);

  useEffect(() => {
    if (!generationId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollCount = 0;
    let consecutiveErrors = 0;

    function nextDelay() {
      if (typeof document !== "undefined" && document.hidden) return 15_000;
      if (consecutiveErrors > 0) {
        return Math.min(15_000, 2_000 * 2 ** Math.min(consecutiveErrors, 3));
      }
      if (pollCount < 10) return 2_000;
      if (pollCount < 30) return 4_000;
      return 8_000;
    }

    async function poll() {
      if (!active) return;
      try {
        const res = await fetch(`/api/generation/${generationId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message || "Erreur");
        if (active) {
          setProgress(json.data);
          setError(null);
        }
        pollCount += 1;
        consecutiveErrors = 0;
        const st = json.data.status as string;
        if (st === "completed" || st === "failed" || st === "partial") {
          return;
        }
      } catch (err) {
        consecutiveErrors += 1;
        if (active) setError(err instanceof Error ? err.message : "Erreur");
      }
      if (active) timer = setTimeout(poll, nextDelay());
    }

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [generationId]);

  async function refreshProgress() {
    if (!generationId) return;
    try {
      const res = await fetch(`/api/generation/${generationId}`);
      const json = await res.json();
      if (json.success) setProgress(json.data);
    } catch {
      // ignore
    }
  }

  async function retryGeneration(opts: {
    requireFreeRetry: boolean;
    confirmPaid?: boolean;
  }) {
    if (retryLock.current) return;
    const recreateCost =
      typeof progress?.recreate_cost === "number" &&
      Number.isFinite(progress.recreate_cost)
        ? progress.recreate_cost
        : null;
    if (!opts.requireFreeRetry && opts.confirmPaid) {
      if (recreateCost == null) {
        setError(
          "Le coût de recréation est indisponible. Actualise la page puis réessaie."
        );
        return;
      }
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Recréer ce livre va réserver ${recreateCost} crédits. Continuer ?`
        )
      ) {
        return;
      }
    }
    retryLock.current = true;
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch("/api/generation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          ...(opts.requireFreeRetry
            ? { require_free_retry: true }
            : recreateCost != null
              ? { expected_cost: recreateCost }
              : {}),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        if (res.status === 409) {
          throw new Error(
            json.error?.message ||
              (opts.requireFreeRetry
                ? "La tentative gratuite n’est plus disponible. Recrée le livre avec des crédits."
                : "Le coût de recréation a changé. Actualise la page puis réessaie.")
          );
        }
        throw new Error(json.error?.message || "Impossible de recommencer");
      }
      const nextId = json.data?.generation_id || json.data?.id;
      if (!nextId) throw new Error("Identifiant de génération manquant");
      router.replace(`/books/${bookId}/generate?gid=${nextId}`);
      setResolvedGid(nextId);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      retryLock.current = false;
    } finally {
      setRetrying(false);
    }
  }

  const freeRetryAvailable = progress?.free_retry_available === true;
  const paidRecreateCredits =
    typeof progress?.recreate_cost === "number" &&
    Number.isFinite(progress.recreate_cost)
      ? progress.recreate_cost
      : null;

  const step =
    GENERATION_TEAM.find((s) => s.id === progress?.current_step) ||
    GENERATION_TEAM[0];

  const done = progress?.status === "completed";
  const partial = progress?.status === "partial";
  const failed = progress?.status === "failed";
  const finished = done || partial;
  const inFlight = !done && !partial && !failed && Boolean(progress);
  const parentFacingError = (() => {
    const raw = error || progress?.error_message || "";
    if (!raw) return null;
    if (failed) {
      const support = progress?.support_id
        ? ` Identifiant support : ${progress.support_id}.`
        : "";
      return `La création n’a pas pu être finalisée. Aucun livre incomplet ne sera livré. Vos crédits ont été libérés (remboursement automatique).${support}`;
    }
    if (/qualité\s*\d+\s*\/\s*100|score\s*[:=]?\s*\d+/i.test(raw) && raw.length < 220) {
      return "On termine encore quelques pages pour vous offrir un cahier complet.";
    }
    return raw;
  })();

  if (resolving) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="text-center">
        <h1 className="font-display text-3xl md:text-4xl">
          {done
            ? "Votre livre est prêt ✦"
            : partial
              ? "Presque terminé…"
              : failed
                ? "Création interrompue"
                : "Votre livre prend vie…"}
        </h1>
        <p className="mt-2 text-ink-muted">
          {done
            ? "Votre cahier est prêt à imprimer."
            : partial
              ? "On finalise encore les dernières pages."
              : failed
                ? freeRetryAvailable
                  ? "Vous pouvez recommencer sans frais — une seule tentative gratuite est disponible."
                  : "Vous pouvez recréer le livre avec des crédits, ou retourner au livre."
                : "Regardez votre histoire se construire page après page."}
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-cream-200 bg-gradient-to-r from-sky-50 to-lavender-100 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-xl shadow-soft">
            ✦
          </div>
          <div>
            <p className="font-semibold">{step.role}</p>
            <p className="text-sm text-ink-muted">
              {progress?.current_substep
                ? `${step.message} · ${progress.current_substep}`
                : step.message}
            </p>
          </div>
          <div className="ml-auto font-display text-2xl text-sky-700">
            {progress?.progress ?? 0}%
          </div>
        </div>
        <div className="h-2 bg-cream-100">
          <motion.div
            className="h-full bg-gradient-to-r from-sky-400 to-mint-400"
            animate={{ width: `${progress?.progress ?? 0}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        {inFlight ? (
          <div className="space-y-1 border-t border-cream-200 bg-cream-50/80 px-5 py-3 text-sm text-ink-muted">
            <p>
              Temps écoulé : {formatDuration(progress?.elapsed_ms)} · estimation :{" "}
              {formatDuration(progress?.estimated_total_ms)} · pages terminées :{" "}
              {progress?.pages_done ?? 0}/{progress?.pages_total ?? "—"}
            </p>
            <p>
              Vous pouvez quitter cette page, la génération continue côté serveur.
            </p>
            {progress?.credits_state === "reserved" ? (
              <p>
                {progress.credits_reserved ?? 0} crédits sont seulement réservés —
                le débit définitif n’a lieu qu’à la livraison complète.
              </p>
            ) : null}
            {progress?.taking_longer ? (
              <p className="text-amber-800">
                Cette étape prend plus de temps que prévu — on continue.
              </p>
            ) : null}
            <Link href="/library" className="inline-block text-sky-700 underline">
              Voir ma bibliothèque
            </Link>
          </div>
        ) : null}
      </Card>

      {error || failed ? (
        <Card className="border-rose-200 bg-rose-50">
          <p className="font-semibold text-rose-700">
            Nous avons rencontré un petit problème.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {parentFacingError || "Essayons à nouveau."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {freeRetryAvailable ? (
              <Button
                variant="secondary"
                disabled={retrying}
                onClick={() =>
                  void retryGeneration({ requireFreeRetry: true })
                }
              >
                {retrying ? "Relance…" : "Recommencer sans frais"}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={retrying || paidRecreateCredits == null}
                onClick={() =>
                  void retryGeneration({
                    requireFreeRetry: false,
                    confirmPaid: true,
                  })
                }
              >
                {retrying
                  ? "Relance…"
                  : paidRecreateCredits == null
                    ? "Recréer le livre"
                    : `Recréer le livre — ${paidRecreateCredits} crédits`}
              </Button>
            )}
            <Link href={`/books/${bookId}`}>
              <Button variant="ghost">Retour au livre</Button>
            </Link>
            <Link href="/library">
              <Button variant="ghost">Bibliothèque</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {partial && parentFacingError ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-ink">{parentFacingError}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold text-ink-muted">Couverture</p>
          {progress?.cover_image ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl shadow-lift"
            >
              <Image
                src={progress.cover_image}
                alt="Couverture"
                fill
                className="object-cover"
                sizes="240px"
              />
            </motion.div>
          ) : (
            <Skeleton className="aspect-[3/4] w-full" />
          )}
        </Card>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink-muted">Pages</p>
          <AnimatePresence>
            {(progress?.pages || []).map((page) => {
              const missing =
                !page.illustration_url || page.generation_status === "failed";
              return (
                <motion.div
                  key={page.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card className="flex gap-4 p-3">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-cream-100">
                      {page.illustration_url ? (
                        <Image
                          src={page.illustration_url}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                      ) : (
                        <Skeleton className="h-full w-full rounded-xl" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <p className="text-xs text-ink-muted">Page {page.page_number}</p>
                        <p className="font-semibold">{page.title || "…"}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                          {page.story_text}
                        </p>
                      </div>
                      {finished && missing ? (
                        <RegeneratePageButton
                          bookId={bookId}
                          pageId={page.id}
                          onSuccess={() => void refreshProgress()}
                        />
                      ) : null}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!progress?.pages?.length ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}
        </div>
      </div>

      {finished ? (
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/books/${bookId}`}>
            <Button size="lg">Voir mon livre</Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default function GeneratePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <GenerateInner />
    </Suspense>
  );
}
