"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function NewUniversePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audienceAge, setAudienceAge] = useState("4-7 ans");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/universes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          audience_age: audienceAge,
          language: "fr",
        }),
      });
      const json = await res.json();
      if (!json.success) {
        // Demo fallback without backend auth
        if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
          router.push("/universes/demo");
          return;
        }
        throw new Error(json.error?.message || "Erreur");
      }
      // Universe alone is not a book — continue to the first book form with the idea prefilled.
      const idea = (description.trim() || title.trim()).slice(0, 4000);
      const qs = idea ? `?idea=${encodeURIComponent(idea)}` : "";
      router.push(`/universes/${json.data.id}/books/new${qs}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-3xl text-ink">Créer un univers</h1>
      <p className="mt-2 text-ink-muted">
        Un univers rassemble vos livres. À l&apos;étape suivante, nous transformerons votre idée
        en proposition créative (synopsis &amp; trame), puis vous lancerez la génération.
      </p>
      <Card className="mt-8">
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-semibold">Nom</label>
            <Input
              placeholder="Ex. L'histoire de Messi · Le renard cuisinier · Le baobab magique"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold">Votre idée</label>
            <Textarea
              placeholder="Ex. L'histoire de Messi pour les enfants… un renard chef… ou un petit héros près d'un baobab…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[120px]"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold">Tranche d&apos;âge</label>
            <Input
              value={audienceAge}
              onChange={(e) => setAudienceAge(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Création…" : "Continuer vers mon livre"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
