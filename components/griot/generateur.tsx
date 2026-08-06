"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { BlocCopiable, BoutonCopier } from "@/components/griot/copier";
import type { Recit } from "@/services/griot/types";

/**
 * L'écran unique de Griot — une colonne, cibles de doigt, pensé pour un
 * TECNO à 360 px (§3, §8). Un seul champ vraiment libre : le sujet.
 */

const EXEMPLES = [
  "Le braquage des agences BCEAO de Bouaké en 2003",
  "L'assassinat de Thomas Sankara",
  "Béhanzin et les Amazones du Dahomey",
  "La disparition du vol UTA 772 au-dessus du Ténéré",
  "Kaocen, l'homme qui a défié la France dans l'Aïr",
  "Patrice Lumumba, le discours qui a scellé son destin",
];

const ANGLES: { valeur: "crime" | "mystere" | "destin" | "pouvoir" | "heritage"; libelle: string }[] = [
  { valeur: "crime", libelle: "Crime" },
  { valeur: "mystere", libelle: "Mystère" },
  { valeur: "destin", libelle: "Destin" },
  { valeur: "pouvoir", libelle: "Pouvoir" },
  { valeur: "heritage", libelle: "Héritage volé" },
];

const DUREES: { valeur: "45" | "75" | "120"; libelle: string; detail: string }[] = [
  { valeur: "45", libelle: "45 s", detail: "~110 mots" },
  { valeur: "75", libelle: "1 min 15", detail: "~190 mots" },
  { valeur: "120", libelle: "2 min", detail: "~300 mots" },
];

const COUT = 8;

type Etat =
  | { phase: "saisie" }
  | { phase: "generation" }
  | { phase: "resultat"; recit: Recit; solde: number | null; sauvegarde: boolean }
  | { phase: "erreur"; message: string };

function Compteur() {
  const [secondes, setSecondes] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecondes((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-cream-200 bg-white p-6 shadow-soft">
      <p className="font-display text-3xl text-amber-600">{secondes}s</p>
      <p className="text-center text-sm text-ink-muted">
        Griot écrit ton récit — accroches, script, plans, description…
      </p>
    </div>
  );
}

export function Generateur({ soldeInitial }: { soldeInitial: number | null }) {
  const router = useRouter();
  const [sujet, setSujet] = useState("");
  const [angle, setAngle] = useState<(typeof ANGLES)[number]["valeur"]>("crime");
  const [pays, setPays] = useState("");
  const [duree, setDuree] = useState<(typeof DUREES)[number]["valeur"]>("45");
  const [etat, setEtat] = useState<Etat>({ phase: "saisie" });
  const refResultat = useRef<HTMLDivElement>(null);

  const sujetValide = sujet.trim().length >= 8;

  async function generer() {
    if (!sujetValide) {
      setEtat({
        phase: "erreur",
        message: "Décris ton sujet en quelques mots — regarde les exemples juste au-dessus.",
      });
      return;
    }
    setEtat({ phase: "generation" });
    try {
      const reponse = await fetch("/api/recits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sujet: sujet.trim(),
          angle,
          pays: pays.trim() || undefined,
          duree,
        }),
      });
      const corps = await reponse.json().catch(() => null);
      if (!reponse.ok || !corps?.success) {
        setEtat({
          phase: "erreur",
          message:
            corps?.error?.message ??
            "La génération a échoué. Si des crédits ont été pris, ils t'ont été rendus — relance.",
        });
        return;
      }
      setEtat({
        phase: "resultat",
        recit: corps.data.recit as Recit,
        solde: typeof corps.data.solde === "number" ? corps.data.solde : null,
        sauvegarde: Boolean(corps.data.sauvegarde),
      });
      router.refresh(); // met à jour le solde affiché dans l'en-tête
      setTimeout(() => refResultat.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      setEtat({
        phase: "erreur",
        message:
          "La connexion a été coupée pendant la génération. Si des crédits ont été pris sans récit, ils sont rendus automatiquement — relance.",
      });
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Formulaire ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <label htmlFor="sujet" className="mb-1.5 block text-sm font-bold text-ink">
            Ton sujet <span className="font-normal text-ink-muted">(le seul champ à écrire)</span>
          </label>
          <Textarea
            id="sujet"
            rows={3}
            maxLength={400}
            placeholder="Exemple : Le braquage des agences BCEAO de Bouaké en 2003"
            value={sujet}
            onChange={(e) => setSujet(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXEMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setSujet(ex)}
                className="rounded-full bg-cream-100 px-3 py-1.5 text-xs text-ink-muted transition active:scale-95"
              >
                {ex.length > 44 ? `${ex.slice(0, 42)}…` : ex}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-bold text-ink">L&apos;angle</p>
          <div className="flex flex-wrap gap-1.5">
            {ANGLES.map((a) => (
              <button
                key={a.valeur}
                type="button"
                onClick={() => setAngle(a.valeur)}
                className={`min-h-11 rounded-xl px-4 text-sm font-semibold transition active:scale-95 ${
                  angle === a.valeur
                    ? "bg-amber-500 text-white shadow-soft"
                    : "bg-white text-ink-muted border border-cream-200"
                }`}
              >
                {a.libelle}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="pays" className="mb-1.5 block text-sm font-bold text-ink">
            Le pays <span className="font-normal text-ink-muted">(facultatif)</span>
          </label>
          <Input
            id="pays"
            maxLength={60}
            placeholder="Exemple : Côte d'Ivoire"
            value={pays}
            onChange={(e) => setPays(e.target.value)}
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-bold text-ink">La durée du reel</p>
          <div className="grid grid-cols-3 gap-1.5">
            {DUREES.map((d) => (
              <button
                key={d.valeur}
                type="button"
                onClick={() => setDuree(d.valeur)}
                className={`min-h-14 rounded-xl px-2 text-sm font-semibold transition active:scale-95 ${
                  duree === d.valeur
                    ? "bg-amber-500 text-white shadow-soft"
                    : "bg-white text-ink-muted border border-cream-200"
                }`}
              >
                {d.libelle}
                <span className="block text-[10px] font-normal opacity-80">{d.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={generer}
          disabled={etat.phase === "generation" || !sujetValide}
        >
          {etat.phase === "generation" ? "Écriture en cours…" : `Écrire mon récit — ${COUT} crédits`}
        </Button>
        {soldeInitial !== null && soldeInitial < COUT && etat.phase === "saisie" ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Ton solde ({soldeInitial}) ne couvre pas les {COUT} crédits d&apos;un récit —
            recharge d&apos;abord avec le bouton en haut.
          </p>
        ) : null}
      </section>

      {/* ── Génération en cours ────────────────────────────────────────── */}
      {etat.phase === "generation" ? <Compteur /> : null}

      {/* ── Erreur ─────────────────────────────────────────────────────── */}
      {etat.phase === "erreur" ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm text-rose-800">{etat.message}</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={() => setEtat({ phase: "saisie" })}>
            Réessayer
          </Button>
        </div>
      ) : null}

      {/* ── Résultat : un bloc = un bouton Copier ─────────────────────── */}
      {etat.phase === "resultat" ? (
        <div ref={refResultat} className="space-y-3">
          <div className="rounded-2xl bg-mint-100 px-4 py-3">
            <p className="text-sm font-semibold text-mint-800">
              Récit prêt : « {etat.recit.titre} »
              {etat.solde !== null ? ` — il te reste ${etat.solde} crédits.` : ""}
            </p>
            {!etat.sauvegarde ? (
              <p className="mt-1 text-xs text-mint-800">
                (Il n&apos;a pas pu être archivé dans ton historique — copie-le maintenant.)
              </p>
            ) : null}
          </div>

          <BlocCopiable titre="3 accroches — choisis la première ligne" texte={etat.recit.accroches.join("\n")}>
            <ul className="space-y-2">
              {etat.recit.accroches.map((a, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-sm text-ink-muted">
                  <span>{a}</span>
                  <BoutonCopier texte={a} libelle="Copier" />
                </li>
              ))}
            </ul>
          </BlocCopiable>

          <BlocCopiable titre={`Script (~${etat.recit.duree_secondes} s) — à lire mot pour mot`} texte={etat.recit.script} />

          <BlocCopiable
            titre={`${etat.recit.plans.length} plans — narration, image, recherche`}
            texte={etat.recit.plans
              .map(
                (p, i) =>
                  `PLAN ${i + 1}\nNarration : ${p.narration}\nImage : ${p.image}\nRecherche : ${p.recherche}${p.incrustation ? `\nIncrustation : ${p.incrustation}` : ""}`
              )
              .join("\n\n")}
          >
            <ol className="space-y-3">
              {etat.recit.plans.map((p, i) => (
                <li key={i} className="rounded-xl bg-cream-100/60 p-3 text-sm">
                  <p className="font-semibold text-ink">Plan {i + 1}</p>
                  <p className="mt-1 text-ink-muted">{p.narration}</p>
                  <p className="mt-1 text-xs text-ink-muted">🎬 {p.image}</p>
                  <p className="text-xs text-ink-muted">🔎 {p.recherche}</p>
                  {p.incrustation ? (
                    <p className="text-xs text-ink-muted">🔤 {p.incrustation}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </BlocCopiable>

          <BlocCopiable titre="Description Facebook" texte={etat.recit.description} />
          <BlocCopiable titre="Question à épingler en commentaire" texte={etat.recit.question} />
          <BlocCopiable titre="Hashtags" texte={etat.recit.hashtags.join(" ")} />

          {etat.recit.reponses.length ? (
            <BlocCopiable
              titre="Réponses aux commentaires probables"
              texte={etat.recit.reponses
                .map((r) => `« ${r.commentaire} »\n→ ${r.reponse}`)
                .join("\n\n")}
            >
              <ul className="space-y-2 text-sm text-ink-muted">
                {etat.recit.reponses.map((r, i) => (
                  <li key={i}>
                    <p className="font-semibold text-ink">« {r.commentaire} »</p>
                    <p>→ {r.reponse}</p>
                  </li>
                ))}
              </ul>
            </BlocCopiable>
          ) : null}

          <BlocCopiable
            titre="Version TikTok"
            texte={`${etat.recit.tiktok.accroche}\n\n${etat.recit.tiktok.script}`}
          />

          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <h3 className="text-sm font-bold text-amber-900">⚠️ À vérifier avant de publier</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-900">
              {etat.recit.a_verifier.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </section>

          {etat.recit.prochains_sujets.length ? (
            <section className="rounded-2xl border border-cream-200 bg-white p-4 shadow-soft">
              <h3 className="text-sm font-bold text-ink">Tes 3 prochains sujets</h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {etat.recit.prochains_sujets.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSujet(s);
                      setEtat({ phase: "saisie" });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="rounded-xl bg-cream-100 px-3 py-2.5 text-left text-sm text-ink transition active:scale-[0.98]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <Button className="w-full" variant="secondary" onClick={() => setEtat({ phase: "saisie" })}>
            Écrire un autre récit
          </Button>
        </div>
      ) : null}
    </div>
  );
}
