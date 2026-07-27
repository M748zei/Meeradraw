/**
 * Pure claim decision for POST /api/generation/start.
 *
 * Free retries are NEVER inferred silently from free_retry_available alone when
 * the client asked for a paid recreate — and a "sans frais" client MUST send
 * require_free_retry:true so a missing flag returns 409 instead of billing 18.
 */

export type GenerationStartClaimInput = {
  isTrial: boolean;
  estimatedCost: number;
  freeRetryAvailable: boolean;
  /** Client explicitly requested the compensated free restart button. */
  requireFreeRetry: boolean;
};

export type GenerationStartClaim =
  | { ok: true; cost: number; freeRetry: boolean }
  | {
      ok: false;
      code: "FREE_RETRY_UNAVAILABLE";
      message: string;
    };

export const FREE_RETRY_UNAVAILABLE_MESSAGE =
  "La tentative gratuite n’est plus disponible. Recrée le livre avec des crédits, ou retourne au livre.";

/**
 * Decide reservation cost for a new generation claim.
 * Trials are always free. Paid recreates never auto-consume free_retry_available.
 */
export function resolveGenerationStartClaim(
  input: GenerationStartClaimInput
): GenerationStartClaim {
  if (input.isTrial) {
    return { ok: true, cost: 0, freeRetry: false };
  }

  if (input.requireFreeRetry) {
    if (!input.freeRetryAvailable) {
      return {
        ok: false,
        code: "FREE_RETRY_UNAVAILABLE",
        message: FREE_RETRY_UNAVAILABLE_MESSAGE,
      };
    }
    return { ok: true, cost: 0, freeRetry: true };
  }

  return {
    ok: true,
    cost: Math.max(0, Math.floor(input.estimatedCost)),
    freeRetry: false,
  };
}

/**
 * Book fields to restore after a free-retry workflow hand-off fails before the
 * durable run actually starts — so an infra blip does not consume the only free try.
 */
export function bookFieldsAfterFreeRetryLaunchFailure(input: {
  freeRetryWasClaimed: boolean;
  compensated: boolean;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    status: "draft",
    active_generation_id: null,
  };
  if (input.freeRetryWasClaimed && input.compensated) {
    fields.free_retry_available = true;
  }
  return fields;
}
