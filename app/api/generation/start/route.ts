import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { estimateBookCost, FREE_TRIALS_MAX, FREE_TRIAL_MAX_PAGES } from "@/config/credits";
import { BookService } from "@/services/book-service";
import { CreditService } from "@/services/credit-service";
import { LicenseService } from "@/services/license-service";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";
import { assertProvidersHealthy } from "@/services/provider-health";
import { after } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";

/** Long-running generation (story + images + PDF) via `after()`. */
export const maxDuration = 300;

const schema = z.object({ book_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { db, user, profile } = await requireUser();
    rateLimit(`genstart:${user.id}`, { limit: 10, windowMs: 60_000 });
    const body = schema.parse(await request.json());
    // Pre-flight: refuse fast (before reserving credits) if a provider outage
    // (fal balance exhausted, LLM quota) was just recorded — avoids the
    // reserve → fail → refund churn during an outage window.
    await assertProvidersHealthy(db);
    const books = new BookService(db);
    const credits = new CreditService(db);
    const book = await books.get(user.id, body.book_id);

    // Access gate with free-trial fallback: accounts without an active access
    // can generate up to FREE_TRIALS_MAX small books (≤ FREE_TRIAL_MAX_PAGES
    // pages) at zero credit cost. No reservation happens for a trial, so no
    // refund path can ever mint credits.
    const hasAccess = await new LicenseService(db).hasActiveAccess(user.id, user.email);
    let isTrial = false;
    if (!hasAccess) {
      const used = profile.free_trials_used ?? 0;
      const max = profile.free_trials_max ?? FREE_TRIALS_MAX;
      if (used >= max) {
        throw new AppError(
          "TRIALS_EXHAUSTED",
          "Tu as utilisé tes essais gratuits. Débloque ton accès Meeradraw pour continuer à créer.",
          403
        );
      }
      if ((book.page_count as number) > FREE_TRIAL_MAX_PAGES) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Les essais gratuits sont limités à ${FREE_TRIAL_MAX_PAGES} pages. Choisis ${FREE_TRIAL_MAX_PAGES} pages ou débloque ton accès.`,
          400
        );
      }
      isTrial = true;
    }

    const cost = isTrial ? 0 : estimateBookCost(book.page_count as number, book.type as string);

    const generationId = randomUUID();
    const now = new Date().toISOString();

    if (!isTrial) {
      // Reserve credits up-front (atomic). The orchestrator refunds the unused
      // portion (failed pages, or the whole reservation on total failure) at the
      // end. reference_id makes the reservation idempotent per generation.
      await credits.reserve(
        user.id,
        cost,
        `Réservation génération livre ${String(book.title ?? "")}`.trim(),
        `gen:${generationId}:reserve`
      );
    }
    const generation = {
      user_id: user.id,
      book_id: body.book_id,
      generation_type: "full_book",
      status: "queued",
      progress: 0,
      current_step: "queued",
      credits_used: cost,
      tokens_used: 0,
      provider: null,
      duration_ms: null,
      error_message: null,
      metadata: isTrial ? { is_trial: true } : {},
      created_at: now,
      updated_at: now,
    };
    await db.collection("generations").doc(generationId).set(generation);
    await books.update(user.id, body.book_id, { status: "generating" });

    const orchestrator = new GenerationOrchestrator(db);
    after(async () => {
      await orchestrator.run(user.id, body.book_id, generationId, cost, { isTrial });
    });

    return apiSuccess(
      { generation_id: generationId, id: generationId, is_trial: isTrial, ...generation },
      201
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
