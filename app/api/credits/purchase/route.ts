import { CREDIT_PACKS } from "@/config/credits";
import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { CreditService } from "@/services/credit-service";
import { getStripe } from "@/lib/stripe";
import { z } from "zod";

const schema = z.object({
  pack_id: z.enum(["starter", "creator", "studio", "pro"]),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    const { pack_id } = schema.parse(await request.json());
    const pack = CREDIT_PACKS.find((p) => p.id === pack_id);
    if (!pack) throw new AppError("NOT_FOUND", "Pack introuvable", 404);

    if (!process.env.STRIPE_SECRET_KEY) {
      const next = await new CreditService(db).credit(
        user.id,
        pack.credits,
        `Pack ${pack.name} (mode démo)`
      );
      return apiSuccess({ demo: true, credits_added: pack.credits, balance: next });
    }

    const stripe = getStripe();
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: pack.priceEur,
            product_data: {
              name: `Meeradraw — ${pack.name}`,
              description: `${pack.credits} crédits`,
            },
          },
        },
      ],
      metadata: {
        user_id: user.id,
        pack_id: pack.id,
        credits: String(pack.credits),
      },
      success_url: `${origin}/credits?success=1`,
      cancel_url: `${origin}/credits?canceled=1`,
    });

    await db.collection("transactions").add({
      user_id: user.id,
      provider: "stripe",
      amount: pack.priceEur,
      currency: "eur",
      status: "pending",
      reference: session.id,
      metadata: { pack_id: pack.id, credits: pack.credits },
      created_at: new Date().toISOString(),
    });

    return apiSuccess({ checkout_url: session.url });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
