import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess } from "@/lib/errors";
import { FREE_TRIALS_MAX, FREE_TRIAL_MAX_PAGES } from "@/config/credits";
import { LicenseService } from "@/services/license-service";

export async function GET() {
  try {
    const { db, user, profile } = await requireUser();
    const status = await new LicenseService(db).getStatus(user.id, user.email);
    const used = profile.free_trials_used ?? 0;
    const max = profile.free_trials_max ?? FREE_TRIALS_MAX;
    return apiSuccess({
      ...status,
      trials: {
        used,
        max,
        remaining: Math.max(0, max - used),
        max_pages: FREE_TRIAL_MAX_PAGES,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
