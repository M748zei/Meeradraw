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

async function establishSession() {
  const auth = getClientAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Session impossible");
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Session impossible");
}

async function resolvePostAuthPath(requestedNext: string) {
  // Respect explicit next (e.g. /license) ; sinon redirige si licence requise
  if (requestedNext && requestedNext !== "/dashboard") return requestedNext;
  try {
    const st = await fetch("/api/license/status");
    const stJson = await st.json();
    if (stJson.success && stJson.data?.required && !stJson.data?.valid) {
      return "/license";
    }
  } catch {
    /* keep requested */
  }
  return requestedNext || "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/dashboard";
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
      router.push(await resolvePostAuthPath(next));
      router.refresh();
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
      await signInWithPopup(getClientAuth(), new GoogleAuthProvider());
      await establishSession();
      router.push(await resolvePostAuthPath(next));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion Google impossible");
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
