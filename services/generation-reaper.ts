import { CreditService } from "@/services/credit-service";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Reaper for generations stranded in `queued`/`running` (Vercel timeout, crash
 * before the catch block, lost instance). Marks them failed, fails the book,
 * and refunds the reservation.
 *
 * Refund uses the SAME reference id as the orchestrator's own refund
 * (`gen:<id>:refund`), so whichever path lands first wins and the other is a
 * no-op — the customer can never be refunded twice.
 *
 * Wired in two places:
 * - GET /api/generation/[id] (polling path) — self-heals the generation the
 *   user is actually looking at, no cron needed for the common case.
 * - GET /api/cron/reap-generations — daily sweep for generations nobody polls.
 */

const STALE_AFTER_MS = 15 * 60 * 1000;

function isStale(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const status = data.status;
  if (status !== "queued" && status !== "running") return false;
  const updated = typeof data.updated_at === "string" ? Date.parse(data.updated_at) : NaN;
  if (Number.isNaN(updated)) return false;
  return Date.now() - updated > STALE_AFTER_MS;
}

async function reapOne(
  db: Firestore,
  genId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const genRef = db.collection("generations").doc(genId);
  // Transaction re-checks staleness so a concurrent finishing run (or a second
  // reaper) can't double-fail a generation that just completed.
  const shouldRefund = await db.runTransaction(async (tx) => {
    const snap = await tx.get(genRef);
    if (!isStale(snap.data())) return false;
    tx.update(genRef, {
      status: "failed",
      error_message:
        "Génération interrompue (délai dépassé). Tes crédits ont été remboursés — relance quand tu veux.",
      updated_at: new Date().toISOString(),
    });
    return true;
  });
  if (!shouldRefund) return false;

  const userId = typeof data.user_id === "string" ? data.user_id : null;
  const bookId = typeof data.book_id === "string" ? data.book_id : null;
  const cost = typeof data.credits_used === "number" ? data.credits_used : 0;

  if (bookId && userId) {
    await db
      .collection("books")
      .doc(bookId)
      .set({ status: "failed", updated_at: new Date().toISOString() }, { merge: true })
      .catch(() => undefined);
  }
  if (userId && cost > 0) {
    await new CreditService(db).refund(
      userId,
      cost,
      "Remboursement — génération interrompue (délai dépassé)",
      `gen:${genId}:refund`
    );
  }
  console.warn(`[reaper] generation ${genId} reaped (refund ${cost} to ${userId})`);
  return true;
}

/** Self-heal one generation if it looks stranded (cheap: one read already done by caller). */
export async function reapIfStale(
  db: Firestore,
  genId: string,
  data: Record<string, unknown> | undefined
): Promise<boolean> {
  try {
    if (!isStale(data)) return false;
    return await reapOne(db, genId, data as Record<string, unknown>);
  } catch (err) {
    console.error(`[reaper] failed for ${genId}`, err);
    return false;
  }
}

/** Sweep all stranded generations (cron). Returns how many were reaped. */
export async function reapStaleGenerations(db: Firestore, limit = 200): Promise<number> {
  // Single-field filter only (no composite index needed); staleness is checked
  // in code and re-checked inside the transaction.
  const snaps = await Promise.all([
    db.collection("generations").where("status", "==", "running").limit(limit).get(),
    db.collection("generations").where("status", "==", "queued").limit(limit).get(),
  ]);
  let reaped = 0;
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!isStale(data)) continue;
      try {
        if (await reapOne(db, doc.id, data)) reaped += 1;
      } catch (err) {
        console.error(`[reaper] failed for ${doc.id}`, err);
      }
    }
  }
  return reaped;
}
