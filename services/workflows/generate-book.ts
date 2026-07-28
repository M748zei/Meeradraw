import { FatalError, getStepMetadata } from "workflow";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  assertGenerationActive,
  GenerationCancelledError,
} from "@/lib/generation-lifecycle";
import {
  classifyGenerationError,
  persistGenerationStep,
} from "@/lib/generation-step-ledger";
import { isNonRetryableFalError } from "@/services/ai/fal-provider";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";

export type GenerateBookArgs = {
  userId: string;
  bookId: string;
  generationId: string;
  cost: number;
  isTrial: boolean;
  startedAt: number;
};

/**
 * Workflow step attempt from the runtime.
 * getStepMetadata().attempt starts at 1 and increments on each Workflow retry.
 * request_id is left null here unless a provider request id is later supplied —
 * Workflow's stepId is NOT a fal/provider request id.
 */
function workflowStepAttempt(): number {
  const { attempt } = getStepMetadata();
  return Math.max(1, Number(attempt) || 1);
}

/**
 * Durable book generation — one step per phase / page wave so a 12–25 page
 * book survives Vercel function timeouts (the old after()+orchestrator.run
 * monolith was killed at 300s).
 *
 * Each step aborts if the generation was reaped/cancelled or the book lock
 * moved — so a living workflow never keeps spending fal $ after a refund.
 */
export async function generateBookWorkflow(args: GenerateBookArgs) {
  "use workflow";

  console.log(
    `[workflow] generateBook start gen=${args.generationId} book=${args.bookId} trial=${args.isTrial}`
  );

  try {
    await stepStory(args);
    // Strict books: per-character portrait steps (short, resumable,
    // heartbeat-honest). Prod gen 33d3c176 stalled silently when the
    // monolithic sheet step was killed by 1800s instance recycling.
    const sheetPlan = await stepSheetCast(args);
    if (sheetPlan.strict) {
      for (const character of sheetPlan.cast) {
        await stepPortrait(args, character.id, character.index);
      }
      await stepSheetFinalize(args);
    } else {
      await stepSheet(args);
    }
    await stepCover(args);
    const pageIds = await stepPagesSetup(args);

    // Parent books: larger waves (faster wall-clock). Studio keeps default.
    const waveSize = await stepResolveWaveSize(args);

    for (let i = 0; i < pageIds.length; i += waveSize) {
      const wave = pageIds.slice(i, i + waveSize);
      await Promise.all(wave.map((pageId) => stepOnePage(args, pageId)));
    }

    // Studio heal (capped in orchestrator). Parent skips.
    await stepHealFailedPages(args, 1);
    await stepHealFailedPages(args, 2);

    await stepFinalize(args);
    console.log(`[workflow] generateBook done gen=${args.generationId}`);
    return { ok: true as const, generationId: args.generationId };
  } catch (err) {
    console.error(`[workflow] generateBook failed gen=${args.generationId}`, err);
    if (!(err instanceof GenerationCancelledError)) {
      await stepFail(args, err);
    } else {
      // Already failed+refunded by reaper — still run idempotent failRun.
      await stepFail(args, err);
    }
    throw new FatalError(
      err instanceof Error ? err.message : "Génération interrompue"
    );
  }
}

async function assertNotCancelled(args: GenerateBookArgs) {
  await assertGenerationActive(getAdminDb(), {
    userId: args.userId,
    bookId: args.bookId,
    generationId: args.generationId,
  });
}

function rethrowStepError(err: unknown): never {
  if (err instanceof GenerationCancelledError) throw err;
  if (err instanceof FatalError) throw err;
  if (isNonRetryableFalError(err) || classifyGenerationError(err).permanent) {
    throw new FatalError(
      err instanceof Error ? err.message : "Erreur permanente de génération"
    );
  }
  throw err;
}

async function stepResolveWaveSize(args: GenerateBookArgs): Promise<number> {
  "use step";
  await assertNotCancelled(args);
  const orch = new GenerationOrchestrator(getAdminDb());
  return orch.resolvePageWaveSize(args.userId, args.bookId);
}

async function stepHealFailedPages(args: GenerateBookArgs, pass: number) {
  "use step";
  await assertNotCancelled(args);
  console.log(
    `[workflow] step heal pass=${pass} gen=${args.generationId}`
  );
  const orch = new GenerationOrchestrator(getAdminDb());
  await orch.runHealFailedPagesPhase(
    args.userId,
    args.bookId,
    args.generationId,
    pass
  );
}

async function stepStory(args: GenerateBookArgs) {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(`[workflow] step story gen=${args.generationId} attempt=${attempt}`);
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "story",
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "text",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    await orch.runStoryPhase(args.userId, args.bookId, args.generationId);
    await persistGenerationStep(db, args.generationId, {
      stepKey: "story",
      status: "succeeded",
      attempt,
      provider: "text",
    });
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "story",
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    rethrowStepError(err);
  }
}

async function stepSheetCast(
  args: GenerateBookArgs
): Promise<{ strict: boolean; cast: Array<{ id: string; index: number }> }> {
  "use step";
  await assertNotCancelled(args);
  const orch = new GenerationOrchestrator(getAdminDb());
  return orch.resolveSheetCast(args.userId, args.bookId);
}

async function stepPortrait(
  args: GenerateBookArgs,
  characterId: string,
  characterIndex: number
) {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(
    `[workflow] step portrait ${characterId} gen=${args.generationId} attempt=${attempt}`
  );
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "portrait",
    pageId: characterId,
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "fal",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    await orch.runOnePortraitPhase(
      args.userId,
      args.bookId,
      args.generationId,
      characterId,
      characterIndex,
      attempt
    );
    await persistGenerationStep(db, args.generationId, {
      stepKey: "portrait",
      pageId: characterId,
      status: "succeeded",
      attempt,
      provider: "fal",
    });
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "portrait",
      pageId: characterId,
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    // Portrait QC rejections are seed-dependent, not permanent: each workflow
    // retry runs FRESH seeds (attempt feeds the seed above), so let the
    // runtime retry instead of dying on one unlucky seed batch (gen b249733d:
    // hero portrait passed one run, failed 3/3 the next, same settings).
    if (
      !(err instanceof GenerationCancelledError) &&
      !(err instanceof FatalError) &&
      classifyGenerationError(err).code === "QUALITY_GATE"
    ) {
      throw err;
    }
    rethrowStepError(err);
  }
}

async function stepSheetFinalize(args: GenerateBookArgs) {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(
    `[workflow] step sheet-finalize gen=${args.generationId} attempt=${attempt}`
  );
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "sheet_finalize",
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "firestore",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    await orch.runSheetFinalizePhase(args.userId, args.bookId, args.generationId);
    await persistGenerationStep(db, args.generationId, {
      stepKey: "sheet_finalize",
      status: "succeeded",
      attempt,
      provider: "firestore",
    });
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "sheet_finalize",
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    rethrowStepError(err);
  }
}

async function stepSheet(args: GenerateBookArgs) {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(`[workflow] step sheet gen=${args.generationId} attempt=${attempt}`);
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "sheet",
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "fal",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    await orch.runSheetPhase(args.userId, args.bookId, args.generationId);
    await persistGenerationStep(db, args.generationId, {
      stepKey: "sheet",
      status: "succeeded",
      attempt,
      provider: "fal",
    });
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "sheet",
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    rethrowStepError(err);
  }
}

async function stepCover(args: GenerateBookArgs) {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(`[workflow] step cover gen=${args.generationId} attempt=${attempt}`);
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "cover",
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "fal",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    await orch.runCoverPhase(args.userId, args.bookId, args.generationId);
    await persistGenerationStep(db, args.generationId, {
      stepKey: "cover",
      status: "succeeded",
      attempt,
      provider: "fal",
    });
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "cover",
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    rethrowStepError(err);
  }
}

async function stepPagesSetup(args: GenerateBookArgs): Promise<string[]> {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(
    `[workflow] step pages-setup gen=${args.generationId} attempt=${attempt}`
  );
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "pages_setup",
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "firestore",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    const pageIds = await orch.runPagesSetupPhase(
      args.userId,
      args.bookId,
      args.generationId
    );
    await persistGenerationStep(db, args.generationId, {
      stepKey: "pages_setup",
      status: "succeeded",
      attempt,
      provider: "firestore",
    });
    return pageIds;
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "pages_setup",
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    rethrowStepError(err);
  }
}

async function stepOnePage(args: GenerateBookArgs, pageId: string) {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(
    `[workflow] step page ${pageId} gen=${args.generationId} attempt=${attempt}`
  );
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "page",
    pageId,
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "fal",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    await orch.runOnePagePhase(
      args.userId,
      args.bookId,
      args.generationId,
      pageId
    );
    await persistGenerationStep(db, args.generationId, {
      stepKey: "page",
      pageId,
      status: "succeeded",
      attempt,
      provider: "fal",
    });
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "page",
      pageId,
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    rethrowStepError(err);
  }
}

async function stepFinalize(args: GenerateBookArgs) {
  "use step";
  const attempt = workflowStepAttempt();
  await assertNotCancelled(args);
  console.log(
    `[workflow] step finalize gen=${args.generationId} attempt=${attempt}`
  );
  const db = getAdminDb();
  await persistGenerationStep(db, args.generationId, {
    stepKey: "finalize",
    status: attempt > 1 ? "retrying" : "running",
    attempt,
    provider: "pdf",
  });
  try {
    const orch = new GenerationOrchestrator(db);
    await orch.runFinalizePhase(
      args.userId,
      args.bookId,
      args.generationId,
      args.cost,
      args.isTrial,
      args.startedAt
    );
    await persistGenerationStep(db, args.generationId, {
      stepKey: "finalize",
      status: "succeeded",
      attempt,
      provider: "pdf",
    });
  } catch (err) {
    await persistGenerationStep(db, args.generationId, {
      stepKey: "finalize",
      status: "failed",
      attempt,
      error: err,
      errorCode: classifyGenerationError(err).code,
    });
    rethrowStepError(err);
  }
}

async function stepFail(args: GenerateBookArgs, err: unknown) {
  "use step";
  console.log(`[workflow] step fail gen=${args.generationId}`);
  const orch = new GenerationOrchestrator(getAdminDb());
  await orch.failRun(
    args.userId,
    args.bookId,
    args.generationId,
    args.cost,
    args.startedAt,
    err,
    args.isTrial
  );
}
