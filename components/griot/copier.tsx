"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copie robuste : navigator.clipboard échoue sur certains navigateurs mobiles
 * (contexte non sécurisé, WebViews) — repli execCommand sur textarea cachée.
 */
async function copierTexte(texte: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
  } catch {
    /* on tente le repli */
  }
  try {
    const zone = document.createElement("textarea");
    zone.value = texte;
    zone.setAttribute("readonly", "");
    zone.style.position = "fixed";
    zone.style.opacity = "0";
    document.body.appendChild(zone);
    zone.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(zone);
    return ok;
  } catch {
    return false;
  }
}

export function BoutonCopier({ texte, libelle = "Copier" }: { texte: string; libelle?: string }) {
  const [etat, setEtat] = useState<"idle" | "ok" | "erreur">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copierTexte(texte);
        setEtat(ok ? "ok" : "erreur");
        setTimeout(() => setEtat("idle"), 2000);
      }}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-cream-100 px-3 py-2 text-xs font-semibold text-ink transition active:scale-95"
    >
      {etat === "ok" ? <Check className="h-3.5 w-3.5 text-mint-800" /> : <Copy className="h-3.5 w-3.5" />}
      {etat === "ok" ? "Copié !" : etat === "erreur" ? "Sélectionne et copie à la main" : libelle}
    </button>
  );
}

/** Un bloc livrable : un titre, un contenu, UN bouton Copier (§8). */
export function BlocCopiable({
  titre,
  texte,
  children,
}: {
  titre: string;
  texte: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-cream-200 bg-white p-4 shadow-soft">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{titre}</h3>
        <BoutonCopier texte={texte} />
      </div>
      {children ?? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{texte}</p>
      )}
    </section>
  );
}
