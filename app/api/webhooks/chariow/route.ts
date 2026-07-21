import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebase/admin";
import { LicenseService } from "@/services/license-service";

/**
 * Chariow webhook receiver — primary sync path.
 * Configure store webhook URL to: /api/webhooks/chariow
 * Events: sale, license.*, subscription.*, refund, etc.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.CHARIOW_WEBHOOK_SECRET;
    if (secret) {
      const header =
        request.headers.get("x-chariow-signature") ||
        request.headers.get("authorization");
      if (!header || !header.includes(secret)) {
        throw new AppError("FORBIDDEN", "Signature webhook invalide", 403);
      }
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const result = await new LicenseService(getAdminDb()).handleWebhookEvent(payload);
    return apiSuccess(result);
  } catch (e) {
    return apiError(e);
  }
}
