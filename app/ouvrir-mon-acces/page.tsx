"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SUPPORT_EMAIL } from "@/config/support";
import { getClientAuth, isFirebaseConfigured } from "@/lib/firebase/client";

type VerifyReady = {
  state: "ready";
  saleId: string;
  emailMasked: string;
  emailPrefill: string;
  accountExists: boolean;
  unlocksAccess: boolean;
  credits: number | null;
  packName: string | null;
};

type VerifyOther =
  | { state: "missing_sale" }
  | { state: "pending_payment"; saleId: string }
  | { state: "invalid_product" }
  | { state: "refunded" }
  | { state: "already_other_account"; emailMasked: string }
  | { state: "already_attached"; redirectTo: string }
  | { state: "unavailable" }
  | { state: "not_configured" };

type Screen =
  | "loading"
  | "new_buyer"
  | "returning"
  | "awaiting_email"
  | "success"
  | "error";

async function establishSession() {
  const auth = getClientAuth();
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error("Session impossible");
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Session impossible");
}

async function attachAccess(saleId: string) {
  const res = await fetch("/api/access/attach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sale: saleId }),
  });
  const json = await res.json();
  if (!json.success) {
    const err = new Error(json.error?.message || "Impossible d’ouvrir l’accès") as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    err.code = json.error?.code;
    err.details = json.error?.details;
    throw err;
  }
  return json.data as { redirectTo?: string; duplicate?: boolean };
}

function SoftShapes() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-16 top-10 h-40 w-40 rounded-full bg-sky-100/80 blur-2xl" />
      <div className="absolute -right-10 top-24 h-36 w-36 rounded-full bg-mint-100/90 blur-2xl" />
      <div className="absolute bottom-10 left-1/3 h-28 w-28 rounded-full bg-yellow-100/70 blur-2xl" />
      <span className="absolute left-6 top-28 text-2xl opacity-40">🎨</span>
      <span className="absolute right-8 top-40 text-xl opacity-40">✨</span>
      <span className="absolute bottom-28 left-10 text-xl opacity-35">📖</span>
    </div>
  );
}

function OpenAccessFlow() {
  const router = useRouter();
  const search = useSearchParams();
  const saleParam = search.get("sale") || search.get("sale_id");
  const [screen, setScreen] = useState<Screen>("loading");
  const [ready, setReady] = useState<VerifyReady | null>(null);
  const [errorTitle, setErrorTitle] = useState("");
  const [errorText, setErrorText] = useState("");
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [password, setPassword] = useState("");
  const [fullname, setFullname] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const retryRef = useRef(0);
  const verifiedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function verify(attempt = 0) {
      if (!cancelled) {
        setScreen("loading");
      }
      try {
        const res = await fetch("/api/access/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sale: saleParam }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message || "Vérification impossible");
        const data = json.data as VerifyReady | VerifyOther;
        if (cancelled) return;

        if (data.state === "already_attached") {
          router.replace(data.redirectTo || "/create");
          return;
        }
        if (data.state === "ready") {
          verifiedOnce.current = true;
          setReady(data);
          setMode(data.accountExists ? "login" : "signup");
          setScreen(data.accountExists ? "returning" : "new_buyer");
          return;
        }
        if (data.state === "pending_payment") {
          if (attempt < 5) {
            retryRef.current = attempt + 1;
            window.setTimeout(() => verify(attempt + 1), 2000 * (attempt + 1));
            setErrorTitle("Votre paiement est en cours de confirmation");
            setErrorText(
              "Cela peut prendre quelques instants. Cette page va réessayer automatiquement."
            );
            setScreen("error");
            return;
          }
          setErrorTitle("Votre paiement est en cours de confirmation");
          setErrorText(
            "Cela peut prendre quelques instants. Revenez via le lien de votre e-mail d’achat."
          );
          setScreen("error");
          return;
        }
        if (data.state === "missing_sale") {
          setErrorTitle("Nous n’avons pas retrouvé votre achat");
          setErrorText(
            "Ouvrez le lien reçu dans votre e-mail après le paiement ou contactez notre équipe."
          );
          setScreen("error");
          return;
        }
        if (data.state === "refunded") {
          setErrorTitle("Cet achat n’est plus actif");
          setErrorText(
            `S’il s’agit d’un remboursement ou d’une annulation, écrivez-nous à ${SUPPORT_EMAIL}.`
          );
          setScreen("error");
          return;
        }
        if (data.state === "already_other_account") {
          setErrorTitle("Achat déjà associé à un compte");
          setErrorText(
            `Connectez-vous avec ${data.emailMasked}, ou contactez ${SUPPORT_EMAIL}.`
          );
          setScreen("error");
          return;
        }
        if (data.state === "invalid_product") {
          setErrorTitle("Nous n’avons pas retrouvé votre achat");
          setErrorText(
            "Ouvrez le lien reçu dans votre e-mail après le paiement ou contactez notre équipe."
          );
          setScreen("error");
          return;
        }
        setErrorTitle("Confirmation en cours");
        setErrorText(
          "Nous n’arrivons pas encore à confirmer votre achat. Réessayez dans quelques instants. Aucun nouveau paiement ne vous sera demandé."
        );
        setScreen("error");
      } catch {
        if (cancelled) return;
        setErrorTitle("Confirmation en cours");
        setErrorText(
          "Nous n’arrivons pas encore à confirmer votre achat. Réessayez dans quelques instants. Aucun nouveau paiement ne vous sera demandé."
        );
        setScreen("error");
      }
    }
    void verify(0);
    return () => {
      cancelled = true;
    };
  }, [saleParam, router]);

  useEffect(() => {
    if (screen !== "success") return;
    const t = window.setTimeout(() => {
      router.push("/create");
      router.refresh();
    }, 3500);
    return () => window.clearTimeout(t);
  }, [screen, router]);

  async function finishAttach(saleId: string) {
    const data = await attachAccess(saleId);
    setScreen("success");
    if (data.redirectTo) {
      /* success screen handles CTA + auto redirect */
    }
  }

  async function onGoogle() {
    if (!ready) return;
    setBusy(true);
    setFormError(null);
    try {
      if (!isFirebaseConfigured()) {
        setFormError("Connexion indisponible pour le moment.");
        return;
      }
      const cred = await signInWithPopup(getClientAuth(), new GoogleAuthProvider());
      const googleEmail = (cred.user.email || "").toLowerCase();
      if (googleEmail !== ready.emailPrefill.toLowerCase()) {
        await getClientAuth().signOut().catch(() => undefined);
        setFormError(
          `Pour protéger votre achat, connectez-vous avec l’adresse utilisée lors du paiement : ${ready.emailMasked}.`
        );
        return;
      }
      await establishSession();
      await finishAttach(ready.saleId);
    } catch (err) {
      const e = err as Error & { details?: { email_mismatch?: boolean } };
      setFormError(e.message || "Connexion Google impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setFormError(null);
    try {
      if (!isFirebaseConfigured()) {
        setFormError("Connexion indisponible pour le moment.");
        return;
      }
      const auth = getClientAuth();
      const email = ready.emailPrefill;
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (fullname.trim()) {
          await updateProfile(cred.user, { displayName: fullname.trim() });
        }
        const continueUrl = `${window.location.origin}/ouvrir-mon-acces?sale=${encodeURIComponent(ready.saleId)}`;
        await sendEmailVerification(cred.user, { url: continueUrl }).catch(() => undefined);
        await establishSession();
        try {
          await finishAttach(ready.saleId);
        } catch (attachErr) {
          const ae = attachErr as Error & { details?: { email_unverified?: boolean } };
          if (ae.details?.email_unverified || /Confirmez votre adresse/i.test(ae.message)) {
            setScreen("awaiting_email");
            return;
          }
          throw attachErr;
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        await establishSession();
        try {
          await finishAttach(ready.saleId);
        } catch (attachErr) {
          const ae = attachErr as Error & { details?: { email_unverified?: boolean } };
          if (ae.details?.email_unverified || /Confirmez votre adresse/i.test(ae.message)) {
            const user = auth.currentUser;
            if (user && !user.emailVerified) {
              const continueUrl = `${window.location.origin}/ouvrir-mon-acces?sale=${encodeURIComponent(ready.saleId)}`;
              await sendEmailVerification(user, { url: continueUrl }).catch(() => undefined);
            }
            setScreen("awaiting_email");
            return;
          }
          throw attachErr;
        }
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  async function recheckVerified() {
    if (!ready) return;
    setBusy(true);
    setFormError(null);
    try {
      const auth = getClientAuth();
      await auth.currentUser?.reload();
      await establishSession();
      await finishAttach(ready.saleId);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "E-mail pas encore confirmé — ouvrez le lien reçu puis réessayez."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <SoftShapes />
      <Logo className="relative z-10 mb-8" href="/" />

      <div className="relative z-10 w-full max-w-md">
        {screen === "loading" ? (
          <section className="rounded-3xl bg-white/90 p-7 shadow-soft backdrop-blur sm:p-8">
            <p className="text-center text-sm font-semibold text-mint-800">Achat confirmé ✓</p>
            <h1 className="mt-3 text-center font-display text-3xl leading-tight text-ink">
              🎉 Votre achat est confirmé !
            </h1>
            <p className="mt-3 text-center text-sm leading-relaxed text-ink-muted">
              Plus qu&apos;une petite étape pour ouvrir votre espace Meeradraw et commencer à créer
              des livres magiques pour votre enfant.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
              <p className="text-sm font-medium text-sky-700">Nous préparons votre espace…</p>
            </div>
          </section>
        ) : null}

        {screen === "new_buyer" && ready ? (
          <section className="rounded-3xl bg-white/95 p-6 shadow-soft backdrop-blur sm:p-8">
            <span className="inline-flex rounded-full bg-mint-100 px-3 py-1 text-xs font-semibold text-mint-800">
              Achat confirmé ✓
            </span>
            <h1 className="mt-4 font-display text-3xl leading-tight text-ink">
              Créez votre compte pour commencer 🎨
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Utilisez la même adresse e-mail que lors de votre achat. Votre accès sera ajouté
              automatiquement.
            </p>
            {ready.packName || ready.credits ? (
              <p className="mt-3 text-sm text-ink">
                {ready.packName ? <span className="font-semibold">{ready.packName}</span> : null}
                {ready.credits ? (
                  <span className="text-ink-muted">
                    {" "}
                    · {ready.credits} crédits inclus
                  </span>
                ) : null}
              </p>
            ) : null}

            <Button
              type="button"
              variant="secondary"
              className="mt-6 h-12 w-full text-base"
              onClick={onGoogle}
              disabled={busy}
            >
              Continuer avec Google
            </Button>

            <div className="my-5 flex items-center gap-3 text-xs text-ink-muted">
              <div className="h-px flex-1 bg-cream-200" />
              ou avec un mot de passe
              <div className="h-px flex-1 bg-cream-200" />
            </div>

            <form onSubmit={onPasswordSubmit} className="space-y-3">
              <Input
                type="text"
                placeholder="Prénom"
                value={fullname}
                onChange={(e) => setFullname(e.target.value)}
                autoComplete="given-name"
                className="h-12 text-base"
              />
              <Input
                type="email"
                value={ready.emailPrefill}
                readOnly
                className="h-12 bg-cream-100 text-base"
                aria-label="E-mail de l’achat"
              />
              <Input
                type="password"
                placeholder="Mot de passe (6+ caractères)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
                className="h-12 text-base"
              />
              {formError ? <p className="text-sm text-rose-700">{formError}</p> : null}
              <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
                {busy ? "Ouverture…" : "Ouvrir mon espace Meeradraw"}
              </Button>
            </form>

            <button
              type="button"
              className="mt-5 w-full text-center text-sm font-semibold text-sky-700"
              onClick={() => {
                setMode("login");
                setScreen("returning");
                setFormError(null);
              }}
            >
              J&apos;ai déjà un compte
            </button>
          </section>
        ) : null}

        {screen === "returning" && ready ? (
          <section className="rounded-3xl bg-white/95 p-6 shadow-soft backdrop-blur sm:p-8">
            <span className="inline-flex rounded-full bg-mint-100 px-3 py-1 text-xs font-semibold text-mint-800">
              Votre achat a bien été retrouvé
            </span>
            <h1 className="mt-4 font-display text-3xl leading-tight text-ink">Bon retour 👋</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Connectez-vous pour ajouter automatiquement votre nouvel achat à votre espace
              Meeradraw.
            </p>
            <p className="mt-3 text-sm text-ink">
              Compte : <span className="font-semibold">{ready.emailMasked}</span>
            </p>

            <Button
              type="button"
              variant="secondary"
              className="mt-6 h-12 w-full text-base"
              onClick={onGoogle}
              disabled={busy}
            >
              Continuer avec Google
            </Button>

            <form onSubmit={onPasswordSubmit} className="mt-5 space-y-3">
              <Input
                type="email"
                value={ready.emailPrefill}
                readOnly
                className="h-12 bg-cream-100 text-base"
              />
              <Input
                type="password"
                placeholder="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-12 text-base"
              />
              {formError ? <p className="text-sm text-rose-700">{formError}</p> : null}
              <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
                {busy ? "Connexion…" : "Me connecter et continuer"}
              </Button>
            </form>

            <button
              type="button"
              className="mt-5 w-full text-center text-sm font-semibold text-sky-700"
              onClick={() => {
                setMode("signup");
                setScreen("new_buyer");
                setFormError(null);
              }}
            >
              Créer un compte
            </button>
          </section>
        ) : null}

        {screen === "awaiting_email" && ready ? (
          <section className="rounded-3xl bg-white/95 p-6 shadow-soft backdrop-blur sm:p-8">
            <h1 className="font-display text-3xl text-ink">Confirmez votre e-mail ❤️</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Pour protéger votre achat, ouvrez le lien envoyé à{" "}
              <span className="font-semibold text-ink">{ready.emailMasked}</span>, puis revenez ici.
            </p>
            {formError ? <p className="mt-3 text-sm text-rose-700">{formError}</p> : null}
            <Button className="mt-6 h-12 w-full text-base" onClick={recheckVerified} disabled={busy}>
              {busy ? "Vérification…" : "J’ai confirmé mon e-mail"}
            </Button>
          </section>
        ) : null}

        {screen === "success" ? (
          <section className="rounded-3xl bg-white/95 p-7 text-center shadow-soft backdrop-blur sm:p-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint-100 text-3xl">
              ✨
            </div>
            <h1 className="mt-4 font-display text-3xl text-ink">Votre espace est prêt ! ✨</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Vous pouvez maintenant créer votre premier livre personnalisé.
            </p>
            <Link href="/create" className="mt-6 inline-block w-full">
              <Button className="h-12 w-full text-base">Créer mon premier livre</Button>
            </Link>
          </section>
        ) : null}

        {screen === "error" ? (
          <section className="rounded-3xl bg-white/95 p-7 shadow-soft backdrop-blur sm:p-8">
            <h1 className="font-display text-2xl text-ink sm:text-3xl">{errorTitle}</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">{errorText}</p>
            <div className="mt-6 flex flex-col gap-3">
              {saleParam ? (
                <Button
                  className="h-12 w-full"
                  onClick={() => window.location.reload()}
                  disabled={retryRef.current >= 5 && verifiedOnce.current}
                >
                  Réessayer
                </Button>
              ) : null}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-center text-sm font-semibold text-sky-700"
              >
                Contacter {SUPPORT_EMAIL}
              </a>
              <Link href="/login" className="text-center text-sm text-ink-muted">
                Connexion classique
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default function OuvrirMonAccesPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[100dvh] items-center justify-center px-4">
          <p className="text-sm text-ink-muted">Nous préparons votre espace…</p>
        </main>
      }
    >
      <OpenAccessFlow />
    </Suspense>
  );
}
