import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { verifyChariowWebhookSignature } from "@/lib/chariow/client";
import { getAdminDb } from "@/lib/firebase/admin";
import { LicenseService } from "@/services/license-service";
import { applyChariowSale, reverseChariowSale, extractSale } from "@/services/chariow-sale";
import {
  markPurchaseRefunded,
  parkPendingAccessFromWebhook,
} from "@/services/access-open";
import { timingSafeEqual } from "crypto";

/**
 * Chariow Pulse webhook receiver.
 *
 * Configure (Automation → Pulses):
 *   URL: {APP_URL}/api/webhooks/chariow?token={CHARIOW_WEBHOOK_SECRET}
 *   Events (official names):
 *     successful.sale, failed.sale, abandoned.sale,
 *     license.issued, license.activated, license.expired, license.revoked
 *
 * Auth (any one):
 *   1. HMAC-SHA256 of raw body in `x-chariow-signature` (official best practice)
 *   2. Shared secret as `?token=` / Bearer / exact `x-chariow-signature` value
 *
 * Production fails closed when CHARIOW_WEBHOOK_SECRET is unset.
 */
export const maxDuration = 60;

function constantTimeMatch(candidate: string | null | undefined, secret: string) {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function authorizeWebhook(request: Request, rawBody: string, secret: string) {
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");
  const sigHeader = request.headers.get("x-chariow-signature");
  const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (verifyChariowWebhookSignature(rawBody, sigHeader, secret)) return true;
  if (constantTimeMatch(tokenParam, secret)) return true;
  if (constantTimeMatch(authHeader, secret)) return true;
  // Exact shared-secret header (legacy) — only if it is NOT a hex HMAC lookalike mismatch
  if (sigHeader && !/^[a-f0-9]{64}$/i.test(sigHeader) && constantTimeMatch(sigHeader, secret)) {
    return true;
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const secret = process.env.CHARIOW_WEBHOOK_SECRET?.trim();
    const rawBody = await request.text();

    if (secret) {
      if (!authorizeWebhook(request, rawBody, secret)) {
        throw new AppError("FORBIDDEN", "Signature webhook invalide", 403);
      }
    } else if (process.env.NODE_ENV === "production") {
      throw new AppError(
        "FORBIDDEN",
        "Webhook non configuré (CHARIOW_WEBHOOK_SECRET requis).",
        403
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    } catch {
      throw new AppError("VALIDATION_ERROR", "Payload webhook invalide", 400);
    }

    const db = getAdminDb();
    const result = await new LicenseService(db).handleWebhookEvent(payload);

    const event = String(payload?.event || payload?.type || "").toLowerCase();
    let sale: Awaited<ReturnType<typeof applyChariowSale>> | null = null;
    let reversal: Awaited<ReturnType<typeof reverseChariowSale>> | null = null;
    let pendingAccess: Awaited<ReturnType<typeof parkPendingAccessFromWebhook>> | null = null;

    if (event === "successful.sale" || event === "license.issued") {
      pendingAccess = await parkPendingAccessFromWebhook(db, payload);
    }

    if (event === "successful.sale") {
      sale = await applyChariowSale(db, payload);
    } else if (
      event.includes("refund") ||
      event.includes("cancel") ||
      event === "failed.sale"
    ) {
      // Official Pulse sale events: failed.sale (+ any future refund/cancel labels).
      // license.revoked is handled by LicenseService (access flipped inactive).
      reversal = await reverseChariowSale(db, payload);
      const { saleId } = extractSale(payload);
      await markPurchaseRefunded(db, saleId);
    } else if (event === "license.revoked") {
      const { saleId } = extractSale(payload);
      if (saleId) await markPurchaseRefunded(db, saleId);
    }

    return apiSuccess({
      ...result,
      ...(sale ? { sale } : {}),
      ...(reversal ? { reversal } : {}),
      ...(pendingAccess ? { pendingAccess } : {}),
    });
  } catch (e) {
    return apiError(e);
  }
}
