import { packForChariowProduct } from "@/config/credits";
import { CreditService } from "@/services/credit-service";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Credits granted by Chariow purchases (Pulse `successful.sale`).
 *
 * Money-safety invariants:
 * - Idempotent per sale: the CreditService reference_id is `chariow:<sale_id>`,
 *   so replaying the same webhook can never credit twice.
 * - Never credits "into the void": when the buyer's email matches no account,
 *   the sale is parked in `chariow_pending_credits` and claimed at the buyer's
 *   next login (same idempotent reference).
 */

type SalePayload = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function extractSale(payload: SalePayload) {
  const sale = (payload.sale as Record<string, unknown> | undefined) ?? {};
  const product = (payload.product as Record<string, unknown> | undefined) ?? {};
  const customer = (payload.customer as Record<string, unknown> | undefined) ?? {};
  return {
    saleId: str(sale.id),
    productId: product.id != null ? String(product.id) : null,
    email: str(customer.email)?.toLowerCase() ?? null,
    customerName: str(customer.name),
  };
}

export async function applyChariowSale(db: Firestore, payload: SalePayload) {
  const { saleId, productId, email, customerName } = extractSale(payload);
  const pack = packForChariowProduct(productId);

  if (!saleId || !pack) {
    // Not one of our credit packs (or malformed payload) — nothing to credit.
    return { credited: 0, pack: null, pending: false };
  }

  const userId = email ? await findUserIdByEmail(db, email) : null;

  if (!userId) {
    // Buyer has no Meeradraw account yet (or bought with a different email).
    // Park the credits; claimed on their next login via claimPendingCredits().
    await db.collection("chariow_pending_credits").doc(saleId).set(
      {
        sale_id: saleId,
        email,
        customer_name: customerName,
        product_id: productId,
        pack_id: pack.id,
        credits: pack.credits,
        status: "pending",
        created_at: new Date().toISOString(),
      },
      { merge: true }
    );
    console.warn(
      `[chariow] sale ${saleId}: no account for ${email ?? "unknown email"} — credits parked for reconciliation`
    );
    return { credited: 0, pack: pack.id, pending: true };
  }

  await new CreditService(db).credit(
    userId,
    pack.credits,
    `Achat ${pack.name} — ${pack.credits} crédits`,
    `chariow:${saleId}`
  );
  return { credited: pack.credits, pack: pack.id, pending: false, userId };
}

/**
 * Reverse credits granted by a prior `successful.sale` when Chariow reports a
 * refund/cancellation. Idempotent via `chariow:<saleId>:clawback`. Debits at
 * most the live balance (never goes negative); remaining debt is recorded on
 * the sale doc for ops reconciliation.
 */
export async function reverseChariowSale(db: Firestore, payload: SalePayload) {
  const { saleId, productId, email } = extractSale(payload);
  const pack = packForChariowProduct(productId);

  if (!saleId) {
    return { reversed: 0, pack: null, pending_cancelled: false };
  }

  // Cancel any parked pending credit for this sale.
  const pendingRef = db.collection("chariow_pending_credits").doc(saleId);
  const pendingSnap = await pendingRef.get();
  let pendingCancelled = false;
  if (pendingSnap.exists && pendingSnap.data()?.status === "pending") {
    await pendingRef.set(
      {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      },
      { merge: true }
    );
    pendingCancelled = true;
  }

  if (!pack) {
    return { reversed: 0, pack: null, pending_cancelled: pendingCancelled };
  }

  const userId = email ? await findUserIdByEmail(db, email) : null;
  if (!userId) {
    return { reversed: 0, pack: pack.id, pending_cancelled: pendingCancelled };
  }

  const credits = new CreditService(db);
  const balance = await credits.getBalance(userId);
  const toClaw = Math.min(balance, pack.credits);
  if (toClaw > 0) {
    await credits.debit(
      userId,
      toClaw,
      `Annulation achat ${pack.name} — reprise de ${toClaw} crédits`,
      `chariow:${saleId}:clawback`
    );
  }
  const debt = pack.credits - toClaw;
  await db.collection("chariow_sale_reversals").doc(saleId).set(
    {
      sale_id: saleId,
      user_id: userId,
      pack_id: pack.id,
      requested: pack.credits,
      reversed: toClaw,
      debt,
      created_at: new Date().toISOString(),
    },
    { merge: true }
  );
  return {
    reversed: toClaw,
    debt,
    pack: pack.id,
    pending_cancelled: pendingCancelled,
    userId,
  };
}

async function findUserIdByEmail(db: Firestore, email: string): Promise<string | null> {
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  return null;
}

/**
 * Claim credits parked for this email (purchase made before signup, webhook
 * raced the account creation, …). Called at login — cheap single query.
 */
export async function claimPendingCredits(db: Firestore, userId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;
  const snap = await db
    .collection("chariow_pending_credits")
    .where("email", "==", normalized)
    .where("status", "==", "pending")
    .get();

  let total = 0;
  const credits = new CreditService(db);
  for (const doc of snap.docs) {
    const data = doc.data();
    const amount = typeof data.credits === "number" ? data.credits : 0;
    const saleId = (data.sale_id as string) || doc.id;
    if (amount <= 0) continue;
    // Same reference as the direct path — safe even if the webhook retries
    // concurrently with this claim.
    await credits.credit(
      userId,
      amount,
      `Achat ${String(data.pack_id ?? "pack")} — ${amount} crédits (réconciliation)`,
      `chariow:${saleId}`
    );
    await doc.ref.set(
      { status: "claimed", user_id: userId, claimed_at: new Date().toISOString() },
      { merge: true }
    );
    total += amount;
  }
  return total;
}
