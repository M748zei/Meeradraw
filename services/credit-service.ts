import { AppError } from "@/lib/errors";
import { LicenseService } from "@/services/license-service";
import type { Firestore } from "firebase-admin/firestore";

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

  async ensureEnough(userId: string, amount: number) {
    if (await this.isAdminUser(userId)) {
      const balance = await this.getBalance(userId);
      // Keep admin generation unblocked; quietly top up when balance is drained.
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

  async debit(userId: string, amount: number, reason: string, referenceId?: string) {
    const balance = await this.ensureEnough(userId, amount);
    const next = balance - amount;
    const ref = this.db.collection("users").doc(userId);
    await ref.update({ credits: next, updated_at: new Date().toISOString() });
    await ref.collection("credit_ledger").add({
      operation: "debit",
      amount,
      balance_after: next,
      reason,
      reference_id: referenceId ?? null,
      created_at: new Date().toISOString(),
    });
    return next;
  }

  async credit(userId: string, amount: number, reason: string, referenceId?: string) {
    const balance = await this.getBalance(userId);
    const next = balance + amount;
    const ref = this.db.collection("users").doc(userId);
    await ref.update({ credits: next, updated_at: new Date().toISOString() });
    await ref.collection("credit_ledger").add({
      operation: "credit",
      amount,
      balance_after: next,
      reason,
      reference_id: referenceId ?? null,
      created_at: new Date().toISOString(),
    });
    return next;
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
