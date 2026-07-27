"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClientAuth, isFirebaseConfigured } from "@/lib/firebase/client";
import { safeInternalPath } from "@/lib/safe-redirect";

async function establishSession() {
  const auth = getClientAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Session impossible");
  const res = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Session impossible");

  // Do not navigate on a JSON-only success. Confirm that the browser retained
  // the HttpOnly cookie and that the server can validate it first.
  const check = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const checkJson = await check.json();
  if (!check.ok || !checkJson.success) {
    throw new Error(
      "La connexion Google a réussi, mais le navigateur n’a pas conservé la session. Réessayez après avoir autorisé les cookies pour MeeraDraw."
    );
  }
}

async function resolvePostAuthPath(requestedNext: string) {
  const safe = safeInternalPath(requestedNext, "/dashboard");
  if (safe !== "/dashboard") return safe;
  try {
    const st = await fetch("/api/license/status");
    const stJson = await st.json();
    if (stJson.success && stJson.data?.required && !stJson.data?.valid) {
      return "/license";
    }
  } catch {
    /* keep requested */
  }
  return safe;
}

function friendlyGoogleError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "auth/unauthorized-domain") {
    return "Connexion Google non autorisée sur ce domaine. Contactez le support MeeraDraw.";
  }
  if (code === "auth/operation-not-allowed") {
    return "La connexion Google n’est pas encore activée. Contactez le support MeeraDraw.";
  }
  if (code === "auth/network-request-failed") {
    return "Connexion réseau interrompue. Vérifiez Internet puis réessayez.";
  }
  if (code === "auth/popup-blocked") {
    return "Le navigateur a bloqué la fenêtre Google. Autorisez les fenêtres contextuelles pour MeeraDraw puis réessayez.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "La fenêtre Google a été fermée avant la fin de la connexion.";
  }
  return error instanceof Error ? error.message : "Connexion Google impossible";
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeInternalPath(search.get("next"), "/dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) {
        router.push(next);
        return;
      }
      await signInWithEmailAndPassword(getClientAuth(), email, password);
      await establishSession();
      window.location.replace(await resolvePostAuthPath(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) {
        router.push(next);
        return;
      }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(getClientAuth(), provider);
      await establishSession();
      window.location.replace(await resolvePostAuthPath(next));
    } catch (err) {
      setError(friendlyGoogleError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <h1 className="font-display text-2xl text-ink">Bon retour</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Connectez-vous pour retrouver votre studio et vos créations.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Connexion…" : "Se connecter"}
        </Button>
      </form>
      <Button type="button" variant="secondary" className="mt-3 w-full" onClick={signInWithGoogle} disabled={loading}>
        Continuer avec Google
      </Button>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Pas encore de compte ?{" "}
        <Link href="/signup" className="font-semibold text-sky-600">Créer un compte</Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Logo className="mb-8" />
      <Suspense><LoginForm /></Suspense>
    </div>
  );
}
