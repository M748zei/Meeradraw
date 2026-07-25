"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GENERATION_TEAM } from "@/config/generation-steps";
import { RegeneratePageButton } from "@/components/books/regenerate-page-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { GenerationProgress } from "@/types/database";

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

    async function poll() {
      if (!active) return;
      try {
        const res = await fetch(`/api/generation/${generationId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message || "Erreur");
        if (active) setProgress(json.data);
        const st = json.data.status as string;
        if (st === "completed" || st === "failed" || st === "partial") {
          return;
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Erreur");
      }
      if (active) timer = setTimeout(poll, 1500);
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

  const step =
    GENERATION_TEAM.find((s) => s.id === progress?.current_step) ||
    GENERATION_TEAM[0];

  const done = progress?.status === "completed";
  const partial = progress?.status === "partial";
  const failed = progress?.status === "failed";
  const finished = done || partial;
  const parentFacingError = (() => {
    const raw = error || progress?.error_message || "";
    if (!raw) return null;
    if (/qualité\s*\d|\/100|alignement|lineup/i.test(raw)) {
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
              : "Votre livre prend vie…"}
        </h1>
        <p className="mt-2 text-ink-muted">
          {done
            ? "Votre cahier est prêt à imprimer."
            : partial
              ? "On finalise encore les dernières pages."
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
            <p className="text-sm text-ink-muted">{step.message}</p>
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
      </Card>

      {error || failed ? (
        <Card className="border-rose-200 bg-rose-50">
          <p className="font-semibold text-rose-700">
            Nous avons rencontré un petit problème.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {parentFacingError || "Essayons à nouveau."}
          </p>
          <Link href={`/books/${bookId}`} className="mt-4 inline-block">
            <Button variant="secondary">Retour au livre</Button>
          </Link>
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
