"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Connexion MeeraDraw — un seul champ libre (l'email), tout le reste au doigt.
 * Un code recopié à la main plutôt qu'un lien magique : Gmail et les antispam
 * ouvrent les liens des emails avant l'utilisateur, et un jeton à usage unique
 * est alors déjà consommé au moment du clic.
 *
 * ── POURQUOI on n'utilise PAS signInWithOtp / verifyOtp du SDK ──────────────
 * `createBrowserClient` de @supabase/ssr force `flowType: 'pkce'` — la valeur
 * est écrite EN DUR, après le spread des options, donc impossible à
 * surcharger. En mode PKCE le SDK ajoute un `code_challenge` à la demande de
 * code, et le serveur range alors le jeton préfixé `pkce_…` en base. La
 * vérification d'un code recopié compare, elle, un hachage SANS préfixe : ça
 * ne peut jamais correspondre → 403 « Code refusé ou expiré » systématique
 * (cassé en prod le 2026-08-06, preuve en base : token_hash `pkce_7b8ce50…`).
 *
 * On parle donc à l'API GoTrue en direct (POST /auth/v1/otp puis
 * /auth/v1/verify, sans code_challenge) — correctif éprouvé en production sur
 * le hub digiafrik — puis on rend la session au SDK avec `auth.setSession()`,
 * qui écrit le cookie que lisent le proxy et les pages serveur.
 * NE PAS « simplifier » en revenant au SDK : le bug reviendrait une 3e fois.
 */
const AUTH = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const ENTETES = {
  apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
  "content-type": "application/json",
};
const DUREE_RENVOI = 45; // secondes avant de pouvoir redemander un code

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/studio";

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [etape, setEtape] = useState<"email" | "code">("email");
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [compteARebours, setCompteARebours] = useState(0);
  const champCode = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (compteARebours <= 0) return;
    const t = setTimeout(() => setCompteARebours((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [compteARebours]);

  useEffect(() => {
    if (etape === "code") champCode.current?.focus();
  }, [etape]);

  async function envoyerCode() {
    setErreur(null);
    const adresse = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adresse)) {
      setErreur("Écris ton adresse email complète — exemple : awa@gmail.com");
      return;
    }
    setChargement(true);
    // Appel DIRECT (pas signInWithOtp) : voir le commentaire d'en-tête.
    let statut = 0;
    try {
      const r = await fetch(`${AUTH}/otp`, {
        method: "POST",
        headers: ENTETES,
        body: JSON.stringify({ email: adresse, create_user: true }),
      });
      statut = r.status;
    } catch {
      statut = 0;
    }
    setChargement(false);
    if (statut !== 200) {
      setErreur(
        statut === 429
          ? "Trop de demandes coup sur coup. Attends une minute et réessaie."
          : "L'envoi du code a échoué. Vérifie ton adresse et réessaie."
      );
      return;
    }
    setEtape("code");
    setCompteARebours(DUREE_RENVOI);
  }

  async function verifierCode() {
    setErreur(null);
    const jeton = code.trim();
    if (!/^\d{6}$/.test(jeton)) {
      setErreur("Le code fait 6 chiffres — regarde dans ta boîte mail.");
      return;
    }
    setChargement(true);

    // Selon l'état du compte, le serveur range le code à deux endroits
    // différents (compte tout neuf → jeton de confirmation ; compte déjà
    // confirmé → jeton de reconnexion). Le type 'email' couvre les deux, mais
    // on garde les autres en secours : un mauvais type renvoie « jeton
    // invalide » sans rien consommer, donc essayer ne coûte rien.
    let session: { access_token: string; refresh_token: string } | null = null;
    for (const type of ["email", "magiclink", "signup"] as const) {
      try {
        const r = await fetch(`${AUTH}/verify`, {
          method: "POST",
          headers: ENTETES,
          body: JSON.stringify({ type, email: email.trim().toLowerCase(), token: jeton }),
        });
        if (!r.ok) continue;
        const donnees = await r.json();
        if (donnees?.access_token && donnees?.refresh_token) {
          session = {
            access_token: donnees.access_token,
            refresh_token: donnees.refresh_token,
          };
          break;
        }
      } catch {
        /* réseau : on tente le type suivant, puis on affiche l'erreur */
      }
    }

    // On rend la session au SDK : c'est lui qui écrit le cookie lu par le
    // proxy, les pages serveur et les routes API.
    if (session) {
      const { error } = await getSupabaseBrowser().auth.setSession(session);
      if (error) session = null;
    }

    setChargement(false);
    if (!session) {
      setCode("");
      setErreur(
        "Ce code ne correspond pas, ou il a expiré. Vérifie le code du dernier email reçu, ou demande-en un nouveau."
      );
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
            Tu peux lire l&apos;email sur ton téléphone et taper le code ici.
          </p>
          <Input
            ref={champCode}
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
          <p className="text-center text-xs text-ink-muted">
            {compteARebours > 0 ? (
              <>Pas reçu ? Tu pourras en redemander un dans {compteARebours} s.</>
            ) : (
              <button
                type="button"
                className="font-semibold text-sky-600"
                onClick={() => {
                  if (!chargement) void envoyerCode();
                }}
              >
                Renvoyer un code
              </button>
            )}
            {" · "}
            <button
              type="button"
              className="font-semibold text-sky-600"
              onClick={() => {
                setEtape("email");
                setCode("");
                setErreur(null);
              }}
            >
              Changer d&apos;adresse
            </button>
          </p>
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
        Connecte-toi à MeeraDraw
      </h1>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
