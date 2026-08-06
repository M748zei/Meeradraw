"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditeurTexte } from "@/components/studio/editeur-texte";
import { PRESETS } from "@/services/studio/presets";
import {
  FORMATS,
  HEURES,
  PRESET_IDS,
  type Format,
  type Heure,
  type PresetId,
  type Variantes,
} from "@/services/studio/types";

/**
 * Les trois écrans du studio (§2 du brief) — une colonne, cibles de doigt,
 * pensé pour 360 px. Pas de champ de prompt libre : une phrase, un preset,
 * un cadre. Le style vient du preset.
 */

const COUTS: Record<Variantes, number> = { 1: 2, 2: 3, 4: 6 };
const HEURE_LIBELLES: Record<Heure, string> = {
  nuit: "Nuit",
  aube: "Aube",
  jour: "Jour",
  crepuscule: "Crépuscule",
};
const EXEMPLES = [
  "Un homme seul marche vers l'agence de la banque, la nuit, sous la pluie",
  "Une foule silencieuse se rassemble devant le palais présidentiel",
  "Des cavalières amazones passent la porte de la cité en armes",
  "Un camion colonial roule sur une piste de latérite au crépuscule",
];

type EtatGen =
  | { phase: "saisie" }
  | { phase: "generation"; enCoursDepuis: number }
  | { phase: "erreur"; message: string };

interface Variante {
  url: string;
  occupee?: boolean;
}

export function GenerateurStudio({ soldeInitial }: { soldeInitial: number | null }) {
  const router = useRouter();
  const [ecran, setEcran] = useState<1 | 2 | 3>(1);
  const [scene, setScene] = useState("");
  const [annee, setAnnee] = useState("");
  const [lieu, setLieu] = useState("");
  const [preset, setPreset] = useState<PresetId>("nuit-archive");
  const [format, setFormat] = useState<Format>("9:16");
  const [variantes, setVariantes] = useState<Variantes>(2);
  const [etat, setEtat] = useState<EtatGen>({ phase: "saisie" });
  const [resultats, setResultats] = useState<Variante[]>([]);
  const [solde, setSolde] = useState<number | null>(soldeInitial);
  const [edition, setEdition] = useState<string | null>(null);
  const [heurePar, setHeurePar] = useState<Record<number, Heure>>({});
  const [secondes, setSecondes] = useState(0);

  const sceneValide = scene.trim().length >= 8;

  async function appeler(corps: Record<string, unknown>): Promise<string[] | null> {
    const timer = setInterval(() => setSecondes((s) => s + 1), 1000);
    try {
      const reponse = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const json = await reponse.json().catch(() => null);
      if (!reponse.ok || !json?.success) {
        setEtat({
          phase: "erreur",
          message:
            json?.error?.message ??
            "La génération a échoué. Si des crédits ont été pris, ils t'ont été rendus — relance.",
        });
        return null;
      }
      if (typeof json.data.solde === "number") {
        setSolde(json.data.solde);
        router.refresh();
      }
      if (json.data.livrees < json.data.demandees) {
        console.warn(`[studio] ${json.data.livrees}/${json.data.demandees} variantes livrées`);
      }
      return json.data.urls as string[];
    } catch {
      setEtat({
        phase: "erreur",
        message:
          "La connexion a été coupée pendant la génération. Si des crédits ont été pris sans image, ils sont rendus automatiquement — relance.",
      });
      return null;
    } finally {
      clearInterval(timer);
    }
  }

  function corpsCommun() {
    return {
      scene: scene.trim(),
      annee: annee.trim() ? Number(annee.trim()) : undefined,
      lieu: lieu.trim() || undefined,
      preset,
      format,
    };
  }

  async function generer() {
    setSecondes(0);
    setEtat({ phase: "generation", enCoursDepuis: Date.now() });
    const urls = await appeler({ ...corpsCommun(), variantes });
    if (urls) {
      setResultats(urls.map((url) => ({ url })));
      setHeurePar({});
      setEtat({ phase: "saisie" });
    }
  }

  /** Régénérer UNE variante (1 image = 2 crédits), heure éventuelle comprise. */
  async function regenerer(index: number, heure?: Heure) {
    const heureFinale = heure ?? heurePar[index];
    setResultats((r) => r.map((v, i) => (i === index ? { ...v, occupee: true } : v)));
    const urls = await appeler({
      ...corpsCommun(),
      ...(heureFinale ? { heure: heureFinale } : {}),
      variantes: 1,
    });
    setResultats((r) =>
      r.map((v, i) =>
        i === index ? { url: urls?.[0] ?? v.url, occupee: false } : v
      )
    );
  }

  function prochaineHeure(index: number) {
    const actuelle = heurePar[index] ?? PRESETS[preset].heureNative;
    const suivante = HEURES[(HEURES.indexOf(actuelle) + 1) % HEURES.length];
    setHeurePar((h) => ({ ...h, [index]: suivante }));
    void regenerer(index, suivante);
  }

  const generationEnCours = etat.phase === "generation" || resultats.some((r) => r.occupee);

  return (
    <div className="space-y-5 pb-10">
      {/* ── Écran 1 — la scène ─────────────────────────────────────────── */}
      {ecran === 1 ? (
        <section className="space-y-4">
          <div>
            <label htmlFor="scene" className="mb-1.5 block text-sm font-bold text-ink">
              Ta scène, en une phrase
            </label>
            <Textarea
              id="scene"
              rows={3}
              maxLength={300}
              placeholder="Exemple : Un homme seul marche vers l'agence de la banque, la nuit, sous la pluie"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXEMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setScene(ex)}
                  className="rounded-full bg-cream-100 px-3 py-1.5 text-left text-xs text-ink-muted transition active:scale-95"
                >
                  {ex.length > 46 ? `${ex.slice(0, 44)}…` : ex}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="annee" className="mb-1.5 block text-sm font-bold text-ink">
                Année <span className="font-normal text-ink-muted">(facultatif)</span>
              </label>
              <Input
                id="annee"
                inputMode="numeric"
                maxLength={4}
                placeholder="1953"
                value={annee}
                onChange={(e) => setAnnee(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div>
              <label htmlFor="lieu" className="mb-1.5 block text-sm font-bold text-ink">
                Lieu <span className="font-normal text-ink-muted">(facultatif)</span>
              </label>
              <Input
                id="lieu"
                maxLength={80}
                placeholder="Bouaké"
                value={lieu}
                onChange={(e) => setLieu(e.target.value)}
              />
            </div>
          </div>
          <Button className="w-full" size="lg" disabled={!sceneValide} onClick={() => setEcran(2)}>
            Choisir le style
          </Button>
        </section>
      ) : null}

      {/* ── Écran 2 — le style ─────────────────────────────────────────── */}
      {ecran === 2 ? (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {PRESET_IDS.map((id) => {
              const p = PRESETS[id];
              const actif = preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreset(id)}
                  className={`rounded-2xl border-2 p-0.5 text-left transition active:scale-[0.98] ${
                    actif ? "border-amber-500" : "border-transparent"
                  }`}
                >
                  <div
                    className="flex h-20 items-end rounded-xl p-2"
                    style={{
                      background: `linear-gradient(140deg, ${p.vignette.de}, ${p.vignette.vers})`,
                    }}
                  >
                    <span className="text-sm font-bold text-white drop-shadow">{p.nom}</span>
                  </div>
                  <p className="px-1.5 py-1.5 text-[11px] leading-snug text-ink-muted">
                    {p.description}
                  </p>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEcran(1)}>
              Retour
            </Button>
            <Button className="flex-1" size="lg" onClick={() => setEcran(3)}>
              Choisir le cadre
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── Écran 3 — le cadre ─────────────────────────────────────────── */}
      {ecran === 3 ? (
        <section className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-bold text-ink">Format</p>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`min-h-12 rounded-xl text-sm font-semibold transition active:scale-95 ${
                    format === f
                      ? "bg-amber-500 text-white shadow-soft"
                      : "border border-cream-200 bg-white text-ink-muted"
                  }`}
                >
                  {f}
                  <span className="block text-[10px] font-normal opacity-80">
                    {f === "9:16" ? "Reel / TikTok" : f === "1:1" ? "Carré" : "Paysage"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-bold text-ink">Variantes</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([1, 2, 4] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVariantes(v)}
                  className={`min-h-12 rounded-xl text-sm font-semibold transition active:scale-95 ${
                    variantes === v
                      ? "bg-amber-500 text-white shadow-soft"
                      : "border border-cream-200 bg-white text-ink-muted"
                  }`}
                >
                  {v}
                  <span className="block text-[10px] font-normal opacity-80">{COUTS[v]} crédits</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEcran(2)}>
              Retour
            </Button>
            <Button
              className="flex-1"
              size="lg"
              onClick={generer}
              disabled={generationEnCours || !sceneValide}
            >
              {etat.phase === "generation"
                ? `Peinture en cours… ${secondes}s`
                : `Générer — ${COUTS[variantes]} crédits`}
            </Button>
          </div>
          {solde !== null && solde < COUTS[variantes] ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Ton solde ({solde}) ne couvre pas les {COUTS[variantes]} crédits — recharge avec le
              bouton en haut.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── Erreur ─────────────────────────────────────────────────────── */}
      {etat.phase === "erreur" ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm text-rose-800">{etat.message}</p>
          <Button
            className="mt-3"
            variant="secondary"
            size="sm"
            onClick={() => setEtat({ phase: "saisie" })}
          >
            Fermer
          </Button>
        </div>
      ) : null}

      {/* ── Résultats : variantes côte à côte ──────────────────────────── */}
      {resultats.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-ink">Tes images</h2>
          <div className={`grid gap-3 ${resultats.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {resultats.map((v, i) => (
              <figure key={`${v.url}-${i}`} className="space-y-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.url}
                  alt={`Variante ${i + 1}`}
                  className={`w-full rounded-xl shadow-soft ${v.occupee ? "animate-pulse opacity-50" : ""}`}
                />
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    disabled={generationEnCours}
                    onClick={() => void regenerer(i)}
                    className="rounded-lg bg-cream-100 px-2 py-2 text-[11px] font-semibold text-ink active:scale-95 disabled:opacity-50"
                  >
                    Régénérer · 2 cr
                  </button>
                  <button
                    type="button"
                    disabled={generationEnCours}
                    onClick={() => prochaineHeure(i)}
                    className="rounded-lg bg-cream-100 px-2 py-2 text-[11px] font-semibold text-ink active:scale-95 disabled:opacity-50"
                  >
                    {HEURE_LIBELLES[heurePar[i] ?? PRESETS[preset].heureNative]} → · 2 cr
                  </button>
                  <button
                    type="button"
                    onClick={() => setEdition(v.url)}
                    className="rounded-lg bg-cream-100 px-2 py-2 text-[11px] font-semibold text-ink active:scale-95"
                  >
                    Ajouter le texte
                  </button>
                  <a
                    href={`/api/images/proxy?url=${encodeURIComponent(v.url)}`}
                    download={`scarabee-${i + 1}.jpg`}
                    className="rounded-lg bg-cream-100 px-2 py-2 text-center text-[11px] font-semibold text-ink active:scale-95"
                  >
                    Télécharger
                  </a>
                </div>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {edition ? <EditeurTexte url={edition} onFermer={() => setEdition(null)} /> : null}
    </div>
  );
}
