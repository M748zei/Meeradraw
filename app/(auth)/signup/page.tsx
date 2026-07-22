"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClientAuth, isFirebaseConfigured } from "@/lib/firebase/client";

export default function SignupPage() {
  const router = useRouter();
  const [fullname, setFullname] = useState("");
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
        router.push("/dashboard");
        return;
      }
      const auth = getClientAuth();
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: fullname });
      const idToken = await cred.user.getIdToken();
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Inscription impossible");
      // Licence requise → /license ; sinon dashboard (mode dev sans Chariow)
      let dest = "/dashboard";
      try {
        const st = await fetch("/api/license/status");
        const stJson = await st.json();
        if (stJson.success && stJson.data?.required && !stJson.data?.valid) {
          dest = "/license";
        }
      } catch {
        /* keep dashboard */
      }
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inscription impossible");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Logo className="mb-8" />
      <Card className="w-full max-w-md">
        <h1 className="font-display text-2xl text-ink">Créer votre studio</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Crée ton compte et teste gratuitement : 3 livres d&apos;essai (6 pages)
          offerts, sans carte bancaire.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Input placeholder="Prénom" value={fullname} onChange={(e) => setFullname(e.target.value)} required />
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Mot de passe (6+ caractères)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Création…" : "Commencer"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-muted">
          Déjà un compte ?{" "}
          <Link href="/login" className="font-semibold text-sky-600">Se connecter</Link>
        </p>
      </Card>
    </div>
  );
}
