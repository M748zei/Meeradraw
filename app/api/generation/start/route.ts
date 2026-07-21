import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { estimateBookCost } from "@/config/credits";
import { BookService } from "@/services/book-service";
import { CreditService } from "@/services/credit-service";
import { LicenseService } from "@/services/license-service";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";
import { after } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";

/** Long-running generation (story + images + PDF) via `after()`. */
export const maxDuration = 300;

const schema = z.object({ book_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    const body = schema.parse(await request.json());
    const books = new BookService(db);
    const credits = new CreditService(db);
    await new LicenseService(db).requireActiveLicense(user.id, user.email);
    const book = await books.get(user.id, body.book_id);
    const cost = estimateBookCost(book.page_count as number, book.type as string);

    const generationId = randomUUID();
    const now = new Date().toISOString();

    // Reserve credits up-front (atomic). The orchestrator refunds the unused
    // portion (failed pages, or the whole reservation on total failure) at the
    // end. reference_id makes the reservation idempotent per generation.
    await credits.reserve(
      user.id,
      cost,
      `Réservation génération livre ${String(book.title ?? "")}`.trim(),
      `gen:${generationId}:reserve`
    );
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
      metadata: {},
      created_at: now,
      updated_at: now,
    };
    await db.collection("generations").doc(generationId).set(generation);
    await books.update(user.id, body.book_id, { status: "generating" });

    const orchestrator = new GenerationOrchestrator(db);
    after(async () => {
      await orchestrator.run(user.id, body.book_id, generationId, cost);
    });

    return apiSuccess({ generation_id: generationId, id: generationId, ...generation }, 201);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
