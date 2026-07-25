"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AGE_BANDS,
  CHILD_GENDERS,
  PARENT_PAGE_OPTIONS,
  PARENT_PROMISE,
  PARENT_THEMES,
  getAgeBand,
  getParentTheme,
  isForbiddenParentTheme,
  resolveParentStyle,
  type ChildGenderId,
} from "@/config/parent-create";
import { estimateBookCost } from "@/config/credits";
import { fetchWithTimeout } from "@/lib/async";
import { cn, formatCredits } from "@/lib/utils";
import { Check, Sparkles, Upload } from "lucide-react";

export default function CreateForChildPage() {
  const router = useRouter();
  const [ageId, setAgeId] = useState<string>("6-8");
  const [themeId, setThemeId] = useState<string>("magic");
  const [childName, setChildName] = useState("");
  const [gender, setGender] = useState<ChildGenderId>("unspecified");
  const [parentStory, setParentStory] = useState("");
  const [pageCount, setPageCount] = useState(6);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const age = getAgeBand(ageId);
  const theme = getParentTheme(themeId);
  const style = resolveParentStyle(ageId, themeId);
  const cost = useMemo(() => estimateBookCost(pageCount), [pageCount]);

  const composedIdea = useMemo(() => {
    const name = childName.trim() || "Léo";
    const story = parentStory.trim();
    const themeHint = theme.ideaTemplate(name);
    if (story.length >= 20) {
      return `${name} : ${story} (ambiance / thème : ${theme.label}).`;
    }
    return themeHint;
  }, [theme, childName, parentStory]);

  async function onPhotoChange(file: File | null) {
    setPhotoPreview(null);
    setPhotoBase64(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      setError("Photo : JPG, PNG ou WebP uniquement.");
      return;
    }
    if (file.size > 5_000_000) {
      setError("Photo trop lourde (max 5 Mo).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setPhotoPreview(dataUrl);
      setPhotoBase64(dataUrl);
      setError(null);
    };
    reader.readAsDataURL(file);
  }

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
    const story = parentStory.trim();
    if (story.length < 20) {
      setError("Décrivez brièvement l’histoire (au moins 20 caractères).");
      return;
    }
    if (story.length > 500) {
      setError("Histoire un peu trop longue (max 500 caractères).");
      return;
    }
    const idea = composedIdea;
    const blocked = isForbiddenParentTheme(`${idea} ${theme.label} ${story}`);
    if (blocked) {
      setError(blocked);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let childPhotoUrl: string | undefined;
      if (photoBase64) {
        const upRes = await fetchWithTimeout("/api/child-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: photoBase64 }),
          timeoutMs: 45_000,
        });
        const upJson = await upRes.json();
        if (!upJson.success) {
          throw new Error(upJson.error?.message || "Upload de la photo impossible");
        }
        childPhotoUrl = upJson.data.url as string;
      }

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

      const genderLabel =
        gender === "girl" ? "fille" : gender === "boy" ? "garçon" : "enfant";
      const creativeBrief = [
        `Titre : L'aventure de ${name}`,
        `Synopsis : ${idea}`,
        `Personnages : ${name}, ${genderLabel}, héros principal`,
        `Idée originale : ${idea}`,
        `Histoire du parent : ${story}`,
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
          child_gender: gender,
          parent_story: story.slice(0, 2000),
          child_photo_url: childPhotoUrl,
          source: "parent_create",
          enrichment: {
            title: `L'aventure de ${name}`,
            synopsis: idea,
            castHints: [`${name}, ${genderLabel}, héros principal`],
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
          Contenu conçu pour l’âge choisi · sans violence · cahier complet prêt à
          imprimer.
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
          <label className="block text-sm font-semibold text-ink">Genre</label>
          <div className="grid grid-cols-3 gap-2">
            {CHILD_GENDERS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGender(g.id)}
                className={cn(
                  "rounded-2xl border px-3 py-3 text-sm font-medium transition",
                  gender === g.id
                    ? "border-sky-500 bg-sky-50 text-sky-900"
                    : "border-cream-200 bg-white text-ink-muted hover:border-sky-200"
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-ink">
            Votre histoire (en quelques phrases)
          </label>
          <textarea
            value={parentStory}
            onChange={(e) => setParentStory(e.target.value)}
            placeholder="Ex. Kai découvre qu’il peut faire briller les étoiles pour aider sa grand-mère au marché…"
            rows={4}
            maxLength={500}
            className="w-full rounded-2xl border border-cream-200 bg-white px-4 py-3 text-sm text-ink outline-none ring-sky-400 focus:ring-2"
          />
          <p className="text-xs text-ink-muted">{parentStory.trim().length}/500</p>
        </Card>

        <Card className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-ink">
            Photo de l’enfant{" "}
            <span className="font-normal text-ink-muted">(recommandée)</span>
          </label>
          <p className="text-xs text-ink-muted">
            Pour que le héros lui ressemble. Portrait clair, visage visible. Optionnel.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-cream-300 bg-cream-50/80 px-4 py-6 text-sm text-ink-muted transition hover:border-sky-300">
            <Upload className="h-5 w-5 text-sky-600" />
            <span>{photoPreview ? "Changer la photo" : "Ajouter une photo"}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void onPhotoChange(e.target.files?.[0] ?? null)}
            />
          </label>
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreview}
              alt="Aperçu"
              className="mx-auto h-28 w-28 rounded-2xl object-cover shadow-soft"
            />
          ) : null}
        </Card>

        <Card className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-ink">Thème (ambiance)</label>
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
            Coût estimé : {formatCredits(cost)} crédits · défaut recommandé : 6 pages
          </p>
        </Card>

        <Card className="space-y-2 border-sky-100 bg-sky-50/50 p-5">
          <div className="flex items-start gap-2 text-sm text-ink">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <p>
              <span className="font-semibold">Ce que nous allons raconter : </span>
              {composedIdea}
            </p>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-ink-muted">
            <li className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-mint-500" /> Adapté à {age.label}
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-mint-500" /> Visages doux, cahier complet
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
