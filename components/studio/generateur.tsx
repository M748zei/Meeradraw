"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditeurTexte } from "@/components/studio/editeur-texte";
import { PRESETS } from "@/services/studio/presets";
import {
  CATEGORIES,
  FORMATS,
  HEURES,
  PRESET_IDS,
  REGIONS,
  type Format,
  type Heure,
  type Personnage,
  type PresetId,
  type Region,
  type Saisie,
  type Variantes,
  type ZoneTexte,
} from "@/services/studio/types";

/**
 * Le parcours v2 (§1) : LE STYLE → LES DÉTAILS → LE CADRE. C'est le style qui
 * décide de ce qu'on demande : l'étape 2 se construit à partir des champs que
 * le preset déclare. Aucun champ obligatoire sauf la phrase quand elle est là.
 * Une colonne, cibles de doigt, pensé pour 360 px.
 */

const COUTS: Record<Variantes, number> = { 1: 2, 2: 3, 4: 6 };
const HEURE_LIBELLES: Record<Heure, string> = {
  nuit: "Nuit",
  aube: "Aube",
  jour: "Jour",
  crepuscule: "Crépuscule",
};
const REGION_LIBELLES: Record<Region, string> = {
  ouest: "Afrique de l'Ouest (défaut)",
  sahel: "Sahel",
  cote: "Côte",
  foret: "Forêt",
  est: "Afrique de l'Est",
  maghreb: "Maghreb",
  monde: "Hors Afrique",
};
const MODELES_UI = [
  { id: "", nom: "Modèle par défaut" },
  { id: "flux-2-pro", nom: "FLUX 2 Pro" },
  { id: "flux-general", nom: "FLUX General" },
  { id: "ideogram-v3", nom: "Ideogram V3" },
];
const FORMAT_LIBELLES: Record<Format, string> = {
  "9:16": "Reel / TikTok",
  "4:5": "Post",
  "1:1": "Carré",
  "16:9": "Paysage",
};
const ZONE_Y: Record<ZoneTexte, number> = {
  haut: 16,
  bas: 85,
  centre: 50,
  droite: 50,
  bandeaux: 90,
};

type EtatGen =
  | { phase: "saisie" }
  | { phase: "generation" }
  | { phase: "erreur"; message: string };

interface VarianteImage {
  url: string;
  occupee?: boolean;
}

const SAISIE_VIDE: Saisie = {};

export function GenerateurStudio({ soldeInitial }: { soldeInitial: number | null }) {
  const router = useRouter();
  const [ecran, setEcran] = useState<1 | 2 | 3>(1);
  const [preset, setPreset] = useState<PresetId>("nuit-archive");
  const [saisie, setSaisie] = useState<Saisie>(SAISIE_VIDE);
  const [format, setFormat] = useState<Format>(PRESETS["nuit-archive"].format);
  const [variantes, setVariantes] = useState<Variantes>(2);
  const [etat, setEtat] = useState<EtatGen>({ phase: "saisie" });
  const [resultats, setResultats] = useState<VarianteImage[]>([]);
  const [solde, setSolde] = useState<number | null>(soldeInitial);
  const [edition, setEdition] = useState<string | null>(null);
  const [heurePar, setHeurePar] = useState<Record<number, Heure | undefined>>({});
  const [secondes, setSecondes] = useState(0);
  // Mode avancé — fermé par défaut, la seule échappatoire à la règle du §4.
  const [avance, setAvance] = useState(false);
  const [promptLibre, setPromptLibre] = useState("");
  const [region, setRegion] = useState<Region>("ouest");
  const [modele, setModele] = useState("");
  const [graine, setGraine] = useState("");
  const [derniereGraine, setDerniereGraine] = useState<number | null>(null);

  const lePreset = PRESETS[preset];
  const declarePhrase = lePreset.champs.some((c) => c.type === "phrase");
  const phraseValide = !declarePhrase || (saisie.phrase ?? "").trim().length >= 8;

  function majSaisie(delta: Partial<Saisie>) {
    setSaisie((s) => ({ ...s, ...delta }));
  }
  function majPersonnage(index: number, delta: Partial<Personnage>) {
    setSaisie((s) => {
      const liste = [...(s.personnages ?? [])];
      liste[index] = { ...liste[index], ...delta };
      return { ...s, personnages: liste };
    });
  }

  async function appeler(corps: Record<string, unknown>): Promise<string[] | null> {
    const timer = setInterval(() => setSecondes((n) => n + 1), 1000);
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
      if (typeof json.data.graine === "number") setDerniereGraine(json.data.graine);
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
      preset,
      saisie,
      format,
      ...(region !== "ouest" ? { region } : {}),
      ...(promptLibre.trim() ? { promptLibre: promptLibre.trim() } : {}),
      ...(modele ? { modele } : {}),
      ...(graine.trim() ? { graine: Number(graine.trim()) } : {}),
    };
  }

  async function generer() {
    setSecondes(0);
    setEtat({ phase: "generation" });
    const urls = await appeler({ ...corpsCommun(), variantes });
    if (urls) {
      setResultats(urls.map((url) => ({ url })));
      setHeurePar({});
      setEtat({ phase: "saisie" });
    }
  }

  async function regenerer(index: number, heure?: Heure) {
    const heureFinale = heure ?? heurePar[index];
    setResultats((r) => r.map((v, i) => (i === index ? { ...v, occupee: true } : v)));
    const urls = await appeler({
      ...corpsCommun(),
      ...(heureFinale ? { heure: heureFinale } : {}),
      graine: undefined,
      variantes: 1,
    });
    setResultats((r) =>
      r.map((v, i) => (i === index ? { url: urls?.[0] ?? v.url, occupee: false } : v))
    );
  }

  function prochaineHeure(index: number) {
    const cycle: (Heure | undefined)[] = [undefined, ...HEURES];
    const suivante = cycle[(cycle.indexOf(heurePar[index]) + 1) % cycle.length];
    setHeurePar((h) => ({ ...h, [index]: suivante }));
    void regenerer(index, suivante);
  }

  const generationEnCours = etat.phase === "generation" || resultats.some((r) => r.occupee);

  return (
    <div className="space-y-5 pb-10">
      {/* ── Écran 1 — LE STYLE ─────────────────────────────────────────── */}
      {ecran === 1 ? (
        <section className="space-y-5">
          {CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <h2 className="mb-2 text-sm font-bold text-ink">{cat.nom}</h2>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_IDS.filter((id) => PRESETS[id].categorie === cat.id).map((id) => {
                  const p = PRESETS[id];
                  const actif = preset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setPreset(id);
                        setFormat(p.format);
                        setSaisie(SAISIE_VIDE);
                        setEcran(2);
                      }}
                      className={`rounded-2xl border-2 p-0.5 text-left transition active:scale-[0.98] ${
                        actif ? "border-amber-500" : "border-transparent"
                      }`}
                    >
                      <div
                        className="relative flex h-32 items-end overflow-hidden rounded-xl p-2"
                        style={{
                          background: `linear-gradient(140deg, ${p.vignette.de}, ${p.vignette.vers})`,
                        }}
                      >
                        {/* La vignette est une image réellement générée par ce
                            preset (script generer-vignettes), servie en statique.
                            Si elle manque, le dégradé reste. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/presets/${id}.webp`}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 to-transparent" />
                        {p.zoneTexte ? (
                          <span className="absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                            zone de texte
                          </span>
                        ) : null}
                        <span className="relative text-[13px] font-bold leading-tight text-white drop-shadow">
                          {p.nom}
                        </span>
                      </div>
                      <p className="px-1.5 py-1 text-[10px] leading-snug text-ink-muted">
                        {p.description.replace(" [zone de texte]", "")}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* ── Écran 2 — LES DÉTAILS (déclarés par le style choisi) ───────── */}
      {ecran === 2 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span
              className="h-10 w-10 shrink-0 rounded-xl bg-cover bg-center"
              style={{
                backgroundImage: `url(/presets/${preset}.webp), linear-gradient(140deg, ${lePreset.vignette.de}, ${lePreset.vignette.vers})`,
              }}
            />
            <div>
              <p className="text-sm font-bold text-ink">{lePreset.nom}</p>
              <p className="text-xs text-ink-muted">
                Tout est facultatif{declarePhrase ? ", sauf la phrase" : ""} — vide, le modèle
                décide ; rempli, il obéit.
              </p>
            </div>
          </div>

          {lePreset.champs.map((champ, ci) => {
            if (champ.type === "phrase") {
              return (
                <div key={ci}>
                  <label htmlFor="phrase" className="mb-1.5 block text-sm font-bold text-ink">
                    {champ.label}
                  </label>
                  <Textarea
                    id="phrase"
                    rows={3}
                    maxLength={300}
                    placeholder={`Exemple : ${champ.exemples[0] ?? ""}`}
                    value={saisie.phrase ?? ""}
                    onChange={(e) => majSaisie({ phrase: e.target.value })}
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {champ.exemples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => majSaisie({ phrase: ex })}
                        className="rounded-full bg-cream-100 px-3 py-1.5 text-left text-xs text-ink-muted transition active:scale-95"
                      >
                        {ex.length > 46 ? `${ex.slice(0, 44)}…` : ex}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            if (champ.type === "personnages") {
              const liste = saisie.personnages ?? [];
              return (
                <div key={ci} className="space-y-2">
                  <p className="text-sm font-bold text-ink">
                    Personnages <span className="font-normal text-ink-muted">(jusqu'à {champ.max}, facultatif)</span>
                  </p>
                  {liste.map((pers, pi) => (
                    <div key={pi} className="grid grid-cols-3 gap-1.5">
                      <Input
                        placeholder="Rôle — un soldat"
                        maxLength={80}
                        value={pers.role ?? ""}
                        onChange={(e) => majPersonnage(pi, { role: e.target.value })}
                      />
                      <Input
                        placeholder="Tenue — chemise bleue"
                        maxLength={120}
                        value={pers.tenue ?? ""}
                        onChange={(e) => majPersonnage(pi, { tenue: e.target.value })}
                      />
                      <Input
                        placeholder="Action — il sort"
                        maxLength={120}
                        value={pers.action ?? ""}
                        onChange={(e) => majPersonnage(pi, { action: e.target.value })}
                      />
                    </div>
                  ))}
                  {liste.length < champ.max ? (
                    <button
                      type="button"
                      onClick={() =>
                        majSaisie({ personnages: [...liste, {}] })
                      }
                      className="rounded-xl bg-cream-100 px-3 py-2 text-xs font-semibold text-ink active:scale-95"
                    >
                      + Ajouter un personnage
                    </button>
                  ) : null}
                </div>
              );
            }
            if (champ.type === "objets") {
              const liste = saisie.objets ?? [];
              return (
                <div key={ci} className="space-y-2">
                  <p className="text-sm font-bold text-ink">
                    Objets <span className="font-normal text-ink-muted">(jusqu'à {champ.max}, facultatif)</span>
                  </p>
                  {liste.map((obj, oi) => (
                    <Input
                      key={oi}
                      placeholder="Exemple : une berline grise"
                      maxLength={120}
                      value={obj}
                      onChange={(e) =>
                        majSaisie({
                          objets: liste.map((o, j) => (j === oi ? e.target.value : o)),
                        })
                      }
                    />
                  ))}
                  {liste.length < champ.max ? (
                    <button
                      type="button"
                      onClick={() => majSaisie({ objets: [...liste, ""] })}
                      className="rounded-xl bg-cream-100 px-3 py-2 text-xs font-semibold text-ink active:scale-95"
                    >
                      + Ajouter un objet
                    </button>
                  ) : null}
                </div>
              );
            }
            if (champ.type === "texte") {
              return (
                <div key={ci}>
                  <label className="mb-1.5 block text-sm font-bold text-ink">
                    {champ.label} <span className="font-normal text-ink-muted">(facultatif)</span>
                  </label>
                  <Input
                    maxLength={160}
                    placeholder={`Exemple : ${champ.exemples[0] ?? ""}`}
                    value={saisie.textes?.[champ.cle] ?? ""}
                    onChange={(e) =>
                      majSaisie({ textes: { ...saisie.textes, [champ.cle]: e.target.value } })
                    }
                  />
                </div>
              );
            }
            if (champ.type === "annee") {
              return (
                <div key={ci}>
                  <label htmlFor="annee" className="mb-1.5 block text-sm font-bold text-ink">
                    Année <span className="font-normal text-ink-muted">(facultatif)</span>
                  </label>
                  <Input
                    id="annee"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="1973"
                    value={saisie.annee ? String(saisie.annee) : ""}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      majSaisie({ annee: v ? Number(v) : undefined });
                    }}
                  />
                </div>
              );
            }
            // lieu
            return (
              <div key={ci}>
                <label htmlFor="lieu" className="mb-1.5 block text-sm font-bold text-ink">
                  Lieu <span className="font-normal text-ink-muted">(facultatif)</span>
                </label>
                <Input
                  id="lieu"
                  maxLength={80}
                  placeholder="Conakry"
                  value={saisie.lieu ?? ""}
                  onChange={(e) => majSaisie({ lieu: e.target.value })}
                />
              </div>
            );
          })}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEcran(1)}>
              Retour
            </Button>
            <Button className="flex-1" size="lg" disabled={!phraseValide} onClick={() => setEcran(3)}>
              Choisir le cadre
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── Écran 3 — LE CADRE + mode avancé replié ────────────────────── */}
      {ecran === 3 ? (
        <section className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-bold text-ink">Format</p>
            <div className="grid grid-cols-4 gap-1.5">
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
                  <span className="block text-[9px] font-normal opacity-80">
                    {FORMAT_LIBELLES[f]}
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

          <div className="rounded-2xl border border-cream-200 bg-white">
            <button
              type="button"
              onClick={() => setAvance(!avance)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink-muted"
            >
              Mode avancé
              <span className="text-xs">{avance ? "▲" : "▼"}</span>
            </button>
            {avance ? (
              <div className="space-y-3 border-t border-cream-200 p-4">
                <div>
                  <label htmlFor="promptLibre" className="mb-1 block text-xs font-bold text-ink">
                    Consigne libre <span className="font-normal text-ink-muted">(ajoutée après le style)</span>
                  </label>
                  <Textarea
                    id="promptLibre"
                    rows={2}
                    maxLength={500}
                    placeholder="Exemple : pellicule argentique, grain marqué"
                    value={promptLibre}
                    onChange={(e) => setPromptLibre(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="region" className="mb-1 block text-xs font-bold text-ink">
                      Région
                    </label>
                    <select
                      id="region"
                      value={region}
                      onChange={(e) => setRegion(e.target.value as Region)}
                      className="h-11 w-full rounded-xl border border-cream-200 bg-white px-2 text-sm text-ink"
                    >
                      {REGIONS.map((r) => (
                        <option key={r} value={r}>
                          {REGION_LIBELLES[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="modele" className="mb-1 block text-xs font-bold text-ink">
                      Modèle
                    </label>
                    <select
                      id="modele"
                      value={modele}
                      onChange={(e) => setModele(e.target.value)}
                      className="h-11 w-full rounded-xl border border-cream-200 bg-white px-2 text-sm text-ink"
                    >
                      {MODELES_UI.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="graine" className="mb-1 block text-xs font-bold text-ink">
                    Graine <span className="font-normal text-ink-muted">(pour reproduire une image)</span>
                  </label>
                  <Input
                    id="graine"
                    inputMode="numeric"
                    placeholder={derniereGraine ? `Dernière : ${derniereGraine}` : "Vide = au hasard"}
                    value={graine}
                    onChange={(e) => setGraine(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEcran(2)}>
              Retour
            </Button>
            <Button
              className="flex-1"
              size="lg"
              onClick={generer}
              disabled={generationEnCours || !phraseValide}
            >
              {etat.phase === "generation"
                ? `Création en cours… ${secondes}s`
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

      {/* ── Résultats ──────────────────────────────────────────────────── */}
      {resultats.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-ink">Tes images</h2>
          {derniereGraine ? (
            <p className="text-[11px] text-ink-muted">Graine : {derniereGraine}</p>
          ) : null}
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
                    {heurePar[i] ? HEURE_LIBELLES[heurePar[i]!] : "Heure"} → · 2 cr
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
                    download={`meeradraw-${i + 1}.jpg`}
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

      {edition ? (
        <EditeurTexte
          url={edition}
          yInitial={lePreset.zoneTexte ? ZONE_Y[lePreset.zoneTexte] : 75}
          onFermer={() => setEdition(null)}
        />
      ) : null}
    </div>
  );
}
