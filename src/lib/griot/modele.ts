import { promptRecit, promptSysteme } from './prompt';
import type { DemandeRecit, Recit } from './types';

/**
 * L'appel au modèle de texte.
 *
 * Deux fournisseurs, dans cet ordre : Groq (rapide et bon marché) puis OpenAI.
 * MeeraDraw a montré la règle : un fournisseur unique tombe, et tout tombe avec
 * lui — un 429 de Groq y suffisait à tuer une génération payée. Ici le second
 * prend le relais sans que la personne le sache.
 *
 * Griot ne produit que du TEXTE. Pas d'images, donc pas de budget d'images, pas
 * de juge visuel, pas de filtre de contenu qui refuse une anatomie d'enfant.
 * C'est ce choix-là qui rend l'outil fiable.
 */

type Fournisseur = {
  nom: string;
  url: string;
  cle: string | undefined;
  modele: string;
};

function fournisseurs(): Fournisseur[] {
  return [
    {
      nom: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      cle: process.env.GROQ_API_KEY,
      modele: process.env.GRIOT_MODELE_GROQ || 'openai/gpt-oss-120b',
    },
    {
      nom: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      cle: process.env.OPENAI_API_KEY,
      modele: process.env.GRIOT_MODELE_OPENAI || 'gpt-4o-mini',
    },
  ].filter((f) => Boolean(f.cle));
}

export function modeleDisponible(): boolean {
  return fournisseurs().length > 0;
}

/** Le modèle renvoie parfois le JSON emballé dans des ``` malgré la consigne. */
function extraireJson(brut: string): unknown {
  const nettoye = brut
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(nettoye);
  } catch {
    // Dernier recours : le premier objet complet du texte.
    const debut = nettoye.indexOf('{');
    const fin = nettoye.lastIndexOf('}');
    if (debut >= 0 && fin > debut) {
      return JSON.parse(nettoye.slice(debut, fin + 1));
    }
    throw new Error('JSON_ILLISIBLE');
  }
}

const TEXTE = (v: unknown, defaut = '') =>
  typeof v === 'string' && v.trim() ? v.trim() : defaut;

const LISTE_TEXTE = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => TEXTE(x)).filter(Boolean) : [];

/**
 * On ne fait jamais confiance à la forme renvoyée par un modèle.
 *
 * Un champ manquant ne doit pas casser l'affichage : il doit disparaître
 * proprement. Un récit à qui il manque les hashtags reste un récit utilisable ;
 * un récit qui fait planter la page ne l'est pas.
 */
function normaliser(brut: unknown): Recit {
  const o = (brut ?? {}) as Record<string, unknown>;

  const plans = Array.isArray(o.plans)
    ? o.plans
        .map((p) => {
          const q = (p ?? {}) as Record<string, unknown>;
          return {
            narration: TEXTE(q.narration),
            image: TEXTE(q.image),
            recherche: TEXTE(q.recherche),
            incrustation: TEXTE(q.incrustation) || undefined,
          };
        })
        .filter((p) => p.narration || p.image)
    : [];

  const reponses = Array.isArray(o.reponses)
    ? o.reponses
        .map((r) => {
          const q = (r ?? {}) as Record<string, unknown>;
          return { commentaire: TEXTE(q.commentaire), reponse: TEXTE(q.reponse) };
        })
        .filter((r) => r.commentaire && r.reponse)
    : [];

  const tk = (o.tiktok ?? {}) as Record<string, unknown>;
  const script = TEXTE(o.script);

  // Si le modèle n'a pas chiffré la durée, on l'estime : une narration posée
  // tourne autour de 150 mots par minute.
  const motsScript = script ? script.split(/\s+/).length : 0;
  const dureeAnnoncee = Number(o.duree_secondes);
  const duree =
    Number.isFinite(dureeAnnoncee) && dureeAnnoncee > 5
      ? Math.round(dureeAnnoncee)
      : Math.max(15, Math.round((motsScript / 150) * 60));

  const hashtags = LISTE_TEXTE(o.hashtags).map((h) => (h.startsWith('#') ? h : `#${h}`));

  return {
    accroches: LISTE_TEXTE(o.accroches).slice(0, 3),
    titre: TEXTE(o.titre),
    script,
    duree_secondes: duree,
    plans,
    description: TEXTE(o.description),
    question: TEXTE(o.question),
    hashtags,
    reponses,
    tiktok: { accroche: TEXTE(tk.accroche), script: TEXTE(tk.script) },
    // Jamais vide : si le modèle n'a rien signalé, on rappelle la règle.
    a_verifier: LISTE_TEXTE(o.a_verifier).length
      ? LISTE_TEXTE(o.a_verifier)
      : ['Recoupe les dates, les noms et les montants avec une source avant de publier.'],
    prochains_sujets: LISTE_TEXTE(o.prochains_sujets).slice(0, 3),
  };
}

/** Un récit est utilisable s'il a de quoi être filmé ce soir. */
export function recitUtilisable(r: Recit): boolean {
  return Boolean(r.titre && r.script.length > 120 && r.plans.length >= 3 && r.description);
}

export async function genererRecit(d: DemandeRecit): Promise<Recit> {
  const liste = fournisseurs();
  if (!liste.length) throw new Error('AUCUNE_CLE_MODELE');

  let derniere: unknown = null;

  for (const f of liste) {
    try {
      const controleur = new AbortController();
      const minuteur = setTimeout(() => controleur.abort(), 90_000);

      let reponse: Response;
      try {
        reponse = await fetch(f.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${f.cle}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: f.modele,
            temperature: 0.7,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: promptSysteme() },
              { role: 'user', content: promptRecit(d) },
            ],
          }),
          signal: controleur.signal,
        });
      } finally {
        clearTimeout(minuteur);
      }

      if (!reponse.ok) {
        derniere = new Error(`${f.nom} ${reponse.status}`);
        console.warn(`[griot] ${f.nom} a répondu ${reponse.status} — bascule sur le suivant`);
        continue;
      }

      const donnees = (await reponse.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const contenu = donnees.choices?.[0]?.message?.content ?? '';
      if (!contenu) {
        derniere = new Error(`${f.nom} vide`);
        continue;
      }

      const recit = normaliser(extraireJson(contenu));
      if (!recitUtilisable(recit)) {
        derniere = new Error(`${f.nom} incomplet`);
        console.warn(`[griot] ${f.nom} a renvoyé un récit incomplet — bascule sur le suivant`);
        continue;
      }
      return recit;
    } catch (err) {
      derniere = err;
      console.warn(`[griot] ${f.nom} a échoué`, err);
    }
  }

  throw derniere instanceof Error ? derniere : new Error('GENERATION_IMPOSSIBLE');
}
