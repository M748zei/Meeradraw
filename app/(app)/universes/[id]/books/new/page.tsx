"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BOOK_TYPES, IDEA_EXAMPLES, PAGE_OPTIONS, STYLE_OPTIONS } from "@/config/book-types";
import { estimateBookCost } from "@/config/credits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCredits } from "@/lib/utils";
import { fetchWithTimeout } from "@/lib/async";
import { ChevronDown, ChevronUp, RefreshCw, Sparkles, Wallet } from "lucide-react";

type EnrichStatus = "idle" | "loading" | "ready" | "fallback" | "error";

type CreativeBrief = {
  title: string;
  synopsis: string;
  castHints: string[];
  beats: string[];
  creativeBrief: string;
};

function localFallbackBrief(rawIdea: string): CreativeBrief {
  const idea = rawIdea.trim();
  const title =
    idea.length > 48 ? `${idea.slice(0, 45).trim()}…` : idea || "Mon livre de coloriage";
  const synopsis = idea
    ? `Une aventure douce et courageuse inspirée de votre idée : ${idea}`
    : "Une aventure douce et courageuse pour enfants.";
  const beats = [
    "Le héros découvre un monde à explorer",
    "Un défi apparaît sur le chemin",
    "Un ami apporte son aide",
    "La résolution joyeuse et rassurante",
  ];
  const castHints = ["Le héros principal", "Un ami bienveillant"];
  return {
    title,
    synopsis,
    castHints,
    beats,
    creativeBrief: [
      `Titre : ${title}`,
      `Synopsis : ${synopsis}`,
      `Personnages : ${castHints.join(" · ")}`,
      `Trame : ${beats.join(" → ")}`,
      `Idée originale : ${idea}`,
    ].join("\n"),
  };
}

function buildCreativeBrief(parts: Omit<CreativeBrief, "creativeBrief">, originalIdea: string) {
  return [
    `Titre : ${parts.title.trim()}`,
    `Synopsis : ${parts.synopsis.trim()}`,
    parts.castHints.filter(Boolean).length
      ? `Personnages : ${parts.castHints.filter(Boolean).join(" · ")}`
      : "",
    parts.beats.filter(Boolean).length
      ? `Trame : ${parts.beats.filter(Boolean).join(" → ")}`
      : "",
    `Idée originale : ${originalIdea.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function NewBookForm() {
  const { id: universeId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillIdea = (searchParams.get("idea") ?? "").trim();

  const [originalIdea, setOriginalIdea] = useState(prefillIdea);
  const [showOriginal, setShowOriginal] = useState(false);
  const [manualMode, setManualMode] = useState(!prefillIdea);

  const [title, setTitle] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [castHints, setCastHints] = useState<string[]>([]);
  const [beats, setBeats] = useState<string[]>([]);

  const [enrichStatus, setEnrichStatus] = useState<EnrichStatus>(
    prefillIdea.length >= 3 ? "loading" : "idle"
  );
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);

  const [pageCount, setPageCount] = useState(12);
  const [style, setStyle] = useState("cute");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Trial mode: no active access but free trials remain → 6 pages max, 0 credit.
  const [trialMode, setTrialMode] = useState(false);
  const [trialsRemaining, setTrialsRemaining] = useState<number | null>(null);

  const cost = useMemo(() => estimateBookCost(pageCount, "colorbook"), [pageCount]);
  const insufficientCredits =
    !isAdmin &&
    !trialMode &&
    creditBalance !== null &&
    creditBalance < cost &&
    enrichStatus !== "loading";

  const briefReady =
    enrichStatus === "ready" || enrichStatus === "fallback" || (manualMode && synopsis.length >= 10);

  // Soft access gate for the generation UI only. Without access: free trials
  // remaining → trial mode (6 pages max, 0 crédit) ; épuisés → page Accès (CTA).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/license/status");
        const json = await res.json();
        if (cancelled || !json.success) return;
        const st = json.data as {
          required?: boolean;
          valid?: boolean;
          trials?: { remaining: number; max_pages: number };
        };
        if (st.required && !st.valid) {
          if ((st.trials?.remaining ?? 0) > 0) {
            setTrialMode(true);
            setTrialsRemaining(st.trials?.remaining ?? 0);
            setPageCount((n) => Math.min(n, st.trials?.max_pages ?? 6));
          } else {
            router.replace("/license");
          }
        }
      } catch {
        // Ignore — API generation still enforces FORBIDDEN.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Credit balance for cost clarity (badge in shell is also a link to /credits).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/credits");
        const json = await res.json();
        if (!cancelled && json.success) {
          setCreditBalance(typeof json.data.balance === "number" ? json.data.balance : 0);
          setIsAdmin(Boolean(json.data.is_admin));
        }
      } catch {
        // Non-blocking.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runEnrich(idea: string, opts?: { silent?: boolean }) {
    const raw = idea.trim();
    if (raw.length < 3) {
      setEnrichStatus("idle");
      return;
    }
    setEnrichStatus("loading");
    setEnrichMessage(null);
    setManualMode(false);
    try {
      const res = await fetchWithTimeout("/api/ai/enrich-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: raw }),
        timeoutMs: 22_000,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Enrichissement impossible");
      const data = json.data as CreativeBrief;
      setTitle(data.title || "");
      setSynopsis(data.synopsis || "");
      setCastHints(Array.isArray(data.castHints) ? data.castHints : []);
      setBeats(Array.isArray(data.beats) ? data.beats : []);
      setEnrichStatus("ready");
      setEnrichMessage(null);
    } catch {
      const fb = localFallbackBrief(raw);
      setTitle(fb.title);
      setSynopsis(fb.synopsis);
      setCastHints(fb.castHints);
      setBeats(fb.beats);
      setEnrichStatus("fallback");
      if (!opts?.silent) {
        setEnrichMessage(
          "La proposition IA n’a pas pu être générée à temps. Nous avons préparé une base à partir de votre idée — vous pouvez l’éditer."
        );
      }
    }
  }

  useEffect(() => {
    if (prefillIdea.length >= 3) {
      void runEnrich(prefillIdea);
    }
    // Only on mount / idea query change
  }, [prefillIdea]);

  function applyManualIdea(value: string) {
    setOriginalIdea(value);
    if (value.trim().length < 10) {
      setTitle("");
      setSynopsis("");
      setCastHints([]);
      setBeats([]);
      setEnrichStatus("idle");
      setManualMode(true);
      return;
    }
    setManualMode(true);
    setEnrichStatus("idle");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sourceIdea = originalIdea.trim() || synopsis.trim();
    if (sourceIdea.length < 10) {
      setError("Ajoutez une idée d’au moins 10 caractères.");
      return;
    }

    const parts = {
      title: title.trim() || "Nouveau livre",
      synopsis: synopsis.trim() || sourceIdea,
      castHints: castHints.map((c) => c.trim()).filter(Boolean),
      beats: beats.map((b) => b.trim()).filter(Boolean),
    };
    const creativeBrief = buildCreativeBrief(parts, sourceIdea);

    setLoading(true);
    setError(null);
    try {
      const createRes = await fetchWithTimeout("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe_id: universeId,
          idea: creativeBrief.slice(0, 4000),
          original_idea: sourceIdea.slice(0, 4000),
          enrichment: parts,
          title: parts.title.slice(0, 120),
          type: "colorbook",
          page_count: pageCount,
          style,
        }),
        timeoutMs: 30_000,
      });
      const createJson = await createRes.json();
      if (!createJson.success) throw new Error(createJson.error?.message || "Erreur");

      const bookId = createJson.data.id as string;
      const genRes = await fetchWithTimeout("/api/generation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
        timeoutMs: 30_000,
      });
      const genJson = await genRes.json();
      if (!genJson.success) {
        if (genJson.error?.code === "INSUFFICIENT_CREDITS") {
          router.push(`/credits?need=${cost}&book=${bookId}`);
          return;
        }
        if (genJson.error?.code === "FORBIDDEN" || genJson.error?.code === "TRIALS_EXHAUSTED") {
          router.push("/license");
          return;
        }
        throw new Error(genJson.error?.message || "Génération impossible");
      }

      router.push(`/books/${bookId}/generate?gid=${genJson.data.generation_id}`);
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? "Délai dépassé — vérifiez votre connexion et réessayez. Si le disque Mac est plein, libérez de l’espace."
          : err instanceof Error
            ? err.message
            : "Erreur";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !loading &&
    (synopsis.trim().length >= 10 || originalIdea.trim().length >= 10);

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-8">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-600">
          Étape 2 · Brief créatif
        </p>
        <h1 className="font-display text-3xl leading-tight md:text-4xl">
          Notre proposition créative
        </h1>
        <p className="max-w-2xl text-ink-muted">
          Vous avez validé votre idée. Nous l’avons transformée en synopsis et trame prêts à
          illustrer — affinez-les, choisissez le style, puis lancez la génération.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Original idea — secondary */}
        {originalIdea ? (
          <div className="rounded-3xl border border-cream-200/80 bg-cream-100/50">
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Idée de départ
                </p>
                {!showOriginal ? (
                  <p className="mt-1 line-clamp-1 text-sm text-ink">{originalIdea}</p>
                ) : null}
              </div>
              {showOriginal ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-ink-muted" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" />
              )}
            </button>
            {showOriginal ? (
              <div className="space-y-3 border-t border-cream-200/70 px-5 pb-5 pt-3">
                <Textarea
                  value={originalIdea}
                  onChange={(e) => setOriginalIdea(e.target.value)}
                  className="min-h-[96px] bg-white/80"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void runEnrich(originalIdea)}
                  disabled={enrichStatus === "loading" || originalIdea.trim().length < 3}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Régénérer la proposition
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <Card>
            <label className="mb-2 block font-display text-xl">Votre idée</label>
            <p className="mb-3 text-sm text-ink-muted">
              Pas d’idée préremplie — décrivez-la ici, puis nous proposerons un brief créatif.
            </p>
            <Textarea
              placeholder="Ex. Un renard chef, Messi pour les enfants, un baobab magique à Dakar…"
              value={originalIdea}
              onChange={(e) => applyManualIdea(e.target.value)}
              className="min-h-[120px]"
              minLength={10}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {IDEA_EXAMPLES.slice(0, 4).map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setOriginalIdea(ex);
                    void runEnrich(ex);
                  }}
                  className="rounded-full bg-cream-100 px-3 py-1.5 text-xs text-ink-muted transition hover:bg-sky-50 hover:text-sky-700"
                >
                  {ex}
                </button>
              ))}
            </div>
            {originalIdea.trim().length >= 10 && enrichStatus === "idle" ? (
              <Button
                type="button"
                className="mt-4"
                variant="secondary"
                onClick={() => void runEnrich(originalIdea)}
              >
                <Sparkles className="h-4 w-4" />
                Obtenir une proposition créative
              </Button>
            ) : null}
          </Card>
        )}

        {/* AI creative proposal — primary */}
        <Card className="relative overflow-hidden border-sky-200/70 bg-gradient-to-br from-white via-sky-50/40 to-lavender-100/30">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-600" />
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">
                  Notre proposition créative
                </p>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Titre, synopsis et trame — tout est éditable.
              </p>
            </div>
            {enrichStatus === "ready" ? (
              <span className="rounded-full bg-mint-100 px-3 py-1 text-xs font-semibold text-mint-800">
                Prêt à peaufiner
              </span>
            ) : null}
            {enrichStatus === "fallback" ? (
              <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-ink">
                Base de secours
              </span>
            ) : null}
          </div>

          {enrichStatus === "loading" ? (
            <div className="space-y-4" aria-live="polite" aria-busy="true">
              <div className="flex items-center gap-3 text-sm text-sky-700">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
                </span>
                Notre directeur créatif écrit votre brief…
              </div>
              <Skeleton className="h-11 w-3/4" />
              <Skeleton className="h-28 w-full" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-5/6" />
                <Skeleton className="h-9 w-4/5" />
              </div>
            </div>
          ) : briefReady ? (
            <div className="space-y-5">
              {enrichMessage ? (
                <p className="rounded-2xl bg-yellow-100/80 px-4 py-3 text-sm text-ink">
                  {enrichMessage}
                </p>
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-semibold">Titre proposé</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Titre du livre"
                  className="bg-white/90 font-display text-lg"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">Synopsis</label>
                <Textarea
                  value={synopsis}
                  onChange={(e) => setSynopsis(e.target.value)}
                  className="min-h-[140px] bg-white/90"
                  placeholder="Le cœur de l’histoire, en quelques phrases…"
                  required
                  minLength={10}
                />
              </div>

              {castHints.length > 0 ? (
                <div>
                  <label className="mb-2 block text-sm font-semibold">Personnages (indices)</label>
                  <div className="flex flex-wrap gap-2">
                    {castHints.map((hint, i) => (
                      <input
                        key={`cast-${i}`}
                        value={hint}
                        onChange={(e) => {
                          const next = [...castHints];
                          next[i] = e.target.value;
                          setCastHints(next);
                        }}
                        className="rounded-full border border-cream-200 bg-white/90 px-3 py-1.5 text-sm outline-none focus:border-sky-300"
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-semibold">Trame en {beats.length || 4} temps</label>
                <ol className="space-y-2">
                  {(beats.length ? beats : ["", "", "", ""]).map((beat, i) => (
                    <li key={`beat-${i}`} className="flex items-start gap-3">
                      <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                        {i + 1}
                      </span>
                      <Input
                        value={beat}
                        onChange={(e) => {
                          const next = [...(beats.length ? beats : ["", "", "", ""])];
                          next[i] = e.target.value;
                          setBeats(next);
                        }}
                        className="bg-white/90"
                        placeholder={`Temps ${i + 1}`}
                      />
                    </li>
                  ))}
                </ol>
              </div>

              {originalIdea ? (
                <button
                  type="button"
                  onClick={() => void runEnrich(originalIdea)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:text-sky-600"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Proposer une autre version
                </button>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-cream-300 bg-white/50 px-4 py-8 text-center text-sm text-ink-muted">
              {manualMode
                ? "Saisissez votre idée ci-dessus pour obtenir une proposition créative."
                : "En attente de votre idée…"}
            </div>
          )}
        </Card>

        {/* Book type — compact */}
        <Card className="py-5">
          <p className="mb-3 text-sm font-semibold text-ink-muted">Type de livre</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {BOOK_TYPES.filter((t) => t.available || t.id === "storybook").slice(0, 2).map((t) => (
              <div
                key={t.id}
                className={cn(
                  "rounded-2xl border p-4",
                  t.available
                    ? "border-sky-300 bg-sky-50"
                    : "border-cream-200 bg-cream-100 opacity-60"
                )}
              >
                <p className="font-semibold">{t.name}</p>
                <p className="mt-1 text-xs text-ink-muted">{t.description}</p>
                {!t.available ? (
                  <p className="mt-2 text-xs font-semibold text-sky-600">Bientôt</p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="mb-3 font-display text-xl">Style</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {STYLE_OPTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStyle(s.id)}
                className={cn(
                  "rounded-2xl border p-4 text-left transition",
                  style === s.id
                    ? "border-sky-400 bg-sky-50 shadow-soft"
                    : "border-cream-200 hover:border-sky-200"
                )}
              >
                <p className="font-semibold">{s.name}</p>
                <p className="mt-1 text-xs text-ink-muted">{s.description}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <p className="mb-3 font-display text-xl">Nombre de pages</p>
          {trialMode ? (
            <div className="mb-3 rounded-2xl border border-mint-200 bg-mint-50/70 px-4 py-3 text-sm">
              <span className="font-semibold">
                Il te reste {trialsRemaining ?? 0} essai{(trialsRemaining ?? 0) > 1 ? "s" : ""} gratuit
                {(trialsRemaining ?? 0) > 1 ? "s" : ""}
              </span>{" "}
              (6 pages max). Débloque ton accès pour créer des livres jusqu&apos;à 24 pages.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {PAGE_OPTIONS.map((n) => {
              const locked = trialMode && n > 6;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => !locked && setPageCount(n)}
                  disabled={locked}
                  title={locked ? "Les essais gratuits sont limités à 6 pages" : undefined}
                  className={cn(
                    "h-12 w-16 rounded-2xl border font-semibold transition",
                    pageCount === n
                      ? "border-sky-400 bg-sky-50 text-sky-700"
                      : "border-cream-200",
                    locked ? "cursor-not-allowed opacity-40" : ""
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sky-50/80 px-4 py-3">
            <div>
              <p className="text-sm text-ink-muted">Coût de cette génération</p>
              <p className="font-display text-2xl text-sky-700">
                {trialMode ? "Gratuit — essai" : `${cost} crédits`}
              </p>
            </div>
            {creditBalance !== null ? (
              <div className="text-right">
                <p className="flex items-center justify-end gap-1.5 text-sm text-ink-muted">
                  <Wallet className="h-3.5 w-3.5" />
                  Votre solde
                </p>
                <p
                  className={cn(
                    "font-semibold",
                    insufficientCredits ? "text-rose-700" : "text-ink"
                  )}
                >
                  {formatCredits(creditBalance)} crédits
                </p>
              </div>
            ) : null}
          </div>
          {insufficientCredits ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-100/60 px-4 py-3 text-sm text-rose-700">
              Solde insuffisant pour {pageCount} pages.{" "}
              <Link href={`/credits?need=${cost}`} className="font-semibold underline">
                Recharger des crédits
              </Link>{" "}
              pour lancer la génération.
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-muted">
              Conseil DA : pour un test qualité (personnages stables), commencez par{" "}
              <span className="font-semibold">6 ou 8 pages</span>.
            </p>
          )}
        </Card>

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        <div className="sticky bottom-20 z-10 md:static md:bottom-auto">
          <Button
            type="submit"
            size="lg"
            className="w-full shadow-lift"
            disabled={!canSubmit}
          >
            {loading
              ? "Préparation…"
              : trialMode
                ? "Créer mon livre d'essai · gratuit"
                : enrichStatus === "loading"
                  ? `Créer avec mon idée · ${cost} crédits`
                  : `Créer et générer mon livre · ${cost} crédits`}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewBookPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl py-12 text-ink-muted">Chargement…</div>}>
      <NewBookForm />
    </Suspense>
  );
}
