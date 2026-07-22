"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
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
  const generationId = search.get("gid");
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!generationId) return;
    let active = true;

    async function poll() {
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
      if (active) setTimeout(poll, 1500);
    }

    poll();
    return () => {
      active = false;
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

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="text-center">
        <h1 className="font-display text-3xl md:text-4xl">
          {done
            ? "Votre livre est prêt ✦"
            : partial
              ? "Livre presque prêt"
              : "Votre livre prend vie…"}
        </h1>
        <p className="mt-2 text-ink-muted">
          {done
            ? "Une équipe virtuelle a travaillé pour vous."
            : partial
              ? "Certaines pages n’ont pas d’illustration — régénérez-les ci-dessous."
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
            {error || progress?.error_message || "Essayons à nouveau."}
          </p>
          <Link href={`/books/${bookId}`} className="mt-4 inline-block">
            <Button variant="secondary">Retour au livre</Button>
          </Link>
        </Card>
      ) : null}

      {partial && progress?.error_message ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-ink">{progress.error_message}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold text-ink-muted">Couverture</p>
          {progress?.cover_image ? (
            <motion.img
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              src={progress.cover_image}
              alt="Couverture"
              className="aspect-[3/4] w-full rounded-2xl object-cover shadow-lift"
            />
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
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-cream-100">
                      {page.illustration_url ? (
                        <Image
                          src={page.illustration_url}
                          alt=""
                          width={160}
                          height={160}
                          className="h-full w-full object-cover"
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
