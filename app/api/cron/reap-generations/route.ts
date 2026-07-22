import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebase/admin";
import { reapStaleGenerations } from "@/services/generation-reaper";

/**
 * Daily sweep (vercel.json cron) for generations stranded in queued/running.
 * Authenticated with CRON_SECRET (Vercel sends `Authorization: Bearer <secret>`
 * to cron routes when the env var is set). Fail-closed in production.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (secret) {
      if (auth !== secret) throw new AppError("FORBIDDEN", "Accès refusé", 403);
    } else if (process.env.NODE_ENV === "production") {
      throw new AppError("FORBIDDEN", "CRON_SECRET non configuré", 403);
    }
    const reaped = await reapStaleGenerations(getAdminDb());
    return apiSuccess({ reaped });
  } catch (e) {
    return apiError(e);
  }
}
