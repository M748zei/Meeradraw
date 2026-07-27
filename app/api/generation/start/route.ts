import { requireUser } from "@/lib/api-auth";
import { resetBookArtifactsForPaidRecreate } from "@/lib/book-recreate-reset";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimitAsync } from "@/lib/rate-limit-store";
import { isGenerationAlive } from "@/lib/generation-lifecycle";
import {
  bookFieldsAfterFreeRetryLaunchFailure,
  resolveGenerationStartClaim,
} from "@/lib/generation-start-claim";
import { estimateBookCost, FREE_TRIALS_MAX, FREE_TRIAL_MAX_PAGES } from "@/config/credits";
import { BookService } from "@/services/book-service";
import { CreditService } from "@/services/credit-service";
import { LicenseService } from "@/services/license-service";
import { reapDeadGeneration } from "@/services/generation-reaper";
import { generateBookWorkflow } from "@/services/workflows/generate-book";
import { start } from "workflow/api";
import { randomUUID } from "crypto";
import { z } from "zod";

/** Start is thin — durable work runs in Workflow steps (not after()). */
export const maxDuration = 60;

const schema = z.object({
  book_id: z.string().uuid(),
  /** Explicit free-retry button — never inferred from UI copy alone. */
  require_free_retry: z.boolean().optional().default(false),
  /** Paid recreate: must match server estimateBookCost or start is rejected. */
  expected_cost: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  try {
    const { db, user, profile } = await requireUser();
    await rateLimitAsync(`genstart:${user.id}`, {
      limit: 10,
      windowMs: 60_000,
      durable: true,
    });
    const body = schema.parse(await request.json());
    const books = new BookService(db);
    const credits = new CreditService(db);
    const book = await books.get(user.id, body.book_id);
    if (book.status === "completed" || book.status === "partial" || book.status === "archived") {
      throw new AppError(
        "CONFLICT",
        book.status === "partial"
          ? "Ce livre est déjà partiellement créé. Régénère les pages manquantes depuis le livre."
          : "Ce livre a déjà été créé.",
        409
      );
    }

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

    // Controlled free restart is decided atomically inside the claim transaction
    // (see freeRetryConsumed below) so double-clicks cannot both go free.
    const estimatedCost = isTrial
      ? 0
      : estimateBookCost(book.page_count as number, book.type as string);
    const generationId = randomUUID();
    const now = new Date().toISOString();
    const startedAt = Date.now();
    const bookRef = db.collection("books").doc(body.book_id);
    const genRef = db.collection("generations").doc(generationId);
    const userRef = db.collection("users").doc(user.id);

    // Dead-resume: if book is "generating" but the active gen's heartbeat is
    // stale (workflow dead), fail+refund that gen BEFORE claiming a new one.
    // Never return reused:true for a corpse — that left the UI spinning until reaper.
    {
      const bookSnap = await bookRef.get();
      const bookData = bookSnap.data();
      const status = bookData?.status as string | undefined;
      const activeGen =
        typeof bookData?.active_generation_id === "string"
          ? bookData.active_generation_id
          : null;
      if (status === "generating" && activeGen) {
        const activeSnap = await db.collection("generations").doc(activeGen).get();
        const activeData = activeSnap.data() as Record<string, unknown> | undefined;
        if (activeData && isGenerationAlive(activeData)) {
          return apiSuccess({
            generation_id: activeGen,
            id: activeGen,
            is_trial: Boolean(
              (activeData.metadata as Record<string, unknown> | null)?.is_trial
            ),
            status: activeData.status ?? "queued",
            reused: true,
          });
        }
        // Dead or terminal — clear so we can start fresh.
        if (
          activeData &&
          (activeData.status === "queued" || activeData.status === "running")
        ) {
          await reapDeadGeneration(db, activeGen, {
            ...activeData,
            user_id: activeData.user_id ?? user.id,
            book_id: activeData.book_id ?? body.book_id,
          });
        } else {
          await bookRef.set(
            {
              status: "draft",
              active_generation_id: null,
              updated_at: now,
            },
            { merge: true }
          );
        }
      }
    }

    // Atomic claim: create the generation doc + lock the book BEFORE reserving
    // credits. Double-clicks with a LIVE workflow still reuse (checked above).
    type ClaimResult =
      | { kind: "existing"; generationId: string; isTrial: boolean; status: string }
      | { kind: "created"; cost: number; freeRetry: boolean };

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

      // Race: another request may have claimed between the dead-check and now.
      if (status === "generating" && activeGen) {
        const activeSnap = await tx.get(db.collection("generations").doc(activeGen));
        const activeData = activeSnap.data();
        if (activeData && isGenerationAlive(activeData as Record<string, unknown>)) {
          return {
            kind: "existing",
            generationId: activeGen,
            isTrial: Boolean(
              (activeData.metadata as Record<string, unknown> | null)?.is_trial
            ),
            status: (activeData.status as string) || "queued",
          };
        }
        // Still dead inside the tx — clear lock and proceed to create.
        tx.update(bookRef, {
          status: "draft",
          active_generation_id: null,
          updated_at: now,
        });
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

      const claimDecision = resolveGenerationStartClaim({
        isTrial,
        estimatedCost,
        freeRetryAvailable: Boolean(bookData.free_retry_available),
        requireFreeRetry: Boolean(body.require_free_retry),
        expectedCost:
          body.expected_cost === undefined ? null : body.expected_cost,
      });
      if (!claimDecision.ok) {
        throw new AppError(
          "CONFLICT",
          claimDecision.message,
          409
        );
      }
      const freeRetry = claimDecision.freeRetry;
      const claimCost = claimDecision.cost;

      tx.set(genRef, {
        user_id: user.id,
        book_id: body.book_id,
        generation_type: "full_book",
        status: "queued",
        progress: 0,
        current_step: "queued",
        credits_used: claimCost,
        tokens_used: 0,
        provider: null,
        duration_ms: null,
        error_message: null,
        cancelled: false,
        metadata: {
          ...(isTrial ? { is_trial: true, trial_reserved: true } : {}),
          ...(freeRetry ? { free_retry: true, compensated_retry: true } : {}),
        },
        created_at: now,
        updated_at: now,
        heartbeat_at: now,
      });
      tx.update(bookRef, {
        status: "generating",
        active_generation_id: generationId,
        ...(freeRetry ? { free_retry_available: false } : {}),
        updated_at: now,
      });
      return { kind: "created", cost: claimCost, freeRetry };
    });

    if (claim.kind === "existing") {
      return apiSuccess({
        generation_id: claim.generationId,
        id: claim.generationId,
        is_trial: claim.isTrial,
        status: claim.status,
        reused: true,
      });
    }

    const cost = claim.cost;

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
            cancelled: true,
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

    // PAID recreate: the parent pays for a FRESH book. Wipe the previous
    // generation's page docs and cover pointers so cover + pages regenerate
    // from the new plan — the idempotent resume logic must never reuse stale
    // (possibly invalidated) art across generations. Free retries keep the
    // historical resume semantics (good pages of the failed run are reused).
    if (!isTrial && cost > 0) {
      const reset = await resetBookArtifactsForPaidRecreate(db, body.book_id);
      if (reset.pagesDeleted > 0 || reset.coverCleared) {
        console.log(
          `[gen ${generationId}] paid recreate reset: ${reset.pagesDeleted} stale page(s) deleted, cover cleared=${reset.coverCleared}`
        );
      }
    }

    // Durable pipeline — survives >300s (12–25 page books). Starting the
    // workflow is the last fallible hand-off after the reservation. Compensate
    // immediately if that hand-off fails so the parent never waits for the
    // stale-generation reaper to recover their balance.
    let workflowRunId: string;
    try {
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
      workflowRunId = run.runId;
    } catch (launchError) {
      const failedAt = new Date().toISOString();
      const freeRetryWasClaimed = claim.freeRetry;
      let compensated = isTrial || freeRetryWasClaimed || cost === 0;
      console.error(`[gen ${generationId}] workflow launch failed`, launchError);

      try {
        if (isTrial) {
          await releaseTrialSlot(db, user.id, true);
          compensated = true;
        } else if (cost > 0) {
          await credits.refund(
            user.id,
            cost,
            "Remboursement — lancement de génération impossible",
            `gen:${generationId}:refund:full`
          );
          compensated = true;
        } else {
          // Free retry: nothing to refund, but the flag must be restored below.
          compensated = true;
        }
      } catch (compensationError) {
        console.error(
          `[gen ${generationId}] launch compensation failed`,
          compensationError
        );
        compensated = false;
      }

      await db.runTransaction(async (tx) => {
        const currentBook = await tx.get(bookRef);
        if (
          compensated &&
          currentBook.exists &&
          currentBook.data()?.active_generation_id === generationId
        ) {
          tx.update(bookRef, {
            ...bookFieldsAfterFreeRetryLaunchFailure({
              freeRetryWasClaimed,
              compensated,
            }),
            updated_at: failedAt,
          });
        }
        tx.set(
          genRef,
          compensated
            ? {
                status: "failed",
                cancelled: true,
                credits_used: 0,
                error_message: freeRetryWasClaimed
                  ? "La génération n’a pas pu démarrer. Ta tentative gratuite a été restaurée — tu peux réessayer sans frais."
                  : "La génération n’a pas pu démarrer. Tes crédits ont été remboursés.",
                updated_at: failedAt,
                heartbeat_at: failedAt,
              }
            : {
                // Keep it reapable. A retry sees this ancient heartbeat and
                // completes the same idempotent refund before starting again.
                status: "queued",
                launch_failed: true,
                error_message:
                  "La génération n’a pas pu démarrer. Le remboursement automatique est en cours.",
                updated_at: failedAt,
                heartbeat_at: "1970-01-01T00:00:00.000Z",
              },
          { merge: true }
        );
      });

      throw new AppError(
        "GENERATION_FAILED",
        compensated
          ? freeRetryWasClaimed
            ? "La génération n’a pas pu démarrer. Ta tentative gratuite est toujours disponible — tu peux réessayer sans frais."
            : "La génération n’a pas pu démarrer. Tes crédits ont été remboursés — tu peux réessayer."
          : "La génération n’a pas pu démarrer. Réessaie : le remboursement sera finalisé automatiquement.",
        503,
        "Réessayer"
      );
    }

    await genRef.set(
      { workflow_run_id: workflowRunId, updated_at: new Date().toISOString() },
      { merge: true }
    );

    return apiSuccess(
      {
        generation_id: generationId,
        id: generationId,
        is_trial: isTrial,
        workflow_run_id: workflowRunId,
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
