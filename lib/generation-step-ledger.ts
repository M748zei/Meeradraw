import type { Firestore } from "firebase-admin/firestore";
import { firestoreSafe } from "@/lib/firestore-sanitize";

export type GenerationStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying";

export type GenerationStepRecord = {
  step_key: string;
  status: GenerationStepStatus;
  started_at: string | null;
  finished_at: string | null;
  provider: string | null;
  request_id: string | null;
  attempt: number;
  duration_ms: number | null;
  error_code: string | null;
  sanitized_error_message: string | null;
  idempotency_key: string;
  updated_at: string;
};

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Erreur");
  return raw
    .replace(/https?:\/\/[^\s)"']+/gi, "[url]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/fal[-_]?key[^\s]*\s*[:=]\s*\S+/gi, "fal_key=[redacted]")
    .replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/gi, "[image]")
    .slice(0, 280);
}

export function stepIdempotencyKey(
  generationId: string,
  stepKey: string,
  attempt: number,
  pageId?: string | null
) {
  return [
    "gen",
    generationId,
    "step",
    stepKey,
    pageId ? `page:${pageId}` : "book",
    `attempt:${attempt}`,
  ].join(":");
}

/**
 * Persist durable per-step status under generations/{id}/steps/{stepKey}.
 * Safe to call repeatedly — last write wins for the same step key.
 *
 * `attempt` must be the real Workflow attempt (`getStepMetadata().attempt`) when
 * called from a step — never hardcode 1 if the runtime exposes retries.
 * `requestId` is only written when a provider request id is known; Workflow's
 * stepId is not a fal request id and must not be invented here.
 */
export async function persistGenerationStep(
  db: Firestore,
  generationId: string,
  input: {
    stepKey: string;
    status: GenerationStepStatus;
    attempt?: number;
    provider?: string | null;
    requestId?: string | null;
    errorCode?: string | null;
    error?: unknown;
    pageId?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    durationMs?: number | null;
  }
): Promise<GenerationStepRecord> {
  const now = new Date().toISOString();
  const attempt = Math.max(1, input.attempt ?? 1);
  const ref = db
    .collection("generations")
    .doc(generationId)
    .collection("steps")
    .doc(input.pageId ? `${input.stepKey}__${input.pageId}` : input.stepKey);

  const previous = await ref.get();
  const prev = previous.exists ? (previous.data() as Partial<GenerationStepRecord>) : {};
  const startedAt =
    input.startedAt ??
    (input.status === "running"
      ? now
      : (prev.started_at as string | null | undefined) ?? null);
  const finishedAt =
    input.finishedAt ??
    (input.status === "succeeded" || input.status === "failed" ? now : null);
  const durationMs =
    input.durationMs ??
    (startedAt && finishedAt
      ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
      : null);

  const record: GenerationStepRecord = {
    step_key: input.stepKey,
    status: input.status,
    started_at: startedAt,
    finished_at: finishedAt,
    provider: input.provider ?? (prev.provider as string | null | undefined) ?? null,
    request_id:
      input.requestId ?? (prev.request_id as string | null | undefined) ?? null,
    attempt,
    duration_ms: durationMs,
    error_code: input.errorCode ?? null,
    sanitized_error_message: input.error ? sanitizeErrorMessage(input.error) : null,
    idempotency_key: stepIdempotencyKey(
      generationId,
      input.stepKey,
      attempt,
      input.pageId
    ),
    updated_at: now,
  };

  await ref.set(firestoreSafe(record), { merge: true });
  return record;
}

export function classifyGenerationError(err: unknown): {
  code: string;
  permanent: boolean;
} {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/Exhausted balance|User is locked|feature_not_supported|invalid_request|422/i.test(msg)) {
    return { code: "PROVIDER_PERMANENT", permanent: true };
  }
  if (/strict visual quality gate|Premium .* failed|Premium cover|Premium character/i.test(msg)) {
    return { code: "QUALITY_GATE", permanent: true };
  }
  if (/timeout|ETIMEDOUT|AbortError|délai dépassé|ECONNRESET|503|429|RATE_LIMIT/i.test(msg)) {
    return { code: "PROVIDER_TRANSIENT", permanent: false };
  }
  if (/expired|URL.*inaccessible|ENOTFOUND|fetch failed/i.test(msg)) {
    return { code: "REFERENCE_URL", permanent: true };
  }
  return { code: "GENERATION_ERROR", permanent: false };
}
