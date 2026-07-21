import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebase/admin";
import { CreditService } from "@/services/credit-service";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

export async function POST(request: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new AppError("INTERNAL_ERROR", "Stripe non configuré", 500);
    }

    const stripe = getStripe();
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new AppError("VALIDATION_ERROR", "Signature manquante", 400);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new AppError("VALIDATION_ERROR", "Signature invalide", 400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      const credits = Number(session.metadata?.credits || 0);
      if (userId && credits > 0) {
        const db = getAdminDb();
        // Idempotent on the Stripe event id: replayed/duplicate deliveries
        // (Stripe retries webhooks) credit the account exactly once.
        await new CreditService(db).credit(
          userId,
          credits,
          "Achat de crédits",
          `stripe:${event.id}`
        );
        if (session.id) {
          const txs = await db
            .collection("transactions")
            .where("reference", "==", session.id)
            .limit(1)
            .get();
          for (const doc of txs.docs) {
            await doc.ref.update({ status: "completed" });
          }
        }
      }
    }

    return apiSuccess({ received: true });
  } catch (e) {
    return apiError(e);
  }
}
