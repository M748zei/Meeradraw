import { AppError } from "@/lib/errors";
import { detectProviderOutage } from "@/lib/generation-errors";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Cheap provider-outage circuit breaker.
 *
 * When a generation dies on a provider-level outage (fal balance exhausted,
 * LLM quota), the failure is recorded in `system/provider_health`. For the next
 * PROVIDER_OUTAGE_TTL_MS, `generation/start` refuses new runs with a clear 503
 * BEFORE reserving credits — instead of the reserve → fail → refund churn.
 * The flag expires on its own (TTL), so a topped-up account resumes without
 * manual intervention.
 */

const HEALTH_DOC = "system/provider_health" as const;

function ttlMs() {
  const n = Number(process.env.PROVIDER_OUTAGE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60_000;
}

export async function recordProviderOutage(db: Firestore, err: unknown) {
  const kind = detectProviderOutage(err);
  if (!kind) return;
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  console.warn(`[provider-outage] ${kind}: ${message}`);
  try {
    await db.doc(HEALTH_DOC).set(
      { kind, message, at: new Date().toISOString() },
      { merge: true }
    );
  } catch (writeErr) {
    console.error("recordProviderOutage write failed", writeErr);
  }
}

export async function assertProvidersHealthy(db: Firestore) {
  let data: FirebaseFirestore.DocumentData | undefined;
  try {
    data = (await db.doc(HEALTH_DOC).get()).data();
  } catch {
    return; // fail-open: a health-check hiccup must not block the studio
  }
  if (!data) return;
  const at = typeof data.at === "string" ? Date.parse(data.at) : NaN;
  if (Number.isNaN(at) || Date.now() - at > ttlMs()) return;
  const message =
    data.kind === "fal_balance"
      ? "Le service d'illustration est momentanément indisponible. Réessaie dans quelques minutes — aucun crédit n'a été débité."
      : "Le studio est très demandé en ce moment. Réessaie dans quelques minutes — aucun crédit n'a été débité.";
  throw new AppError("GENERATION_FAILED", message, 503);
}
