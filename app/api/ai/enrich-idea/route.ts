import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getTextProvider } from "@/services/ai";
import { z } from "zod";

export const maxDuration = 60;

const schema = z.object({
  idea: z.string().min(3).max(4000),
});

const ENRICH_SOFT_TIMEOUT_MS = 20_000;

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    rateLimit(`enrich:${user.id}`, { limit: 20, windowMs: 60_000 });
    const body = schema.parse(await request.json());

    const enriched = await Promise.race([
      getTextProvider().enrichIdea(body.idea),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ENRICH_SOFT_TIMEOUT_MS)
      ),
    ]);

    if (!enriched) {
      // Soft timeout — client applies local fallback; avoid hanging CTA
      throw new AppError(
        "TIMEOUT",
        "Enrichissement trop long — utilisez le brief de secours",
        504
      );
    }

    return apiSuccess(enriched);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(
        new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Idée invalide", 400)
      );
    }
    return apiError(e);
  }
}
