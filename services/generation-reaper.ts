import { CreditService } from "@/services/credit-service";
import {
  HEARTBEAT_STALE_MS,
  isHeartbeatStale,
} from "@/lib/generation-lifecycle";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Reaper for generations stranded in `queued`/`running` (Vercel timeout, crash
 * before the catch block, lost instance). Marks them failed+cancelled, fails
 * the book, and refunds the reservation.
 *
 * Stale = no heartbeat for HEARTBEAT_STALE_MS (default 15 min), not wall-clock
 * from start — live workflows keep heartbeating during long fal waits.
 *
 * Refund uses `gen:<id>:refund:full` so a prior partial refund cannot block a
 * full failure refund (and vice versa). Idempotent: concurrent reaper +
 * orchestrator fail paths share the same key.
 *
 * Wired in:
 * - GET /api/generation/[id] (polling) — self-heals the gen being watched.
 * - GET /api/cron/reap-generations — daily sweep.
 * - POST /api/generation/start — dead-resume when heartbeat is stale.
 */

function isStale(data: Record<string, unknown> | undefined): boolean {
  return isHeartbeatStale(data);
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
  data: Record<string, unknown>,
  opts?: { force?: boolean }
): Promise<boolean> {
  const genRef = db.collection("generations").doc(genId);
  // First fence the worker without making the generation terminal. If the
  // refund fails, queued/running + cancelled remains eligible for the next
  // poll/cron pass, so a transient Firestore failure can never strand credits.
  const shouldRefund = await db.runTransaction(async (tx) => {
    const snap = await tx.get(genRef);
    const live = snap.data();
    if (!live) return false;
    const status = live.status;
    if (status !== "queued" && status !== "running") return false;
    if (!opts?.force && !isStale(live)) return false;
    const now = new Date().toISOString();
    tx.update(genRef, {
      cancelled: true,
      refund_pending: true,
      error_message:
        "Génération interrompue. Le remboursement automatique est en cours.",
      updated_at: now,
      heartbeat_at: now,
    });
    return true;
  });
  if (!shouldRefund) return false;

  const userId = typeof data.user_id === "string" ? data.user_id : null;
  const bookId = typeof data.book_id === "string" ? data.book_id : null;
  const cost = typeof data.credits_used === "number" ? data.credits_used : 0;

  // Compensation must succeed before the generation becomes terminal. Both
  // operations are idempotent, so another reaper can safely resume here.
  if (userId && cost > 0) {
    await new CreditService(db).refund(
      userId,
      cost,
      "Remboursement — génération interrompue (délai dépassé)",
      `gen:${genId}:refund:full`
    );
  }
  await releaseTrialSlotIfNeeded(db, genId, data);

  if (bookId) {
    const bookRef = db.collection("books").doc(bookId);
    await db
      .runTransaction(async (tx) => {
        const book = await tx.get(bookRef);
        if (!book.exists) return;
        const active = book.data()?.active_generation_id;
        // Only clear the lock if it still points at this generation.
        if (active != null && active !== genId) return;
        tx.set(
          bookRef,
          {
            status: "failed",
            active_generation_id: null,
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      })
      .catch(() => undefined);
  }
  const completedAt = new Date().toISOString();
  await genRef.set(
    {
      status: "failed",
      cancelled: true,
      refund_pending: false,
      credits_used: 0,
      error_message:
        "Génération interrompue (délai dépassé). Tes crédits ont été remboursés — relance quand tu veux.",
      updated_at: completedAt,
      heartbeat_at: completedAt,
    },
    { merge: true }
  );
  console.warn(
    `[reaper] generation ${genId} reaped (refund ${cost} to ${userId}, stale>${HEARTBEAT_STALE_MS}ms)`
  );
  return true;
}

async function reapRetryOne(
  db: Firestore,
  retryId: string
): Promise<boolean> {
  const retryRef = db.collection("generation_retries").doc(retryId);
  // Fence the abandoned worker without making the retry terminal. A transient
  // refund failure must leave the document queryable by the next cron pass.
  const retryData = await db.runTransaction(async (tx) => {
    const snap = await tx.get(retryRef);
    const live = snap.data();
    if (!live || live.status !== "running" || !isStale(live)) return null;
    const now = new Date().toISOString();
    tx.update(retryRef, {
      cancelled: true,
      refund_pending: true,
      error_message:
        "Régénération interrompue. Le remboursement automatique est en cours.",
      updated_at: now,
      heartbeat_at: now,
    });
    return live as Record<string, unknown>;
  });
  if (!retryData) return false;

  // Use the transaction snapshot rather than the earlier query snapshot: a
  // page may have completed between the sweep query and the cancellation fence.
  const userId =
    typeof retryData.user_id === "string" ? retryData.user_id : null;
  const reserved =
    typeof retryData.reserved_amount === "number"
      ? retryData.reserved_amount
      : 0;
  const recovered =
    typeof retryData.recovered === "number" ? retryData.recovered : 0;
  const perPage =
    typeof retryData.per_page === "number" ? retryData.per_page : 0;
  const refundAmount = Math.max(0, reserved - recovered * perPage);
  const bookId =
    typeof retryData.book_id === "string" ? retryData.book_id : null;
  const pageIds = Array.isArray(retryData.page_ids)
    ? retryData.page_ids.filter((id): id is string => typeof id === "string")
    : [];

  // Compensation first. If this throws, status remains `running` with
  // `cancelled=true`, which is immediately stale and safe to retry.
  if (userId && refundAmount > 0) {
    await new CreditService(db).refund(
      userId,
      refundAmount,
      "Remboursement — régénération interrompue (délai dépassé)",
      `retry:${retryId}:refund`
    );
  }

  // Only unlock pages after compensation is confirmed. The token condition
  // prevents this old retry from touching a page claimed by a newer retry.
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

  const completedAt = new Date().toISOString();
  await retryRef.set(
    {
      status: "failed",
      cancelled: true,
      refund_pending: false,
      refunded_amount: refundAmount,
      error_message:
        "Régénération interrompue (délai dépassé) — crédits remboursés.",
      updated_at: completedAt,
      heartbeat_at: completedAt,
    },
    { merge: true }
  );
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

/**
 * Force-fail a queued/running generation (dead resume on start).
 * Idempotent with reapIfStale / failRun via refund:full key.
 */
export async function reapDeadGeneration(
  db: Firestore,
  genId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    return await reapOne(db, genId, data, { force: true });
  } catch (err) {
    console.error(`[reaper] force reap failed for ${genId}`, err);
    return false;
  }
}

/** Sweep all stranded generations + retries (cron). Returns how many were reaped. */
export async function reapStaleGenerations(db: Firestore, limit = 200): Promise<number> {
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
      if (await reapRetryOne(db, doc.id)) reaped += 1;
    } catch (err) {
      console.error(`[reaper] retry failed for ${doc.id}`, err);
    }
  }
  return reaped;
}
