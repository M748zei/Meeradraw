import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { UniverseService } from "@/services/universe-service";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    return apiSuccess(await new UniverseService(db).get(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}

const patchSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  language: z.string().optional(),
  audience_age: z.string().optional(),
  // cover_image omitted — set only by the generation pipeline.
  visibility: z.enum(["private", "public"]).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    const body = patchSchema.parse(await request.json());
    return apiSuccess(await new UniverseService(db).update(user.id, id, body));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    await new UniverseService(db).remove(user.id, id);
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e);
  }
}
