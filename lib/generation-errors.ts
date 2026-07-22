/**
 * Maps raw provider errors (fal.ai, Groq) to actionable French messages and to
 * an outage kind used by the provider-health pre-flight, so a burned fal
 * balance or an exhausted Groq quota never surfaces as an opaque English blob.
 */

export type ProviderOutageKind = "fal_balance" | "llm_quota" | null;

export function detectProviderOutage(err: unknown): ProviderOutageKind {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/exhausted balance|user is locked|top up your balance/i.test(msg)) {
    return "fal_balance";
  }
  if (/rate limit|tokens per (day|minute)|\bTPD\b|\bTPM\b|429/i.test(msg)) {
    return "llm_quota";
  }
  return null;
}

export function friendlyGenerationError(err: unknown): string {
  const kind = detectProviderOutage(err);
  if (kind === "fal_balance") {
    return "Le service d'illustration est momentanément indisponible. Tes crédits ont été remboursés — réessaie un peu plus tard.";
  }
  if (kind === "llm_quota") {
    return "Le studio est très demandé en ce moment. Tes crédits ont été remboursés — réessaie dans quelques minutes.";
  }
  const msg = err instanceof Error ? err.message : "Erreur inconnue";
  if (/story outline missing pages/i.test(msg)) {
    return "L'histoire n'a pas pu être structurée cette fois. Tes crédits ont été remboursés — réessaie dans quelques minutes.";
  }
  return msg;
}
