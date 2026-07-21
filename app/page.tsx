import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const STORE_URL = process.env.NEXT_PUBLIC_CHARIOW_STORE_URL;

const steps = [
  {
    title: "Racontez votre idée",
    text: "Un paragraphe suffit. Comme si vous la racontiez à un ami.",
  },
  {
    title: "Nous créons le livre",
    text: "Histoire, personnages, illustrations et mise en page — tout est automatique.",
  },
  {
    title: "Téléchargez & partagez",
    text: "Un PDF prêt à imprimer, en moins de cinq minutes.",
  },
];

const accessSteps = [
  {
    title: "Achetez sur Chariow",
    text: "La licence se vend sur la marketplace Chariow — paiement et e-mail inclus.",
  },
  {
    title: "Connectez-vous ici",
    text: "Créez votre compte Meeradraw (ou reconnectez-vous).",
  },
  {
    title: "Activez votre clé",
    text: "Entrez la licence reçue par e-mail sur la page Licence pour débloquer le studio.",
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

export default function LandingPage() {
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

      <section className="relative mx-auto max-w-6xl px-4 pb-20 pt-10 md:pt-16">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_20%,rgba(125,200,240,0.35),transparent_50%),radial-gradient(circle_at_80%_10%,rgba(203,184,240,0.3),transparent_45%)]" />
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-sky-600">
          Meeradraw
        </p>
        <h1 className="max-w-3xl font-display text-4xl leading-[1.1] text-ink md:text-6xl">
          Racontez votre idée.
          <br />
          <span className="bg-gradient-to-r from-sky-600 to-mint-400 bg-clip-text text-transparent">
            Nous créons votre livre.
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-ink-muted">
          Transformez une simple histoire en livre de coloriage professionnel —
          cohérent, magnifique, prêt à imprimer. Sans prompt. Sans complexité.
        </p>
        <p className="mt-3 max-w-xl text-sm text-ink-muted">
          Accès par licence Chariow : achetez sur la marketplace, connectez-vous,
          puis activez votre clé dans le studio.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {STORE_URL ? (
            <a href={STORE_URL} target="_blank" rel="noreferrer">
              <Button size="lg">Acheter sur Chariow</Button>
            </a>
          ) : (
            <Link href="/signup">
              <Button size="lg">Ouvrir le studio</Button>
            </Link>
          )}
          <Link href={STORE_URL ? "/login?next=/license" : "#access"}>
            <Button size="lg" variant="secondary">
              {STORE_URL ? "J’ai déjà ma licence" : "Comment accéder"}
            </Button>
          </Link>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {examples.map((ex) => (
            <Card key={ex} className="bg-white/70">
              <p className="text-sm text-ink-muted">Exemple</p>
              <p className="mt-2 font-display text-lg text-ink">{ex}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="access" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-3xl text-ink">Comment accéder</h2>
        <p className="mt-2 text-ink-muted">
          Chariow vend la licence. Meeradraw est le logiciel après l&apos;achat.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {accessSteps.map((step, i) => (
            <Card key={step.title}>
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-mint-100 font-bold text-mint-800">
                {i + 1}
              </div>
              <h3 className="font-display text-xl">{step.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{step.text}</p>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          {STORE_URL ? (
            <a href={STORE_URL} target="_blank" rel="noreferrer">
              <Button>Acheter sur Chariow</Button>
            </a>
          ) : null}
          <Link href="/signup">
            <Button variant={STORE_URL ? "secondary" : "primary"}>Créer un compte</Button>
          </Link>
          <Link href="/login?next=/license">
            <Button variant="ghost">Se connecter &amp; activer</Button>
          </Link>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-3xl text-ink">Comment ça marche</h2>
        <p className="mt-2 text-ink-muted">Trois étapes. Aucune compétence requise.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <Card key={step.title}>
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 font-bold text-sky-700">
                {i + 1}
              </div>
              <h3 className="font-display text-xl">{step.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{step.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <Card className="overflow-hidden bg-gradient-to-br from-sky-50 via-white to-lavender-100 p-0">
          <div className="grid md:grid-cols-2">
            <div className="p-8 md:p-12">
              <h2 className="font-display text-3xl text-ink">Votre studio créatif</h2>
              <p className="mt-3 text-ink-muted">
                Le livre de coloriage est le premier module de Meeradraw. Demain :
                histoires illustrées, cahiers d&apos;activités, et bien plus.
              </p>
              <Link href="/login?next=/license" className="mt-6 inline-block">
                <Button>Se connecter &amp; activer ma licence</Button>
              </Link>
            </div>
            <div className="flex items-center justify-center bg-gradient-to-br from-mint-100 to-sky-100 p-12">
              <div className="aspect-[3/4] w-48 rotate-3 rounded-2xl bg-white shadow-lift" />
            </div>
          </div>
        </Card>
      </section>

      <footer className="border-t border-cream-200 py-10 text-center text-sm text-ink-muted">
        © {new Date().getFullYear()} Meeradraw — Créez avec émotion.
      </footer>
    </div>
  );
}
