import { completeJson, hasTextProviderKey } from "@/services/ai/openai-provider";
import { gatherWebResearch } from "@/services/ai/research";
import {
  extraireJson,
  normaliserRecit,
  phrasesInterditesPresentes,
} from "@/services/griot/normalize";
import {
  buildRecitRetryPrompt,
  buildRecitSystemPrompt,
  buildRecitUserPrompt,
} from "@/services/griot/prompts";
import { recitMock } from "@/services/griot/mock";
import {
  RecitInutilisable,
  ReponseIllisible,
  type Recit,
  type RecitInput,
} from "@/services/griot/types";
import { AppError } from "@/lib/errors";

export function moteurDisponible(): boolean {
  return process.env.MOCK_AI === "true" || hasTextProviderKey();
}

/**
 * Génère un récit complet. Fiabilité (§7) :
 * - Groq d'abord, OpenAI en secours (dans completeJson) ;
 * - une réponse inutilisable déclenche UNE relance avec consigne resserrée —
 *   jamais la même requête répétée en boucle ;
 * - le format modèle n'est jamais cru sur parole : tout passe par normaliserRecit.
 */
export async function genererRecit(input: RecitInput): Promise<Recit> {
  if (process.env.MOCK_AI === "true") return recitMock(input);
  if (!hasTextProviderKey()) {
    // Refuser AVANT de débiter (§7.3) — la route vérifie moteurDisponible(),
    // ceci est le dernier filet.
    throw new AppError("INTERNAL_ERROR", "Aucun fournisseur de texte configuré.", 503);
  }

  const recherche = await gatherWebResearch(
    [input.sujet, input.pays].filter(Boolean).join(" ")
  ).catch(() => null);

  const messages = [
    { role: "system" as const, content: buildRecitSystemPrompt() },
    { role: "user" as const, content: buildRecitUserPrompt(input, recherche?.context) },
  ];

  let contenu: string;
  try {
    contenu = await completeJson({
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError("GENERATION_FAILED", `Le modèle n'a pas répondu : ${msg.slice(0, 160)}`, 502);
  }

  try {
    return produireRecit(contenu, input);
  } catch (err) {
    if (!(err instanceof RecitInutilisable || err instanceof ReponseIllisible)) throw err;
    console.warn(`[griot] réponse inutilisable (${err.message}) — relance resserrée`);
    let secondContenu: string;
    try {
      secondContenu = await completeJson({
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          ...messages,
          { role: "assistant" as const, content: contenu.slice(0, 2000) },
          { role: "user" as const, content: buildRecitRetryPrompt(err.message) },
        ],
      });
    } catch (relanceErr) {
      const msg = relanceErr instanceof Error ? relanceErr.message : String(relanceErr);
      throw new AppError("GENERATION_FAILED", `Relance échouée : ${msg.slice(0, 160)}`, 502);
    }
    try {
      // Souple après relance : une phrase interdite restante n'est jamais
      // fatale (§7.4) — elle est signalée dans a_verifier par le normaliseur.
      return produireRecit(secondContenu, input, { strict: false });
    } catch (finalErr) {
      const msg = finalErr instanceof Error ? finalErr.message : String(finalErr);
      throw new AppError(
        "GENERATION_FAILED",
        `Récit inutilisable après relance : ${msg.slice(0, 160)}`,
        502
      );
    }
  }
}

function produireRecit(
  contenu: string,
  input: RecitInput,
  opts: { strict: boolean } = { strict: true }
): Recit {
  const recit = normaliserRecit(extraireJson(contenu), input);
  if (opts.strict) {
    const interdites = phrasesInterditesPresentes(recit.script);
    if (interdites.length) {
      // Détection, pas soustraction (§7.6) : on relance une fois via l'appelant.
      throw new RecitInutilisable(`le script contient : ${interdites.join(", ")}`);
    }
  }
  return recit;
}
