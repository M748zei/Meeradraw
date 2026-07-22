import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess } from "@/lib/errors";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";
import { reapIfStale } from "@/services/generation-reaper";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    // Self-healing poll: a generation stuck in queued/running past the timeout
    // is failed + refunded right here, so the UI never spins forever.
    const snap = await db.collection("generations").doc(id).get();
    if (snap.exists && snap.data()?.user_id === user.id) {
      await reapIfStale(db, id, snap.data());
    }
    return apiSuccess(await new GenerationOrchestrator(db).getProgress(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}
