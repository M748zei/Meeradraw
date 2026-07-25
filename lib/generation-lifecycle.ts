import type { Firestore } from "firebase-admin/firestore";

/**
 * Heartbeat / cancel helpers shared by the reaper, start route, and orchestrator.
 *
 * Stale = no heartbeat for N minutes (not wall-clock from start). Live workflows
 * must touch `heartbeat_at` (via updateGeneration) during long fal waits.
 */

/** No heartbeat for this long → treat generation as dead. */
export const HEARTBEAT_STALE_MS = Number(
  process.env.GENERATION_HEARTBEAT_STALE_MS || 15 * 60 * 1000
);

export class GenerationCancelledError extends Error {
  constructor(message = "Génération annulée") {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

export function heartbeatTimestamp(
  data: Record<string, unknown> | undefined
): number | null {
  if (!data) return null;
  const raw =
    (typeof data.heartbeat_at === "string" && data.heartbeat_at) ||
    (typeof data.updated_at === "string" && data.updated_at) ||
    null;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** True when status is queued/running AND heartbeat is older than STALE. */
export function isHeartbeatStale(
  data: Record<string, unknown> | undefined,
  now = Date.now()
): boolean {
  if (!data) return false;
  const status = data.status;
  if (status !== "queued" && status !== "running") return false;
  if (data.cancelled === true) return true;
  const ts = heartbeatTimestamp(data);
  if (ts == null) return false;
  return now - ts > HEARTBEAT_STALE_MS;
}

/** True when a living worker is still heartbeating. */
export function isGenerationAlive(
  data: Record<string, unknown> | undefined,
  now = Date.now()
): boolean {
  if (!data) return false;
  const status = data.status;
  if (status !== "queued" && status !== "running") return false;
  if (data.cancelled === true) return false;
  const ts = heartbeatTimestamp(data);
  if (ts == null) return false;
  return now - ts <= HEARTBEAT_STALE_MS;
}

/**
 * Abort if the generation was reaped/failed, the book lock moved, or a full
 * refund already landed for this gen. Call before finalize and at each phase.
 */
export async function assertGenerationActive(
  db: Firestore,
  opts: { bookId: string; generationId: string; userId?: string }
): Promise<void> {
  const genRef = db.collection("generations").doc(opts.generationId);
  const bookRef = db.collection("books").doc(opts.bookId);
  const [genSnap, bookSnap] = await Promise.all([genRef.get(), bookRef.get()]);

  if (!genSnap.exists) {
    throw new GenerationCancelledError("Génération introuvable");
  }
  const gen = genSnap.data()!;
  if (gen.cancelled === true || gen.status === "failed") {
    throw new GenerationCancelledError(
      "Génération interrompue (délai dépassé ou annulée)"
    );
  }
  if (gen.status === "completed" || gen.status === "partial") {
    throw new GenerationCancelledError("Génération déjà terminée");
  }

  if (!bookSnap.exists) {
    throw new GenerationCancelledError("Livre introuvable");
  }
  const book = bookSnap.data()!;
  const active =
    typeof book.active_generation_id === "string"
      ? book.active_generation_id
      : null;
  if (active && active !== opts.generationId) {
    throw new GenerationCancelledError(
      "Une autre génération est active pour ce livre"
    );
  }

  // Full refund already applied → never spend more fal $.
  const userId =
    opts.userId ||
    (typeof gen.user_id === "string" ? gen.user_id : null);
  if (userId) {
    const refunded = await hasRefund(
      db,
      userId,
      `gen:${opts.generationId}:refund:full`
    );
    if (refunded) {
      throw new GenerationCancelledError(
        "Génération déjà remboursée — arrêt des dépenses"
      );
    }
  }
}

async function hasRefund(
  db: Firestore,
  userId: string,
  referenceId: string
): Promise<boolean> {
  try {
    const snap = await db
      .collection("users")
      .doc(userId)
      .collection("credit_ledger")
      .where("operation", "==", "credit")
      .where("reference_id", "==", referenceId)
      .limit(1)
      .get();
    return !snap.empty;
  } catch {
    return false;
  }
}
