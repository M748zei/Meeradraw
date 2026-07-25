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
 * Also reaps stranded page-retry operations (`generation_retries`) that
 * reserved credits then died before their `finally` refund.
 *
 * Wired in two places:
 * - GET /api/generation/[id] (polling path) — self-heals the generation the
 *   user is actually looking at, no cron needed for the common case.
 * - GET /api/cron/reap-generations — daily sweep for generations nobody polls.
 */

const STALE_AFTER_MS = 8 * 60 * 1000;

function isStale(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const status = data.status;
  if (status !== "queued" && status !== "running") return false;
  const updated = typeof data.updated_at === "string" ? Date.parse(data.updated_at) : NaN;
  if (Number.isNaN(updated)) return false;
  return Date.now() - updated > STALE_AFTER_MS;
}

async function releaseTrialSlotIfNeeded(
  db: Firestore,
  genId: string,
  data: Record<string, unknown>
) {
  const meta = (data.metadata as Record<string, unknown> | null) ?? {};
  if (meta.is_trial !== true || meta.trial_reserved !== true) return;
  if (data.trial_counted === true || meta.trial_released === true) return;
  const userId = typeof data.user_id === "string" ? data.user_id : null;
  if (!userId) return;
  const genRef = db.collection("generations").doc(genId);
  const userRef = db.collection("users").doc(userId);
  await db.runTransaction(async (tx) => {
    const gen = await tx.get(genRef);
    if (!gen.exists) return;
    const g = gen.data()!;
    const m = (g.metadata as Record<string, unknown> | null) ?? {};
    if (g.trial_counted === true || m.trial_released === true) return;
    if (m.trial_reserved !== true) return;
    const user = await tx.get(userRef);
    const inProgress = (user.data()?.free_trials_in_progress as number) ?? 0;
    tx.update(genRef, { metadata: { ...m, trial_released: true } });
    tx.update(userRef, {
      free_trials_in_progress: Math.max(0, inProgress - 1),
      updated_at: new Date().toISOString(),
    });
  });
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
      .set(
        {
          status: "failed",
          active_generation_id: null,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      )
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
  try {
    await releaseTrialSlotIfNeeded(db, genId, data);
  } catch (err) {
    console.error(`[reaper] trial slot release failed for ${genId}`, err);
  }
  console.warn(`[reaper] generation ${genId} reaped (refund ${cost} to ${userId})`);
  return true;
}

async function reapRetryOne(
  db: Firestore,
  retryId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const retryRef = db.collection("generation_retries").doc(retryId);
  const shouldRefund = await db.runTransaction(async (tx) => {
    const snap = await tx.get(retryRef);
    if (!isStale(snap.data())) return false;
    tx.update(retryRef, {
      status: "failed",
      error_message: "Régénération interrompue (délai dépassé) — crédits remboursés.",
      updated_at: new Date().toISOString(),
    });
    return true;
  });
  if (!shouldRefund) return false;

  const userId = typeof data.user_id === "string" ? data.user_id : null;
  const reserved = typeof data.reserved_amount === "number" ? data.reserved_amount : 0;
  const recovered = typeof data.recovered === "number" ? data.recovered : 0;
  const perPage = typeof data.per_page === "number" ? data.per_page : 0;
  const refundAmount = Math.max(0, reserved - recovered * perPage);
  const bookId = typeof data.book_id === "string" ? data.book_id : null;
  const pageIds = Array.isArray(data.page_ids)
    ? data.page_ids.filter((id): id is string => typeof id === "string")
    : [];

  // Unlock pages still marked generating under this retry token.
  if (bookId && pageIds.length) {
    const pagesCol = db.collection("books").doc(bookId).collection("pages");
    await Promise.all(
      pageIds.map(async (pageId) => {
        try {
          const ref = pagesCol.doc(pageId);
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) return;
            const p = snap.data()!;
            if (
              p.generation_status === "generating" &&
              p.retry_token === retryId
            ) {
              tx.update(ref, {
                generation_status: "failed",
                retry_token: null,
                updated_at: new Date().toISOString(),
              });
            }
          });
        } catch {
          /* ignore single-page unlock errors */
        }
      })
    );
  }

  if (userId && refundAmount > 0) {
    await new CreditService(db).refund(
      userId,
      refundAmount,
      "Remboursement — régénération interrompue (délai dépassé)",
      `retry:${retryId}:refund`
    );
  }
  console.warn(
    `[reaper] retry ${retryId} reaped (refund ${refundAmount} to ${userId})`
  );
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

/** Sweep all stranded generations + retries (cron). Returns how many were reaped. */
export async function reapStaleGenerations(db: Firestore, limit = 200): Promise<number> {
  // Single-field filter only (no composite index needed); staleness is checked
  // in code and re-checked inside the transaction.
  const snaps = await Promise.all([
    db.collection("generations").where("status", "==", "running").limit(limit).get(),
    db.collection("generations").where("status", "==", "queued").limit(limit).get(),
    db.collection("generation_retries").where("status", "==", "running").limit(limit).get(),
  ]);
  let reaped = 0;
  for (let i = 0; i < 2; i++) {
    for (const doc of snaps[i]!.docs) {
      const data = doc.data();
      if (!isStale(data)) continue;
      try {
        if (await reapOne(db, doc.id, data)) reaped += 1;
      } catch (err) {
        console.error(`[reaper] failed for ${doc.id}`, err);
      }
    }
  }
  for (const doc of snaps[2]!.docs) {
    const data = doc.data();
    if (!isStale(data)) continue;
    try {
      if (await reapRetryOne(db, doc.id, data)) reaped += 1;
    } catch (err) {
      console.error(`[reaper] retry failed for ${doc.id}`, err);
    }
  }
  return reaped;
}
