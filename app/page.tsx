import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/landing/reveal";
import { Clock, Copy, ShieldCheck, Sparkles } from "lucide-react";

const HUB_STORE_URL = process.env.NEXT_PUBLIC_HUB_STORE_URL;

const etapes = [
  {
    icon: Sparkles,
    titre: "Décris ta scène",
    texte: "« Un homme marche vers la banque, la nuit, sous la pluie ». Une phrase, une année, un lieu.",
  },
  {
    icon: Clock,
    titre: "Choisis le style",
    texte: "Six presets relevés sur les vrais visuels de la page — nuit d'archive, heure dorée, affiche…",
  },
  {
    icon: Copy,
    titre: "Ajoute le texte, publie",
    texte: "Titre incrusté proprement (jamais généré), téléchargement direct, prêt pour Facebook et TikTok.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
        <Logo />
        <Link href="/login" prefetch={false}>
          <Button size="sm" variant="secondary">Se connecter</Button>
        </Link>
      </header>

      <section className="mx-auto max-w-2xl px-4 pb-10 pt-8 text-center">
        <Reveal>
          <h1 className="font-display text-3xl leading-tight text-ink md:text-4xl">
            Les visuels du Scarabée Noir —
            <span className="text-amber-600"> peints pour tes reels</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-ink-muted">
            Décris ta scène en une phrase. Le studio la peint dans le style de la
            page : clair-obscur, huile cinématographique, époque respectée.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Link href="/login" prefetch={false}>
              <Button size="lg">Peindre ma première scène</Button>
          </Link>
            <p className="text-xs text-ink-muted">
              Dès 2 crédits par image — tes crédits DigiAfrik marchent ici aussi.
            </p>
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-2xl px-4 pb-12">
        <div className="grid gap-3">
          {etapes.map((e, i) => (
            <Reveal key={e.titre} delay={i * 0.08}>
              <Card className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <e.icon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-ink">{e.titre}</h2>
                  <p className="mt-0.5 text-sm text-ink-muted">{e.texte}</p>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.2}>
          <Card className="mt-6 flex items-start gap-3 border-amber-200 bg-amber-50">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <p className="text-sm text-amber-900">
              Le style n&apos;est pas un réglage : la recette des visuels qui marchent
              (lumière unique, plan large, étalonnage sarcelle et ambre) est
              encodée dans les presets. Tu ne verras jamais un prompt.
            </p>
          </Card>
        </Reveal>

        {HUB_STORE_URL ? (
          <p className="mt-8 text-center text-sm text-ink-muted">
            Besoin de crédits ?{" "}
            <a href={HUB_STORE_URL} className="font-semibold text-amber-700 underline">
              Recharge sur DigiAfrik
            </a>{" "}
            — Mobile Money ou carte, prix en FCFA.
          </p>
        ) : null}
      </section>
    </main>
  );
}
