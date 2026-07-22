import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HeroShowcase } from "@/components/landing/showcase";
import { PageGallery } from "@/components/landing/gallery";
import { Reveal } from "@/components/landing/reveal";
import {
  BookOpen,
  Check,
  Clock,
  Palette,
  Printer,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";

const STORE_URL = process.env.NEXT_PUBLIC_CHARIOW_STORE_URL;

const steps = [
  {
    icon: Wand2,
    title: "Racontez votre idée",
    text: "Un paragraphe suffit. Comme si vous la racontiez à un ami.",
  },
  {
    icon: Sparkles,
    title: "Nous créons le livre",
    text: "Histoire, personnages, illustrations et mise en page — tout est automatique.",
  },
  {
    icon: Printer,
    title: "Téléchargez & partagez",
    text: "Un PDF prêt à imprimer, en moins de cinq minutes.",
  },
];

const features = [
  {
    icon: Users,
    title: "Personnages cohérents",
    text: "Les mêmes visages, coiffures et tenues d'une page à l'autre. Comme un vrai livre.",
  },
  {
    icon: Palette,
    title: "Line art propre",
    text: "Traits nets, noir et blanc, sans gris ni remplissage. Parfait à colorier et à imprimer.",
  },
  {
    icon: BookOpen,
    title: "Niveau librairie",
    text: "Une vraie progression narrative, une couverture, une variété de scènes. Prêt pour Amazon KDP.",
  },
  {
    icon: Clock,
    title: "En quelques minutes",
    text: "De l'idée au PDF fini en moins de cinq minutes. Sans prompt, sans logiciel compliqué.",
  },
];

const accessSteps = [
  {
    title: "Prenez votre accès",
    text: "L'accès Meeradraw se prend sur la boutique DigiAfrik — paiement Mobile Money ou carte.",
  },
  {
    title: "Connectez-vous ici",
    text: "Créez votre compte Meeradraw (ou reconnectez-vous).",
  },
  {
    title: "Débloquez votre studio",
    text: "Entrez le code d'accès reçu par e-mail sur la page Accès — le studio se débloque aussitôt.",
  },
];

const examples = [
  "Un petit renard chef cuisinier",
  "Une tortue astronaute",
  "Un robot qui apprend les émotions",
  "Aventure style Kirikou au village",
  "Baobab magique au marché de Dakar",
  "Foot de rue à Abidjan",
];

function PrimaryCta({ label }: { label: string }) {
  return STORE_URL ? (
    <a href={STORE_URL} target="_blank" rel="noreferrer">
      <Button size="lg">{label}</Button>
    </a>
  ) : (
    <Link href="/signup">
      <Button size="lg">{label}</Button>
    </Link>
  );
}

export default function LandingPage() {
  const primaryHref = STORE_URL || "/signup";

  return (
    <div className="overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-ink-muted hover:text-ink">
            Connexion
          </Link>
          <Link href="/signup">
            <Button size="sm" variant="secondary">
              Créer un compte
            </Button>
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative mx-auto max-w-6xl px-4 pb-16 pt-8 md:pt-14">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_20%,rgba(125,200,240,0.35),transparent_50%),radial-gradient(circle_at_80%_10%,rgba(203,184,240,0.3),transparent_45%)]" />
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-cream-200 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 shadow-soft">
              <Sparkles className="h-3.5 w-3.5" /> Studio de livres de coloriage
            </span>
            <h1 className="max-w-xl font-display text-4xl leading-[1.08] text-ink md:text-6xl">
              Racontez votre idée.
              <br />
              <span className="bg-gradient-to-r from-sky-600 to-mint-400 bg-clip-text text-transparent">
                Nous créons votre livre.
              </span>
            </h1>
            <p className="mt-6 max-w-lg text-lg text-ink-muted">
              Transformez une simple histoire en livre de coloriage professionnel —
              cohérent, magnifique, prêt à imprimer. Sans prompt. Sans complexité.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryCta label={STORE_URL ? "Prendre mon accès" : "Ouvrir le studio"} />
              <Link href={STORE_URL ? "/login?next=/license" : "#how"}>
                <Button size="lg" variant="secondary">
                  {STORE_URL ? "J’ai déjà mon accès" : "Voir comment ça marche"}
                </Button>
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-mint-400" /> PDF prêt à imprimer
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-mint-400" /> Personnages cohérents
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-mint-400" /> En moins de 5 min
              </span>
            </div>
          </div>
          <HeroShowcase />
        </div>
      </section>

      {/* GALLERY — real generated proof */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <Reveal>
          <div className="mb-8 text-center">
            <h2 className="font-display text-3xl text-ink">De vraies pages, générées par Meeradraw</h2>
            <p className="mx-auto mt-2 max-w-xl text-ink-muted">
              « Aïcha et le renard des sables au marché » — un livre entier créé à partir
              d&apos;une seule phrase. Voici quelques pages.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <PageGallery />
        </Reveal>
      </section>

      {/* FEATURES */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <Reveal>
          <h2 className="text-center font-display text-3xl text-ink">
            Pourquoi c&apos;est différent
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-ink-muted">
            La plupart des outils crachent des images sans lien. Meeradraw crée un vrai livre.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.title} delay={i * 0.08}>
                <Card className="h-full">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-mint-100 text-sky-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-display text-lg text-ink">{f.title}</h3>
                  <p className="mt-2 text-sm text-ink-muted">{f.text}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-6xl px-4 py-16">
        <Reveal>
          <h2 className="font-display text-3xl text-ink">Comment ça marche</h2>
          <p className="mt-2 text-ink-muted">Trois étapes. Aucune compétence requise.</p>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal key={step.title} delay={i * 0.1}>
                <Card className="h-full">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-sky-600">
                    Étape {i + 1}
                  </div>
                  <h3 className="font-display text-xl">{step.title}</h3>
                  <p className="mt-2 text-sm text-ink-muted">{step.text}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>

        {/* Idea chips */}
        <Reveal delay={0.2}>
          <div className="mt-10 rounded-3xl border border-cream-200 bg-white/60 p-6">
            <p className="text-sm font-semibold text-ink">Des idées ? En voici quelques-unes :</p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {examples.map((ex) => (
                <span
                  key={ex}
                  className="rounded-full border border-cream-200 bg-cream-50 px-4 py-2 text-sm text-ink-muted"
                >
                  {ex}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ACCESS via Chariow */}
      <section id="access" className="mx-auto max-w-6xl px-4 py-16">
        <Reveal>
          <div className="rounded-[2rem] border border-cream-200 bg-gradient-to-br from-sky-50 via-white to-lavender-100 p-8 md:p-12">
            <h2 className="font-display text-3xl text-ink">Comment accéder</h2>
            <p className="mt-2 max-w-2xl text-ink-muted">
              Le paiement est géré par la boutique DigiAfrik. Meeradraw est le studio que vous
              utilisez après l&apos;achat — et vous pouvez l&apos;essayer gratuitement.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {accessSteps.map((step, i) => (
                <div key={step.title} className="rounded-2xl bg-white/70 p-5">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-mint-100 font-bold text-mint-800">
                    {i + 1}
                  </div>
                  <h3 className="font-display text-lg">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-ink-muted">{step.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryCta label={STORE_URL ? "Prendre mon accès" : "Créer un compte"} />
              <Link href="/login?next=/license">
                <Button variant="ghost">Se connecter &amp; débloquer</Button>
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <Reveal>
          <Card className="overflow-hidden bg-gradient-to-br from-sky-500 to-mint-400 p-0 text-white">
            <div className="flex flex-col items-center gap-4 px-8 py-14 text-center">
              <h2 className="max-w-2xl font-display text-3xl md:text-4xl">
                Votre première idée est déjà un livre.
              </h2>
              <p className="max-w-xl text-white/90">
                Le livre de coloriage est le premier module de Meeradraw. Demain : histoires
                illustrées, cahiers d&apos;activités, et bien plus.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {STORE_URL ? (
                  <a href={STORE_URL} target="_blank" rel="noreferrer">
                    <Button size="lg" variant="secondary">
                      Prendre mon accès
                    </Button>
                  </a>
                ) : (
                  <Link href="/signup">
                    <Button size="lg" variant="secondary">
                      Ouvrir le studio
                    </Button>
                  </Link>
                )}
                <Link href={primaryHref === "/signup" ? "/login" : "/login?next=/license"}>
                  <Button
                    size="lg"
                    className="border border-white/40 bg-white/10 text-white hover:bg-white/20"
                  >
                    J’ai déjà un compte
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </Reveal>
      </section>

      <footer className="border-t border-cream-200 py-10 text-center text-sm text-ink-muted">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4">
          <Logo />
          <p>© {new Date().getFullYear()} Meeradraw — Créez avec émotion.</p>
        </div>
      </footer>
    </div>
  );
}
