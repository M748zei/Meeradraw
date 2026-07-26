import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit-store";
import { RECHARGE_PACKS } from "@/config/credits";
import { safeRechargeReturnPath } from "@/lib/recharge-return";
import {
  CHECKOUT_PHONE_COUNTRIES,
  normalizeCheckoutPhone,
} from "@/lib/checkout-phone";
import { z } from "zod";

/**
 * Frictionless recharge: creates a Chariow checkout for a credit pack with the
 * buyer's info pre-filled, and returns the hosted payment URL. The credits are
 * granted by the `successful.sale` Pulse webhook — never here.
 *
 * CHARIOW_API_KEY stays server-side only.
 */

const schema = z.object({
  pack_id: z.string().refine((id) => RECHARGE_PACKS.some((pack) => pack.id === id)),
  phone: z
    .object({
      number: z.string().min(6).max(20),
      country_code: z.enum(
        Object.keys(CHECKOUT_PHONE_COUNTRIES) as [
          keyof typeof CHECKOUT_PHONE_COUNTRIES,
          ...(keyof typeof CHECKOUT_PHONE_COUNTRIES)[],
        ]
      ),
    })
    .optional(),
  return_to: z.string().max(300).optional(),
});

const API_BASE = () => process.env.CHARIOW_API_BASE || "https://api.chariow.com/v1";

export async function POST(request: Request) {
  try {
    const { db, user, profile } = await requireUser();
    rateLimit(`checkout:${user.id}`, { limit: 10, windowMs: 60_000 });
    const body = schema.parse(await request.json());
    const pack = RECHARGE_PACKS.find((p) => p.id === body.pack_id)!;
    const returnTo = safeRechargeReturnPath(body.return_to);

    const apiKey = process.env.CHARIOW_API_KEY?.trim();
    const storeBase = (process.env.NEXT_PUBLIC_CHARIOW_STORE_URL || "").replace(/\/[^/]*$/, "");
    const hostedUrl = storeBase ? `${storeBase}/${pack.chariowProductId}` : null;

    if (!apiKey) {
      // No API key (dev) — fall back to the hosted product page.
      if (hostedUrl) return apiSuccess({ checkout_url: hostedUrl, fallback: true });
      throw new AppError("INTERNAL_ERROR", "Paiement non configuré.", 500);
    }

    const email = (user.email || profile.email || "").trim();
    if (!email) throw new AppError("VALIDATION_ERROR", "Email du compte introuvable.", 400);
    const fullname = (profile.fullname || "").trim();
    const [firstName, ...rest] = fullname ? fullname.split(/\s+/) : ["Client"];
    const lastName = rest.join(" ") || "Meeradraw";

    // Chariow requires a phone (Mobile Money). Use the one sent by the client,
    // else the profile one; without any, tell the client to collect it first.
    const phone = normalizeCheckoutPhone(body.phone ?? profile.phone);
    if (!phone) {
      return apiSuccess({ need_phone: true });
    }
    if (body.phone) {
      // Remember for next time — the next recharge is one click.
      await db.collection("users").doc(user.id).set(
        { phone, updated_at: new Date().toISOString() },
        { merge: true }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://meeradraw.digiafrik.shop";

    const res = await fetch(`${API_BASE()}/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: pack.chariowProductId,
        email,
        first_name: firstName.slice(0, 50),
        last_name: lastName.slice(0, 50),
        phone,
        redirect_url: `${appUrl}/merci?sale={sale_id}${
          returnTo ? `&return_to=${encodeURIComponent(returnTo)}` : ""
        }`,
        custom_metadata: {
          meeradraw_user_id: user.id,
          pack_id: pack.id,
        },
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: {
        step?: string;
        purchase?: { id?: string };
        payment?: { checkout_url?: string };
        message?: string;
      };
      message?: string;
    };

    if (!res.ok) {
      console.warn(`[checkout] Chariow API ${res.status}: ${json.message ?? "?"} — fallback boutique`);
      if (hostedUrl) return apiSuccess({ checkout_url: hostedUrl, fallback: true });
      throw new AppError("PAYMENT_FAILED", json.message || "Paiement indisponible, réessaie.", 502);
    }

    const data = json.data ?? {};
    const saleId = data.purchase?.id ?? null;

    if (data.step === "payment" && data.payment?.checkout_url) {
      await db.collection("transactions").add({
        user_id: user.id,
        provider: "chariow",
        amount: pack.priceFcfa,
        currency: "xof",
        status: "pending",
        reference: saleId,
        metadata: {
          pack_id: pack.id,
          credits: pack.credits,
          return_to: returnTo,
        },
        created_at: new Date().toISOString(),
      });
      return apiSuccess({ checkout_url: data.payment.checkout_url, sale_id: saleId });
    }

    if (data.step === "completed") {
      // Free product edge case — credits arrive via the webhook.
      return apiSuccess({ completed: true, sale_id: saleId });
    }

    if (data.step === "already_purchased") {
      // License products are rebuyable; if Chariow still reports this, send the
      // buyer to the hosted page where they can complete a new purchase.
      if (hostedUrl) return apiSuccess({ checkout_url: hostedUrl, fallback: true });
      return apiSuccess({ already_purchased: true });
    }

    if (hostedUrl) return apiSuccess({ checkout_url: hostedUrl, fallback: true });
    throw new AppError("PAYMENT_FAILED", "Réponse de paiement inattendue.", 502);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
