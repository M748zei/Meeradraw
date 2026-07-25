import { FatalError } from "workflow";
import { getAdminDb } from "@/lib/firebase/admin";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";

export type GenerateBookArgs = {
  userId: string;
  bookId: string;
  generationId: string;
  cost: number;
  isTrial: boolean;
  startedAt: number;
};

const PAGE_WAVE = Math.max(
  1,
  Math.min(6, Number(process.env.PAGE_GEN_CONCURRENCY || 3) || 3)
);

/**
 * Durable book generation — one step per phase / page wave so a 12–25 page
 * book survives Vercel function timeouts (the old after()+orchestrator.run
 * monolith was killed at 300s).
 */
export async function generateBookWorkflow(args: GenerateBookArgs) {
  "use workflow";

  console.log(
    `[workflow] generateBook start gen=${args.generationId} book=${args.bookId} trial=${args.isTrial}`
  );

  try {
    await stepStory(args);
    await stepSheet(args);
    const pageIds = await stepCoverAndSetup(args);

    for (let i = 0; i < pageIds.length; i += PAGE_WAVE) {
      const wave = pageIds.slice(i, i + PAGE_WAVE);
      await Promise.all(wave.map((pageId) => stepOnePage(args, pageId)));
    }

    await stepFinalize(args);
    console.log(`[workflow] generateBook done gen=${args.generationId}`);
    return { ok: true as const, generationId: args.generationId };
  } catch (err) {
    console.error(`[workflow] generateBook failed gen=${args.generationId}`, err);
    await stepFail(args, err);
    // Don't retry the whole workflow — failRun already refunded.
    throw new FatalError(
      err instanceof Error ? err.message : "Génération interrompue"
    );
  }
}

async function stepStory(args: GenerateBookArgs) {
  "use step";
  console.log(`[workflow] step story gen=${args.generationId}`);
  const orch = new GenerationOrchestrator(getAdminDb());
  await orch.runStoryPhase(args.userId, args.bookId, args.generationId);
}

async function stepSheet(args: GenerateBookArgs) {
  "use step";
  console.log(`[workflow] step sheet gen=${args.generationId}`);
  const orch = new GenerationOrchestrator(getAdminDb());
  await orch.runSheetPhase(args.userId, args.bookId, args.generationId);
}

async function stepCoverAndSetup(args: GenerateBookArgs): Promise<string[]> {
  "use step";
  console.log(`[workflow] step cover gen=${args.generationId}`);
  const orch = new GenerationOrchestrator(getAdminDb());
  return orch.runCoverAndPagesSetupPhase(
    args.userId,
    args.bookId,
    args.generationId
  );
}

async function stepOnePage(args: GenerateBookArgs, pageId: string) {
  "use step";
  console.log(`[workflow] step page ${pageId} gen=${args.generationId}`);
  const orch = new GenerationOrchestrator(getAdminDb());
  await orch.runOnePagePhase(
    args.userId,
    args.bookId,
    args.generationId,
    pageId
  );
}

async function stepFinalize(args: GenerateBookArgs) {
  "use step";
  console.log(`[workflow] step finalize gen=${args.generationId}`);
  const orch = new GenerationOrchestrator(getAdminDb());
  await orch.runFinalizePhase(
    args.userId,
    args.bookId,
    args.generationId,
    args.cost,
    args.isTrial,
    args.startedAt
  );
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
