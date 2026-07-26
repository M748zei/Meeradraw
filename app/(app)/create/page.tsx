"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
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

const ACCEPTED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const MAX_UPLOAD_DATA_BYTES = 2_800_000;
const MAX_SOURCE_PHOTO_BYTES = 12_000_000;

function isAcceptedPhotoFile(file: File): boolean {
  if (ACCEPTED_PHOTO_TYPES.has(file.type.toLowerCase())) return true;
  // Some mobile browsers leave type empty — fall back to extension.
  if (!file.type) {
    return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  }
  return false;
}

async function readPhotoAsDataUrl(file: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture impossible"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function compressPhotoForUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_DATA_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas indisponible");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Compression impossible"))),
      "image/jpeg",
      0.86
    );
  });
  if (blob.size > MAX_UPLOAD_DATA_BYTES) throw new Error("Photo encore trop lourde");
  return new File([blob], "photo-enfant.jpg", { type: "image/jpeg" });
}

export default function CreateForChildPage() {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [ageId, setAgeId] = useState<string>("6-8");
  const [themeId, setThemeId] = useState<string>("magic");
  const [childName, setChildName] = useState("");
  const [gender, setGender] = useState<ChildGenderId>("unspecified");
  const [parentStory, setParentStory] = useState("");
  const [pageCount, setPageCount] = useState(6);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const age = getAgeBand(ageId);
  const theme = getParentTheme(themeId);
  const style = resolveParentStyle(ageId, themeId);
  const cost = useMemo(() => estimateBookCost(pageCount), [pageCount]);

  const composedIdea = useMemo(() => {
    const name = childName.trim() || "Léo";
    const story = parentStory.trim();
    if (story.length >= 20) {
      const genderBit =
        gender === "girl"
          ? `${name} est une petite fille.`
          : gender === "boy"
            ? `${name} est un petit garçon.`
            : `${name} est un enfant.`;
      // Theme is visual ambiance only — NEVER rewrite the parent's plot.
      // Keep the parent's words first; do not append Africa/market idea templates.
      return `${genderBit} HISTOIRE DU PARENT (intrigue obligatoire, ne pas remplacer) : ${story}`;
    }
    return theme.ideaTemplate(name);
  }, [theme, childName, parentStory, gender]);

  async function onPhotoChange(file: File | null) {
    setPhotoPreview(null);
    setPhotoBase64(null);
    setPhotoError(null);
    if (!file) return;

    if (!isAcceptedPhotoFile(file)) {
      setPhotoError("Photo : JPG, PNG, WebP, HEIC ou HEIF uniquement.");
      return;
    }
    if (file.size > MAX_SOURCE_PHOTO_BYTES) {
      setPhotoError("Photo trop lourde (max 12 Mo).");
      return;
    }

    try {
      const mime = (file.type || "").toLowerCase();
      const isHeic =
        mime === "image/heic" ||
        mime === "image/heif" ||
        /\.(heic|heif)$/i.test(file.name);

      let prepared = file;
      if (!isHeic) {
        prepared = await compressPhotoForUpload(file);
      } else if (file.size > MAX_UPLOAD_DATA_BYTES) {
        setPhotoError(
          "Cette photo HEIC dépasse 2,8 Mo. Sur iPhone, choisissez « Le plus compatible » ou exportez-la en JPG."
        );
        return;
      }

      const dataUrl = await readPhotoAsDataUrl(prepared);
      if (!dataUrl.startsWith("data:image/")) throw new Error("Photo invalide");
      setPhotoPreview(dataUrl);
      setPhotoBase64(dataUrl);
      setPhotoError(null);
      setError(null);
    } catch {
      setPhotoError(
        "Impossible de préparer cette photo. Essayez un autre fichier ou exportez-la en JPG."
      );
    }
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
    setPhotoError(null);
    try {
      let childPhotoUrl: string | undefined;
      let childPhotoPath: string | undefined;
      if (photoBase64) {
        const upRes = await fetchWithTimeout("/api/child-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: photoBase64 }),
          timeoutMs: 45_000,
        });
        let upJson: {
          success?: boolean;
          data?: { url?: string; path?: string };
          error?: { message?: string; code?: string };
        };
        try {
          upJson = await upRes.json();
        } catch {
          const msg = "Upload de la photo impossible. Réessayez.";
          setPhotoError(msg);
          throw new Error(msg);
        }
        if (!upRes.ok || !upJson.success) {
          const code = upJson.error?.code;
          let msg = upJson.error?.message || "Upload de la photo impossible. Réessayez.";
          if (upRes.status === 401 || code === "UNAUTHORIZED") {
            msg = "Connectez-vous pour envoyer la photo de l’enfant.";
          } else if (upRes.status === 429 || code === "RATE_LIMITED") {
            msg = "Trop d’envois. Réessayez dans une minute.";
          } else if (upRes.status >= 500) {
            msg = "Le serveur n’a pas pu enregistrer la photo. Réessayez.";
          }
          setPhotoError(msg);
          throw new Error(msg);
        }
        childPhotoUrl = upJson.data?.url as string;
        childPhotoPath =
          typeof upJson.data?.path === "string" ? upJson.data.path : undefined;
        if (!childPhotoUrl) {
          const msg = "Upload de la photo incomplet. Réessayez.";
          setPhotoError(msg);
          throw new Error(msg);
        }
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
        `Histoire du parent (SOURCE NARRATIVE — seule intrigue autorisée) : ${story}`,
        `Personnages : ${name}, ${genderLabel} ENFANT, héros unique — pas de clones`,
        `Idée originale : ${idea}`,
        `Style graphique seulement (ne change PAS l'intrigue) : ${theme.label} / ${style}`,
        `Public : ${age.audience}`,
        age.promptHint,
        `RÈGLE : ${name} est un ENFANT ${genderLabel}, jamais un adulte ni le mauvais genre. L'histoire suit le texte du parent — INTERDIT de substituer un voyage/marché générique.`,
      ].join("\n");

      // Beats derived from the parent's story words — not generic market/travel fillers.
      const storyBeats = [
        `${name} vit l'histoire : ${story.slice(0, 80)}`,
        `${name} agit dans son monde`,
        `${name} surmonte un petit défi`,
        `${name} termine joyeusement son aventure`,
      ];

      const bookRes = await fetchWithTimeout("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe_id: universeId,
          // Keep creative brief for audit, but original_idea + parent_story drive planning.
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
          child_photo_path: childPhotoPath,
          source: "parent_create",
          enrichment: {
            title: `L'aventure de ${name}`,
            synopsis: idea,
            castHints: [`${name}, ${genderLabel}, héros principal unique`],
            beats: storyBeats,
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
          <div className="block text-sm font-semibold text-ink" id="child-age-label">
            Âge de l’enfant
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="child-age-label">
            {AGE_BANDS.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={ageId === a.id}
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
          <label htmlFor="child-name" className="block text-sm font-semibold text-ink">
            Prénom
          </label>
          <Input
            id="child-name"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="Ex. Kai"
            maxLength={40}
            autoComplete="off"
          />
          <div className="block text-sm font-semibold text-ink" id="child-gender-label">
            Genre
          </div>
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-labelledby="child-gender-label"
          >
            {CHILD_GENDERS.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={gender === g.id}
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
          <label htmlFor="parent-story" className="block text-sm font-semibold text-ink">
            Votre histoire (en quelques phrases)
          </label>
          <textarea
            id="parent-story"
            value={parentStory}
            onChange={(e) => setParentStory(e.target.value)}
            placeholder="Ex. Kai découvre qu’il peut faire briller les étoiles pour aider sa grand-mère au marché…"
            rows={4}
            maxLength={500}
            aria-describedby="parent-story-count"
            className="w-full rounded-2xl border border-cream-200 bg-white px-4 py-3 text-sm text-ink outline-none ring-sky-400 focus:ring-2"
          />
          <p id="parent-story-count" className="text-xs text-ink-muted">
            {parentStory.trim().length}/500
          </p>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="block text-sm font-semibold text-ink" id="child-photo-label">
            Photo de l’enfant{" "}
            <span className="font-normal text-ink-muted">(recommandée)</span>
          </div>
          <p className="text-xs text-ink-muted">
            Pour que le héros lui ressemble. Portrait clair, visage visible. JPG, PNG, WebP, HEIC ou HEIF · max 12 Mo. Optionnel.
          </p>
          <div data-testid="child-photo-dropzone">
            <input
              ref={photoInputRef}
              id="child-photo"
              name="child-photo"
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
              aria-labelledby="child-photo-label"
              data-testid="child-photo-input"
              className="sr-only"
              disabled={loading}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void onPhotoChange(file);
                // Reset after read so the same file can be chosen again.
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => photoInputRef.current?.click()}
              className="flex min-h-[7.5rem] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-cream-300 bg-cream-50/80 px-4 py-6 text-sm text-ink-muted transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-5 w-5 text-sky-600" />
              <span>{photoPreview ? "Changer la photo" : "Ajouter une photo"}</span>
            </button>
          </div>
          {photoError ? (
            <p className="text-sm text-rose-700" role="alert">
              {photoError}
            </p>
          ) : null}
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreview}
              alt="Aperçu de la photo sélectionnée"
              className="mx-auto h-28 w-28 rounded-2xl object-cover shadow-soft"
              data-testid="child-photo-preview"
            />
          ) : null}
        </Card>

        <Card className="space-y-4 p-5">
          <div className="block text-sm font-semibold text-ink" id="theme-label">
            Thème (ambiance)
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-labelledby="theme-label">
            {PARENT_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={themeId === t.id}
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
          <div className="block text-sm font-semibold text-ink" id="page-count-label">
            Nombre de pages
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="page-count-label">
            {PARENT_PAGE_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={pageCount === n}
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

        {error ? (
          <p className="text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Création en cours…" : "Générer le cahier"}
        </Button>

        <p className="text-center text-sm text-ink-muted">
          Préférez le studio avancé ?{" "}
          <Link href="/universes/new" className="font-medium text-sky-700 underline">
            Créer un univers
          </Link>
        </p>
      </form>
    </div>
  );
}
