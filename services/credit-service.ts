import { AppError } from "@/lib/errors";
import { LicenseService } from "@/services/license-service";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Credit ledger — the single source of truth for a user's usage balance.
 *
 * All balance mutations run inside a Firestore transaction so concurrent
 * operations (a Stripe webhook credit landing while a generation debit runs,
 * two retries firing at once, N parallel generations) can never lose an update.
 *
 * Idempotency: pass a stable `referenceId`. If a ledger entry already exists for
 * that (operation, reference_id) pair, the mutation is a no-op and the current
 * balance is returned. This makes Stripe webhooks and generation debits safe to
 * replay.
 */
export class CreditService {
  constructor(private db: Firestore) {}

  async getBalance(userId: string): Promise<number> {
    const snap = await this.db.collection("users").doc(userId).get();
    if (!snap.exists) throw new AppError("NOT_FOUND", "Profil introuvable", 404);
    return (snap.data()?.credits as number) ?? 0;
  }

  private async isAdminUser(userId: string): Promise<boolean> {
    const snap = await this.db.collection("users").doc(userId).get();
    const email = snap.data()?.email;
    return LicenseService.isAdminEmail(typeof email === "string" ? email : null);
  }

  /**
   * Balance guard for a would-be debit. Admins are quietly topped up so their
   * generations never block. Non-admins throw INSUFFICIENT_CREDITS when short.
   * This is a *check*, not a reservation — use `reserve()` to actually hold funds.
   */
  async ensureEnough(userId: string, amount: number) {
    if (await this.isAdminUser(userId)) {
      const balance = await this.getBalance(userId);
      if (balance < amount) {
        return this.credit(
          userId,
          Math.max(amount * 2, 100),
          "Recharge automatique administrateur"
        );
      }
      return balance;
    }
    const balance = await this.getBalance(userId);
    if (balance < amount) {
      throw new AppError(
        "INSUFFICIENT_CREDITS",
        `Il vous manque ${amount - balance} crédits.`,
        402
      );
    }
    return balance;
  }

  /**
   * Atomically reserve (debit up-front) `amount` credits before starting paid
   * work. Fails closed with INSUFFICIENT_CREDITS if the live balance is short,
   * checked *inside* the transaction so parallel reservations can't oversell.
   * Admins are auto-topped-up within the same transaction.
   *
   * Returns the new balance. Refund the unused portion with `refund()` when the
   * work finishes (fully, partially, or fails). Capture on success with `capture()`.
   */
  async reserve(userId: string, amount: number, reason: string, referenceId?: string) {
    if (amount <= 0) return this.getBalance(userId);
    const admin = await this.isAdminUser(userId);
    return this.applyDelta(userId, -amount, "debit", reason, referenceId, admin, "reservation");
  }

  /**
   * Mark a reservation as permanently captured after a successful book delivery.
   * Balance is unchanged (already debited at reserve). Idempotent via referenceId.
   */
  async capture(userId: string, amount: number, reason: string, referenceId?: string) {
    if (amount <= 0) return this.getBalance(userId);
    return this.applyDelta(
      userId,
      0,
      "capture",
      reason,
      referenceId,
      false,
      "capture",
      amount
    );
  }

  /**
   * Refund credits previously reserved (e.g. pages that failed to generate).
   * Use distinct referenceIds for partial vs full:
   *   `gen:<id>:refund:partial` / `gen:<id>:refund:full`
   * so a partial refund never blocks a later full failure refund.
   */
  async refund(userId: string, amount: number, reason: string, referenceId?: string) {
    if (amount <= 0) return this.getBalance(userId);
    return this.applyDelta(userId, amount, "credit", reason, referenceId, false, "refund");
  }

  async debit(userId: string, amount: number, reason: string, referenceId?: string) {
    if (amount <= 0) return this.getBalance(userId);
    const admin = await this.isAdminUser(userId);
    return this.applyDelta(userId, -amount, "debit", reason, referenceId, admin, "debit");
  }

  async credit(userId: string, amount: number, reason: string, referenceId?: string) {
    if (amount <= 0) return this.getBalance(userId);
    return this.applyDelta(userId, amount, "credit", reason, referenceId, false, "credit");
  }

  /**
   * Core atomic balance mutation. `delta` is signed (negative = spend).
   * When `autoTopUp` is set (admins), the balance is raised inside the same
   * transaction if it would otherwise go negative, so admin actions never fail.
   * `delta === 0` is allowed for capture markers (balance unchanged).
   */
  private async applyDelta(
    userId: string,
    delta: number,
    operation: "credit" | "debit" | "capture",
    reason: string,
    referenceId: string | undefined,
    autoTopUp: boolean,
    kind:
      | "reservation"
      | "capture"
      | "refund"
      | "release"
      | "credit"
      | "debit" = "debit",
    ledgerAmount?: number
  ): Promise<number> {
    const userRef = this.db.collection("users").doc(userId);
    const ledgerRef = userRef.collection("credit_ledger");
    const now = new Date().toISOString();

    return this.db.runTransaction(async (tx) => {
      // Idempotency: if a ledger entry with this (operation, reference_id) exists,
      // this mutation already happened — return the current balance unchanged.
      if (referenceId) {
        const dup = await tx.get(
          ledgerRef
            .where("operation", "==", operation)
            .where("reference_id", "==", referenceId)
            .limit(1)
        );
        if (!dup.empty) {
          const snap = await tx.get(userRef);
          return (snap.data()?.credits as number) ?? 0;
        }
      }

      const snap = await tx.get(userRef);
      if (!snap.exists) throw new AppError("NOT_FOUND", "Profil introuvable", 404);
      const balance = (snap.data()?.credits as number) ?? 0;

      if (delta === 0) {
        tx.set(ledgerRef.doc(), {
          operation,
          kind,
          amount: Math.max(0, ledgerAmount ?? 0),
          balance_after: balance,
          reason,
          reference_id: referenceId ?? null,
          created_at: now,
        });
        return balance;
      }

      const appliedDelta = delta;
      let topUp = 0;
      if (delta < 0 && balance + delta < 0) {
        if (autoTopUp) {
          // Raise the balance so the spend still leaves a small buffer.
          topUp = Math.max(-delta * 2, 100);
        } else {
          throw new AppError(
            "INSUFFICIENT_CREDITS",
            `Il vous manque ${-(balance + delta)} crédits.`,
            402
          );
        }
      }

      if (topUp > 0) {
        const afterTopUp = balance + topUp;
        tx.set(ledgerRef.doc(), {
          operation: "credit",
          kind: "credit",
          amount: topUp,
          balance_after: afterTopUp,
          reason: "Recharge automatique administrateur",
          reference_id: null,
          created_at: now,
        });
        const next = afterTopUp + appliedDelta;
        tx.update(userRef, { credits: next, updated_at: now });
        tx.set(ledgerRef.doc(), {
          operation,
          kind,
          amount: Math.abs(appliedDelta),
          balance_after: next,
          reason,
          reference_id: referenceId ?? null,
          created_at: now,
        });
        return next;
      }

      const next = balance + appliedDelta;
      tx.update(userRef, { credits: next, updated_at: now });
      tx.set(ledgerRef.doc(), {
        operation,
        kind,
        amount: Math.abs(appliedDelta),
        balance_after: next,
        reason,
        reference_id: referenceId ?? null,
        created_at: now,
      });
      return next;
    });
  }

  async history(userId: string, limit = 20) {
    const snap = await this.db
      .collection("users")
      .doc(userId)
      .collection("credit_ledger")
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}
