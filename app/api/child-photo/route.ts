import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { StorageService } from "@/services/storage-service";
import { randomUUID } from "crypto";
import { z } from "zod";

export const maxDuration = 30;

const schema = z.object({
  /** data URL or raw base64 */
  imageBase64: z.string().min(40).max(8_000_000),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
});

/**
 * Upload a child's photo for parent-create identity (model sheet likeness).
 * Accepts base64 / data-URL; stores under users/{uid}/child-refs/.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    rateLimit(`child-photo:${user.id}`, { limit: 10, windowMs: 60_000 });
    const body = schema.parse(await request.json());

    let raw = body.imageBase64.trim();
    let contentType = body.contentType;
    const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(raw);
    if (dataUrl) {
      contentType = dataUrl[1].toLowerCase() as typeof contentType;
      raw = dataUrl[2];
    }
    const bytes = Buffer.from(raw.replace(/\s/g, ""), "base64");
    if (bytes.length < 500 || bytes.length > 5_500_000) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Photo trop petite ou trop lourde (max ~5 Mo).",
        400
      );
    }

    const ext =
      contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const path = `users/${user.id}/child-refs/${randomUUID()}.${ext}`;
    const url = await new StorageService().uploadBytes(path, bytes, contentType);
    return apiSuccess({ url, path });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(
        new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Photo invalide", 400)
      );
    }
    return apiError(e);
  }
}
