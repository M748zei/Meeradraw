import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess } from "@/lib/errors";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    return apiSuccess(await new GenerationOrchestrator(db).getProgress(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}
