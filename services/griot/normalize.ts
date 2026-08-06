import {
  CIBLES_DUREE,
  RecitInutilisable,
  ReponseIllisible,
  type PlanRecit,
  type Recit,
  type RecitInput,
} from "@/services/griot/types";

/**
 * Le format de sortie d'un modèle n'est JAMAIS garanti (§7.7) : JSON emballé
 * dans des balises, champs manquants, mauvais types. Ici tout est normalisé —
 * un champ manquant devient une valeur vide propre, jamais un plantage.
 */

export const VERIF_DEFAUT =
  "Recoupe les dates, les noms et les montants avec une source avant de publier.";

const PHRASES_INTERDITES = [
  "chers amis",
  "plongeons ensemble",
  "accrochez-vous",
  "incroyable mais vrai",
];

/** Extrait l'objet JSON d'une réponse modèle, balises markdown tolérées. */
export function extraireJson(contenu: string): Record<string, unknown> {
  const texte = String(contenu ?? "").trim();
  if (!texte) throw new ReponseIllisible("réponse vide");
  try {
    return JSON.parse(texte) as Record<string, unknown>;
  } catch {
    // Certains modèles emballent le JSON dans des ``` malgré la consigne.
    const bloc = texte.match(/\{[\s\S]*\}/);
    if (bloc) {
      try {
        return JSON.parse(bloc[0]) as Record<string, unknown>;
      } catch {
        throw new ReponseIllisible("JSON invalide même après extraction du bloc {…}");
      }
    }
    throw new ReponseIllisible("aucun objet JSON dans la réponse");
  }
}

function texte(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function listeTextes(v: unknown, max: number, maxLen = 500): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => texte(x, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

/** Retire les emojis (le script est du texte PARLÉ — un emoji lu à voix haute n'existe pas). */
function sansEmoji(s: string): string {
  return s.replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/ {2,}/g, " ").trim();
}

function compterMots(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function normaliserEspace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Phrases interdites présentes dans le script (détection, pas soustraction). */
export function phrasesInterditesPresentes(script: string): string[] {
  const bas = script.toLowerCase();
  return PHRASES_INTERDITES.filter((p) => bas.includes(p));
}

/** Découpe un script en fragments ~équilibrés, aux frontières de phrases. */
function decouperEnPlans(script: string, nombre: number): string[] {
  const phrases = script.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map((s) => s.trim()) ?? [script];
  const cible = Math.max(1, Math.ceil(phrases.length / Math.max(1, nombre)));
  const fragments: string[] = [];
  for (let i = 0; i < phrases.length; i += cible) {
    fragments.push(phrases.slice(i, i + cible).join(" "));
  }
  return fragments;
}

/**
 * Normalise une réponse brute du modèle en Recit exploitable.
 * Jette RecitInutilisable si le cœur (le script) ne peut pas être sauvé.
 */
export function normaliserRecit(brut: Record<string, unknown>, input: RecitInput): Recit {
  const notes: string[] = [];
  const cible = CIBLES_DUREE[input.duree];

  // ── Le script, cœur du récit ──────────────────────────────────────────────
  let script = sansEmoji(texte(brut.script, 8000));

  // ── Les plans : leur concaténation doit redonner le script (§5) ───────────
  const plansBruts = Array.isArray(brut.plans) ? brut.plans : [];
  let plans: PlanRecit[] = plansBruts
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const incrustation = texte(o.incrustation, 120);
      return {
        narration: sansEmoji(texte(o.narration, 2000)),
        image: texte(o.image, 500),
        recherche: texte(o.recherche, 200),
        ...(incrustation ? { incrustation } : {}),
      };
    })
    .filter((p) => p.narration.length > 0);

  if (!script && plans.length) {
    script = plans.map((p) => p.narration).join(" ");
    notes.push("Le champ script manquait — reconstruit depuis les plans.");
  }

  // Plancher relatif à la durée demandée : la génération réelle du 2026-08-06
  // a rendu 59 mots pour une cible de 110 — trop maigre pour tenir 45 s à
  // l'écran. Sous 60 % de la cible, on relance plutôt que de livrer creux.
  const plancher = Math.max(30, Math.round(cible.mots * 0.6));
  if (compterMots(script) < plancher) {
    throw new RecitInutilisable(
      `script trop court (${compterMots(script)} mots, minimum ${plancher}) pour un reel de ${cible.secondes} s`
    );
  }

  if (plans.length) {
    const concat = normaliserEspace(plans.map((p) => p.narration).join(" "));
    if (concat === normaliserEspace(script)) {
      // Garantit l'égalité STRICTE : le script devient la concaténation exacte.
      script = plans.map((p) => p.narration).join(" ");
    } else {
      // Le modèle a réécrit au lieu de découper : on redécoupe nous-mêmes.
      const fragments = decouperEnPlans(script, plans.length || cible.plans);
      plans = fragments.map((narration, i) => ({
        narration,
        image: plans[i]?.image || "Plan d'illustration sobre en lien avec la narration.",
        recherche: plans[i]?.recherche || `${input.sujet} archive photo`,
        ...(plans[i]?.incrustation ? { incrustation: plans[i]!.incrustation } : {}),
      }));
      notes.push(
        "Les plans renvoyés ne redonnaient pas le script mot pour mot — redécoupés automatiquement, vérifie leur alignement avec les images."
      );
    }
  } else {
    plans = decouperEnPlans(script, cible.plans).map((narration) => ({
      narration,
      image: "Plan d'illustration sobre en lien avec la narration.",
      recherche: `${input.sujet} archive photo`,
    }));
    notes.push("Les plans manquaient — construits automatiquement depuis le script.");
  }

  // ── Champs simples ────────────────────────────────────────────────────────
  const titre = texte(brut.titre, 160) || input.sujet.slice(0, 80);
  let accroches = listeTextes(brut.accroches, 3, 300);
  if (!accroches.length) {
    accroches = [titre];
    notes.push("Les accroches manquaient — le titre sert d'accroche unique.");
  }

  let dureeSecondes = typeof brut.duree_secondes === "number" ? Math.round(brut.duree_secondes) : NaN;
  if (!Number.isFinite(dureeSecondes) || dureeSecondes < 10 || dureeSecondes > 600) {
    // 150 mots parlés par minute (§5).
    dureeSecondes = Math.round((compterMots(script) / 150) * 60);
  }

  // ── Hashtags : 6 à 9, dièse compris ───────────────────────────────────────
  const defauts = [
    "#histoire",
    "#afrique",
    `#${input.angle}`,
    ...(input.pays ? [`#${input.pays.toLowerCase().replace(/[^a-z0-9]/gi, "")}`] : []),
    "#histoirevraie",
    "#scarabeenoir",
  ];
  const hashtags = Array.from(
    new Set(
      [...listeTextes(brut.hashtags, 12, 60), ...defauts]
        .map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""))
        .filter((h) => h.length > 1)
    )
  ).slice(0, 9);

  // ── Réponses aux commentaires ─────────────────────────────────────────────
  const reponses = (Array.isArray(brut.reponses) ? brut.reponses : [])
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { commentaire: texte(o.commentaire, 300), reponse: texte(o.reponse, 500) };
    })
    .filter((r) => r.commentaire && r.reponse)
    .slice(0, 5);
  if (reponses.length < 5) {
    notes.push(`Seulement ${reponses.length} réponse(s) aux commentaires fournies (5 attendues).`);
  }

  // ── TikTok ────────────────────────────────────────────────────────────────
  const tiktokBrut = (brut.tiktok ?? {}) as Record<string, unknown>;
  const tiktok = {
    accroche: sansEmoji(texte(tiktokBrut.accroche, 300)) || accroches[0],
    script: sansEmoji(texte(tiktokBrut.script, 6000)) || script,
  };
  if (!texte(tiktokBrut.script)) {
    notes.push("La version TikTok manquait — le script Facebook est réutilisé tel quel.");
  }

  // ── a_verifier : JAMAIS vide (§6.2) ──────────────────────────────────────
  const aVerifier = listeTextes(brut.a_verifier, 12, 500);
  if (!aVerifier.length) aVerifier.push(VERIF_DEFAUT);
  aVerifier.push(...notes);

  // Phrases interdites restées malgré la consigne : signalées, jamais fatales.
  for (const phrase of phrasesInterditesPresentes(script)) {
    aVerifier.push(`Le script contient « ${phrase} » — reformule avant de publier.`);
  }

  return {
    accroches,
    titre,
    script,
    duree_secondes: dureeSecondes,
    plans,
    description: texte(brut.description, 3000) || `${titre}\n\nAbonne-toi pour la suite.`,
    question: texte(brut.question, 300) || "À ton avis, que s'est-il vraiment passé ?",
    hashtags,
    reponses,
    tiktok,
    a_verifier: aVerifier,
    prochains_sujets: listeTextes(brut.prochains_sujets, 3, 200),
  };
}
