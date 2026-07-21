import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { UniverseService } from "@/services/universe-service";
import { z } from "zod";

export async function GET() {
  try {
    const { db, user } = await requireUser();
    const service = new UniverseService(db);
    return apiSuccess(await service.list(user.id));
  } catch (e) {
    return apiError(e);
  }
}

const createSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  language: z.string().default("fr"),
  audience_age: z.string().max(40).optional(),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    const body = createSchema.parse(await request.json());
    const service = new UniverseService(db);
    return apiSuccess(await service.create(user.id, body), 201);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
