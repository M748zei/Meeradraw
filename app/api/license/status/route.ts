import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess } from "@/lib/errors";
import { LicenseService } from "@/services/license-service";

export async function GET() {
  try {
    const { db, user } = await requireUser();
    const status = await new LicenseService(db).getStatus(user.id, user.email);
    return apiSuccess(status);
  } catch (e) {
    return apiError(e);
  }
}
