"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AGE_BANDS,
  PARENT_PAGE_OPTIONS,
  PARENT_PROMISE,
  PARENT_THEMES,
  getAgeBand,
  getParentTheme,
  isForbiddenParentTheme,
  resolveParentStyle,
} from "@/config/parent-create";
import { estimateBookCost } from "@/config/credits";
import { fetchWithTimeout } from "@/lib/async";
import { cn, formatCredits } from "@/lib/utils";
import { Check, Sparkles } from "lucide-react";

export default function CreateForChildPage() {
  const router = useRouter();
  const [ageId, setAgeId] = useState<string>("6-8");
  const [themeId, setThemeId] = useState<string>("magic");
  const [childName, setChildName] = useState("");
  const [pageCount, setPageCount] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const age = getAgeBand(ageId);
  const theme = getParentTheme(themeId);
  const style = resolveParentStyle(ageId, themeId);
  const cost = useMemo(() => estimateBookCost(pageCount), [pageCount]);

  const previewIdea = useMemo(() => {
    const name = childName.trim() || "Léo";
    return theme.ideaTemplate(name);
  }, [theme, childName]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = childName.trim();
    if (name.length < 2) {
      setError("Indiquez le prénom de l’enfant (au moins 2 lettres).");
      return;
    }
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\- ]{1,39}$/.test(name)) {
      setError("Prénom invalide — lettres uniquement.");
      return;
    }
    const idea = theme.ideaTemplate(name);
    const blocked = isForbiddenParentTheme(`${idea} ${theme.label}`);
    if (blocked) {
      setError(blocked);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const uniRes = await fetchWithTimeout("/api/universes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Cahier de ${name}`,
          description: `${theme.label} · ${age.label}`,
          audience_age: age.label,
        }),
        timeoutMs: 20_000,
      });
      const uniJson = await uniRes.json();
      if (!uniJson.success) {
        throw new Error(uniJson.error?.message || "Impossible de créer l’univers");
      }
      const universeId = uniJson.data.id as string;

      const creativeBrief = [
        `Titre : L'aventure de ${name}`,
        `Synopsis : ${idea}`,
        `Personnages : ${name}, héros principal`,
        `Idée originale : ${idea}`,
        `Public : ${age.audience}`,
        age.promptHint,
      ].join("\n");

      const bookRes = await fetchWithTimeout("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe_id: universeId,
          idea: creativeBrief.slice(0, 4000),
          original_idea: idea.slice(0, 4000),
          title: `L'aventure de ${name}`.slice(0, 120),
          type: "colorbook",
          page_count: pageCount,
          style: style,
          audience: age.audience,
          audience_age: age.label,
          child_name: name,
          enrichment: {
            title: `L'aventure de ${name}`,
            synopsis: idea,
            castHints: [`${name}, héros principal`],
            beats: [
              `${name} découvre son monde`,
              "Un défi apparaît",
              "Un ami aide",
              "Résolution joyeuse",
            ],
          },
        }),
        timeoutMs: 20_000,
      });
      const bookJson = await bookRes.json();
      if (!bookJson.success) {
        throw new Error(bookJson.error?.message || "Impossible de créer le livre");
      }
      const bookId = bookJson.data.id as string;

      const genRes = await fetchWithTimeout("/api/generation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
        timeoutMs: 30_000,
      });
      const genJson = await genRes.json();
      if (!genJson.success) {
        throw new Error(genJson.error?.message || "Génération impossible");
      }
      const gid = genJson.data?.generation_id || genJson.data?.id;
      router.push(
        gid ? `/books/${bookId}/generate?gid=${gid}` : `/books/${bookId}/generate`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-700">
          Créer pour mon enfant
        </p>
        <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
          {PARENT_PROMISE}
        </h1>
        <p className="mt-3 text-ink-muted">
          Contenu conçu pour l’âge choisi · sans violence · PDF prêt à imprimer en un clic
          après génération.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-ink">Âge de l’enfant</label>
          <div className="grid grid-cols-3 gap-2">
            {AGE_BANDS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setAgeId(a.id);
                  setPageCount(a.defaultPages);
                }}
                className={cn(
                  "rounded-2xl border px-3 py-3 text-sm font-medium transition",
                  ageId === a.id
                    ? "border-sky-500 bg-sky-50 text-sky-900"
                    : "border-cream-200 bg-white text-ink-muted hover:border-sky-200"
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted">{age.promptHint}</p>
        </Card>

        <Card className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-ink">Prénom</label>
          <Input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="Ex. Kai"
            maxLength={40}
            autoComplete="off"
          />
        </Card>

        <Card className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-ink">Thème</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PARENT_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeId(t.id)}
                className={cn(
                  "rounded-2xl border px-3 py-3 text-left text-sm font-medium transition",
                  themeId === t.id
                    ? "border-sky-500 bg-sky-50 text-sky-900"
                    : "border-cream-200 bg-white text-ink-muted hover:border-sky-200"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-ink">Nombre de pages</label>
          <div className="flex flex-wrap gap-2">
            {PARENT_PAGE_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPageCount(n)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold",
                  pageCount === n
                    ? "border-sky-500 bg-sky-50 text-sky-900"
                    : "border-cream-200 text-ink-muted"
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-sm text-ink-muted">
            Coût estimé : {formatCredits(cost)} crédits
          </p>
        </Card>

        <Card className="space-y-2 border-sky-100 bg-sky-50/50 p-5">
          <div className="flex items-start gap-2 text-sm text-ink">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <p>
              <span className="font-semibold">Aperçu de l’idée : </span>
              {previewIdea}
            </p>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-ink-muted">
            <li className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-mint-500" /> Adapté à {age.label}
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-mint-500" /> Thèmes interdits filtrés
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-mint-500" /> PDF 1 clic après génération
            </li>
          </ul>
        </Card>

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Création en cours…" : "Générer le cahier"}
        </Button>

        <p className="text-center text-sm text-ink-muted">
          Preferez le studio avancé ?{" "}
          <Link href="/universes/new" className="font-medium text-sky-700 underline">
            Créer un univers
          </Link>
        </p>
      </form>
    </div>
  );
}
