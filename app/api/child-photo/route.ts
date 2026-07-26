import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { detectImageFormat } from "@/lib/image-format";
import { rateLimitAsync } from "@/lib/rate-limit-store";
import { StorageService } from "@/services/storage-service";
import { randomUUID } from "crypto";
import { z } from "zod";

export const maxDuration = 30;

const MAX_JSON_BYTES = 4_100_000;

const schema = z.object({
  /** data URL or raw base64 */
  imageBase64: z.string().min(40).max(4_000_000),
  contentType: z
    .enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
    .default("image/jpeg"),
});

async function readLimitedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_BYTES) {
    throw new AppError("VALIDATION_ERROR", "Photo trop lourde. La photo doit être compressée avant l’envoi.", 400);
  }
  if (!request.body) {
    throw new AppError("VALIDATION_ERROR", "Photo manquante.", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      throw new AppError("VALIDATION_ERROR", "Photo trop lourde (max ~5 Mo).", 400);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError("VALIDATION_ERROR", "Payload JSON invalide.", 400);
  }
}

/**
 * Upload a child's photo for parent-create identity (model sheet likeness).
 * Accepts base64 / data-URL; stores under users/{uid}/child-refs/.
 */
export async function POST(request: Request) {
  try {
    let user: Awaited<ReturnType<typeof requireUser>>["user"];
    try {
      ({ user } = await requireUser());
    } catch (authErr) {
      if (authErr instanceof AppError) return apiError(authErr);
      return apiError(
        new AppError("UNAUTHORIZED", "Connectez-vous pour envoyer la photo de l’enfant.", 401)
      );
    }

    try {
      await rateLimitAsync(`child-photo:${user.id}`, {
        limit: 10,
        windowMs: 60_000,
        durable: true,
      });
    } catch (rlErr) {
      if (rlErr instanceof AppError) {
        return apiError(
          new AppError(
            "RATE_LIMITED",
            "Trop d’envois de photos. Réessayez dans une minute.",
            429
          )
        );
      }
      // Fail open if the durable limiter itself is unavailable.
      console.error("[child-photo] rate limit store error", rlErr);
    }

    const body = schema.parse(await readLimitedJson(request));

    let raw = body.imageBase64.trim();
    let contentType: string = body.contentType;
    const dataUrl = /^data:(image\/(?:jpeg|png|webp|heic|heif));base64,(.+)$/i.exec(raw);
    if (dataUrl) {
      contentType = dataUrl[1].toLowerCase() as typeof contentType;
      raw = dataUrl[2];
    }
    let bytes = Buffer.from(raw.replace(/\s/g, ""), "base64");
    if (bytes.length < 500 || bytes.length > 3_000_000) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Photo trop petite ou trop lourde (max 3 Mo après compression).",
        400
      );
    }
    let detected = detectImageFormat(bytes);
    let detectedContentType =
      detected === "jpeg"
        ? "image/jpeg"
        : detected === "png"
          ? "image/png"
          : detected === "webp"
            ? "image/webp"
            : null;

    // iPhone photos commonly arrive as HEIC/HEIF. Sharp/libvips decodes them
    // server-side and normalizes orientation before Storage/Fal receives a JPEG.
    if (!detectedContentType && /image\/hei[cf]/i.test(contentType)) {
      try {
        const sharp = (await import("sharp")).default;
        bytes = await sharp(bytes)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer();
        detected = "jpeg";
        detectedContentType = "image/jpeg";
      } catch {
        throw new AppError(
          "VALIDATION_ERROR",
          "Cette photo HEIC n’a pas pu être convertie. Exportez-la en JPG puis réessayez.",
          400
        );
      }
    }

    if (!detectedContentType) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Photo invalide — utilisez un vrai fichier JPG, PNG, WebP, HEIC ou HEIF.",
        400
      );
    }
    contentType = detectedContentType;

    const ext =
      contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const path = `users/${user.id}/child-refs/${randomUUID()}.${ext}`;
    const url = await new StorageService().uploadBytes(
      path,
      bytes,
      contentType,
      "sensitive"
    );
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
