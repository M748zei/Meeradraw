import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { BookService } from "@/services/book-service";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser();
    const universeId = new URL(request.url).searchParams.get("universe_id") ?? undefined;
    return apiSuccess(await new BookService(db).list(user.id, universeId));
  } catch (e) {
    return apiError(e);
  }
}

const createSchema = z.object({
  universe_id: z.string().uuid(),
  idea: z.string().min(10).max(4000),
  original_idea: z.string().max(4000).optional(),
  enrichment: z
    .object({
      title: z.string().max(120).optional(),
      synopsis: z.string().max(2000).optional(),
      castHints: z.array(z.string().max(200)).max(8).optional(),
      beats: z.array(z.string().max(300)).max(8).optional(),
    })
    .optional(),
  type: z.enum(["colorbook", "storybook", "activitybook", "workbook"]).default("colorbook"),
  page_count: z.number().int().min(4).max(25).default(12),
  style: z.string().default("cute"),
  title: z.string().max(120).optional(),
  audience: z.string().max(80).optional(),
  audience_age: z.string().max(40).optional(),
  child_name: z.string().max(60).optional(),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    const body = createSchema.parse(await request.json());
    return apiSuccess(await new BookService(db).create(user.id, body), 201);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
