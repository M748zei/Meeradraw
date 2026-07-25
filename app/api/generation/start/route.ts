import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { estimateBookCost, FREE_TRIALS_MAX, FREE_TRIAL_MAX_PAGES } from "@/config/credits";
import { BookService } from "@/services/book-service";
import { CreditService } from "@/services/credit-service";
import { LicenseService } from "@/services/license-service";
import { generateBookWorkflow } from "@/services/workflows/generate-book";
import { start } from "workflow/api";
import { randomUUID } from "crypto";
import { z } from "zod";

/** Start is thin — durable work runs in Workflow steps (not after()). */
export const maxDuration = 60;

const schema = z.object({ book_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { db, user, profile } = await requireUser();
    rateLimit(`genstart:${user.id}`, { limit: 10, windowMs: 60_000 });
    const body = schema.parse(await request.json());
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
    const startedAt = Date.now();
    const bookRef = db.collection("books").doc(body.book_id);
    const genRef = db.collection("generations").doc(generationId);
    const userRef = db.collection("users").doc(user.id);

    // Atomic claim: create the generation doc + lock the book BEFORE reserving
    // credits. Double-clicks reuse the in-flight generation (idempotent).
    // Crash after this commit still leaves a durable doc for the reaper.
    type ClaimResult =
      | { kind: "existing"; generationId: string }
      | { kind: "created" };

    const claim = await db.runTransaction(async (tx): Promise<ClaimResult> => {
      const bookSnap = await tx.get(bookRef);
      if (!bookSnap.exists || bookSnap.data()?.user_id !== user.id) {
        throw new AppError("NOT_FOUND", "Livre introuvable", 404);
      }
      const bookData = bookSnap.data()!;
      const status = bookData.status as string;
      const activeGen =
        typeof bookData.active_generation_id === "string"
          ? bookData.active_generation_id
          : null;

      if (status === "generating" && activeGen) {
        return { kind: "existing", generationId: activeGen };
      }

      if (isTrial) {
        const userSnap = await tx.get(userRef);
        const used = (userSnap.data()?.free_trials_used as number) ?? 0;
        const inProgress =
          (userSnap.data()?.free_trials_in_progress as number) ?? 0;
        const max =
          (userSnap.data()?.free_trials_max as number) ??
          profile.free_trials_max ??
          FREE_TRIALS_MAX;
        if (used + inProgress >= max) {
          throw new AppError(
            "TRIALS_EXHAUSTED",
            "Tu as utilisé tes essais gratuits. Débloque ton accès Meeradraw pour continuer à créer.",
            403
          );
        }
        tx.update(userRef, {
          free_trials_in_progress: inProgress + 1,
          updated_at: now,
        });
      }

      tx.set(genRef, {
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
        metadata: isTrial ? { is_trial: true, trial_reserved: true } : {},
        created_at: now,
        updated_at: now,
      });
      tx.update(bookRef, {
        status: "generating",
        active_generation_id: generationId,
        updated_at: now,
      });
      return { kind: "created" };
    });

    if (claim.kind === "existing") {
      return apiSuccess({
        generation_id: claim.generationId,
        id: claim.generationId,
        is_trial: isTrial,
        status: "queued",
        reused: true,
      });
    }

    if (!isTrial) {
      try {
        // Reserve after the durable generation exists so a crash here still
        // leaves a document the reaper can fail (no orphan debit yet).
        await credits.reserve(
          user.id,
          cost,
          `Réservation génération livre ${String(book.title ?? "")}`.trim(),
          `gen:${generationId}:reserve`
        );
      } catch (err) {
        await releaseTrialSlot(db, user.id, isTrial);
        await genRef.set(
          {
            status: "failed",
            error_message:
              err instanceof AppError
                ? err.message
                : "Réservation de crédits impossible",
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
        await bookRef.set(
          {
            status: "draft",
            active_generation_id: null,
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
        throw err;
      }
    }

    // Durable pipeline — survives >300s (12–25 page books).
    const run = await start(generateBookWorkflow, [
      {
        userId: user.id,
        bookId: body.book_id,
        generationId,
        cost,
        isTrial,
        startedAt,
      },
    ]);

    return apiSuccess(
      {
        generation_id: generationId,
        id: generationId,
        is_trial: isTrial,
        workflow_run_id: run.runId,
        user_id: user.id,
        book_id: body.book_id,
        generation_type: "full_book",
        status: "queued",
        progress: 0,
        current_step: "queued",
        credits_used: cost,
        metadata: isTrial ? { is_trial: true, trial_reserved: true } : {},
      },
      201
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}

async function releaseTrialSlot(
  db: import("firebase-admin/firestore").Firestore,
  userId: string,
  isTrial: boolean
) {
  if (!isTrial) return;
  const userRef = db.collection("users").doc(userId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const inProgress = (snap.data()?.free_trials_in_progress as number) ?? 0;
    tx.update(userRef, {
      free_trials_in_progress: Math.max(0, inProgress - 1),
      updated_at: new Date().toISOString(),
    });
  });
}
