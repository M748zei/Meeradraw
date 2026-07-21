import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebase/admin";
import { LicenseService } from "@/services/license-service";
import { timingSafeEqual } from "crypto";

/**
 * Chariow Pulse webhook receiver — primary license-sync path.
 *
 * Configure the Pulse URL (Automation → Pulses) to: {APP_URL}/api/webhooks/chariow
 * and subscribe to: license.issued, license.activated, license.expired,
 * license.revoked (and optionally successful.sale / failed.sale).
 *
 * Chariow does not sign Pulse payloads (HTTPS-only, per docs). We add a shared
 * secret as a defense-in-depth check: put the same random string in
 * CHARIOW_WEBHOOK_SECRET and in the Pulse URL as `?token=<secret>` (or send it
 * in an `x-chariow-signature` / `authorization` header). The comparison is
 * constant-time. In production the endpoint fails CLOSED when no secret is set.
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

export async function POST(request: Request) {
  try {
    const secret = process.env.CHARIOW_WEBHOOK_SECRET?.trim();

    if (secret) {
      const url = new URL(request.url);
      const tokenParam = url.searchParams.get("token");
      const sigHeader = request.headers.get("x-chariow-signature");
      const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const ok =
        constantTimeMatch(tokenParam, secret) ||
        constantTimeMatch(sigHeader, secret) ||
        constantTimeMatch(authHeader, secret);
      if (!ok) {
        throw new AppError("FORBIDDEN", "Signature webhook invalide", 403);
      }
    } else if (process.env.NODE_ENV === "production") {
      // Fail closed: never accept unauthenticated webhooks in production.
      throw new AppError(
        "FORBIDDEN",
        "Webhook non configuré (CHARIOW_WEBHOOK_SECRET requis).",
        403
      );
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const result = await new LicenseService(getAdminDb()).handleWebhookEvent(payload);
    return apiSuccess(result);
  } catch (e) {
    return apiError(e);
  }
}
