"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Connexion Griot — un seul champ libre (l'email), tout le reste au doigt.
 * Google en un tap quand le provider est configuré côté Supabase ; sinon le
 * code par email (6 chiffres) fonctionne seul.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/studio";

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [etape, setEtape] = useState<"email" | "code">("email");
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyerCode() {
    setErreur(null);
    const adresse = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adresse)) {
      setErreur("Écris ton adresse email complète — exemple : awa@gmail.com");
      return;
    }
    setChargement(true);
    const { error } = await getSupabaseBrowser().auth.signInWithOtp({
      email: adresse,
      options: { shouldCreateUser: true },
    });
    setChargement(false);
    if (error) {
      setErreur("L'envoi du code a échoué. Attends une minute puis réessaie.");
      return;
    }
    setEtape("code");
  }

  async function verifierCode() {
    setErreur(null);
    const jeton = code.trim();
    if (!/^\d{6}$/.test(jeton)) {
      setErreur("Le code fait 6 chiffres — regarde dans ta boîte mail.");
      return;
    }
    setChargement(true);
    const { error } = await getSupabaseBrowser().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: jeton,
      type: "email",
    });
    setChargement(false);
    if (error) {
      setErreur("Code refusé ou expiré. Renvoie un code et réessaie.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function googleTap() {
    setErreur(null);
    setChargement(true);
    const { error } = await getSupabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setChargement(false);
      setErreur("Google n'est pas encore activé ici. Utilise le code par email juste en dessous.");
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <Card className="w-full max-w-sm">
        <p className="text-sm text-ink-muted">
          Connexion indisponible : configuration manquante. Réessaie plus tard.
        </p>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm space-y-4">
      <Button className="w-full" size="lg" onClick={googleTap} disabled={chargement}>
        Continuer avec Google
      </Button>
      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <span className="h-px flex-1 bg-cream-200" /> ou par email
        <span className="h-px flex-1 bg-cream-200" />
      </div>

      {etape === "email" ? (
        <div className="space-y-3">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Exemple : awa@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            className="w-full"
            variant="secondary"
            size="lg"
            onClick={envoyerCode}
            disabled={chargement}
          >
            {chargement ? "Envoi du code…" : "Recevoir mon code"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Un code à 6 chiffres vient d&apos;être envoyé à <strong>{email.trim()}</strong>.
          </p>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Exemple : 482913"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <Button className="w-full" size="lg" onClick={verifierCode} disabled={chargement}>
            {chargement ? "Vérification…" : "Entrer"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs font-semibold text-sky-600"
            onClick={() => {
              setEtape("email");
              setCode("");
            }}
          >
            Changer d&apos;adresse ou renvoyer un code
          </button>
        </div>
      )}

      {erreur ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{erreur}</p>
      ) : null}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Logo href="/" />
      <h1 className="text-center font-display text-2xl text-ink">
        Connecte-toi à Griot
      </h1>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
