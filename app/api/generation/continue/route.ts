import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebase/admin";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";
import { after } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";

/**
 * Internal continuation hop for segmented generation (Vercel Hobby caps every
 * invocation at 300 s — a 24-40 page book chains several invocations, each
 * processing pending pages within a time budget; see GenerationOrchestrator).
 *
 * Auth: `x-internal-secret` must equal INTERNAL_TASK_SECRET (constant-time,
 * fail-closed — without the env var the route refuses everything).
 */
export const maxDuration = 300;

const schema = z.object({ generation_id: z.string().min(8).max(80) });

function constantTimeMatch(candidate: string | null | undefined, secret: string) {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const secret = process.env.INTERNAL_TASK_SECRET?.trim();
    const header = request.headers.get("x-internal-secret");
    if (!secret || !constantTimeMatch(header, secret)) {
      throw new AppError("FORBIDDEN", "Accès refusé", 403);
    }

    const { generation_id } = schema.parse(await request.json());
    const db = getAdminDb();
    const genRef = db.collection("generations").doc(generation_id);

    // Transactional in-flight lock: at most one live continuation per
    // generation (a retried chain fetch or a race can never double-process).
    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(genRef);
      if (!snap.exists) return { start: false as const, reason: "absent" };
      const d = snap.data()!;
      if (d.status !== "queued" && d.status !== "running") {
        return { start: false as const, reason: "terminal" };
      }
      const inflight =
        typeof d.continuation_inflight_at === "string"
          ? Date.parse(d.continuation_inflight_at)
          : NaN;
      if (!Number.isNaN(inflight) && Date.now() - inflight < 120_000) {
        return { start: false as const, reason: "inflight" };
      }
      const seq = ((d.continuation_seq as number) ?? 0) + 1;
      tx.update(genRef, {
        continuation_inflight_at: new Date().toISOString(),
        continuation_seq: seq,
      });
      return {
        start: true as const,
        userId: String(d.user_id),
        bookId: String(d.book_id),
        cost: typeof d.credits_used === "number" ? d.credits_used : 0,
        isTrial: (d.metadata as { is_trial?: boolean } | null)?.is_trial === true,
        seq,
      };
    });

    if (!claim.start) return apiSuccess({ accepted: false, reason: claim.reason });

    const orchestrator = new GenerationOrchestrator(db);
    after(async () => {
      await orchestrator.continueRun(claim.userId, claim.bookId, generation_id, claim.cost, {
        isTrial: claim.isTrial,
        seq: claim.seq,
      });
    });
    return apiSuccess({ accepted: true, seq: claim.seq }, 202);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", "generation_id invalide", 400));
    }
    return apiError(e);
  }
}
