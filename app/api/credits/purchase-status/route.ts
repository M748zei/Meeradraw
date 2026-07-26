import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";

const saleSchema = z.string().min(6).max(120).regex(/^[A-Za-z0-9_-]+$/);

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser();
    const sale = saleSchema.safeParse(new URL(request.url).searchParams.get("sale"));
    if (!sale.success) {
      throw new AppError("VALIDATION_ERROR", "Référence de paiement invalide.", 400);
    }

    const referenceId = `chariow:${sale.data}`;
    const ledger = await db
      .collection("users")
      .doc(user.id)
      .collection("credit_ledger")
      .where("reference_id", "==", referenceId)
      .limit(1)
      .get();

    if (!ledger.empty) {
      const entry = ledger.docs[0].data();
      return apiSuccess({
        state: "confirmed",
        credits: typeof entry.amount === "number" ? entry.amount : 0,
        balance: typeof entry.balance_after === "number" ? entry.balance_after : null,
      });
    }

    const transactions = await db
      .collection("transactions")
      .where("reference", "==", sale.data)
      .limit(1)
      .get();
    const transaction = transactions.docs[0]?.data();

    if (!transaction || transaction.user_id !== user.id) {
      return apiSuccess({ state: "not_found" });
    }

    return apiSuccess({ state: "pending" });
  } catch (error) {
    return apiError(error);
  }
}
