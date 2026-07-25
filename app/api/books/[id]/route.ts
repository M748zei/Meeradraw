import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { BookService } from "@/services/book-service";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    return apiSuccess(await new BookService(db).getWithPages(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  subtitle: z.string().max(200).optional(),
  // cover_image intentionally omitted — only the generation pipeline may set it
  // (arbitrary URLs would enable SSRF through PDF export).
  // Runtime states are owned by the generation pipeline. The public update API
  // may only move a book out of the active library.
  status: z.enum(["archived"]).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    const body = patchSchema.parse(await request.json());
    return apiSuccess(await new BookService(db).update(user.id, id, body));
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
    await new BookService(db).remove(user.id, id);
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e);
  }
}
