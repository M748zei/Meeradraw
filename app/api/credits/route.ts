import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess } from "@/lib/errors";
import { CreditService } from "@/services/credit-service";
import { LicenseService } from "@/services/license-service";

export async function GET() {
  try {
    const { db, user, profile } = await requireUser();
    const history = await new CreditService(db).history(user.id);
    const isAdmin = LicenseService.isAdminEmail(user.email ?? profile?.email);
    return apiSuccess({
      balance: profile?.credits ?? 0,
      history,
      is_admin: isAdmin,
    });
  } catch (e) {
    return apiError(e);
  }
}
