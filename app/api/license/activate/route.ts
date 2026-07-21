import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { LicenseService } from "@/services/license-service";
import { z } from "zod";

const schema = z.object({
  license_key: z.string().min(6).max(200),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    const body = schema.parse(await request.json());
    const license = await new LicenseService(db).activateForUser(user.id, body.license_key);
    return apiSuccess({
      status: license.status,
      product: license.product?.name ?? null,
      expires_at: license.expires_at ?? null,
      masked_key: license.license.masked_key ?? null,
      is_active: license.is_active,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", "Clé de licence invalide", 400));
    }
    return apiError(e);
  }
}
