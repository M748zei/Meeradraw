import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/**
 * Signed HTTP-only cookie that carries post-purchase context across
 * signup / Google OAuth / refresh. Never stores Chariow API secrets.
 */
export const PURCHASE_COOKIE = "__md_purchase";
const MAX_AGE_SEC = 60 * 60 * 24; // 24h

export type PurchaseContext = {
  saleId: string;
  email: string;
  productId: string | null;
  exp: number;
};

function signingSecret() {
  return (
    process.env.PURCHASE_CONTEXT_SECRET?.trim() ||
    process.env.CHARIOW_WEBHOOK_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}

function sign(payloadB64: string, secret: string) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function encodePurchaseContext(ctx: Omit<PurchaseContext, "exp">, ttlSec = MAX_AGE_SEC) {
  const secret = signingSecret();
  if (!secret) {
    throw new Error("PURCHASE_CONTEXT_SECRET (ou CHARIOW_WEBHOOK_SECRET) requis");
  }
  const full: PurchaseContext = {
    ...ctx,
    email: ctx.email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const payloadB64 = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function decodePurchaseContext(raw: string | null | undefined): PurchaseContext | null {
  if (!raw) return null;
  const secret = signingSecret();
  if (!secret) return null;
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as PurchaseContext;
    if (!parsed?.saleId || !parsed?.email || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      saleId: String(parsed.saleId),
      email: String(parsed.email).trim().toLowerCase(),
      productId: parsed.productId != null ? String(parsed.productId) : null,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export async function setPurchaseContextCookie(ctx: Omit<PurchaseContext, "exp">) {
  const value = encodePurchaseContext(ctx);
  const store = await cookies();
  store.set(PURCHASE_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SEC,
    path: "/",
    sameSite: "lax",
  });
}

export async function getPurchaseContextCookie(): Promise<PurchaseContext | null> {
  const store = await cookies();
  return decodePurchaseContext(store.get(PURCHASE_COOKIE)?.value);
}

export async function clearPurchaseContextCookie() {
  const store = await cookies();
  store.set(PURCHASE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
    sameSite: "lax",
  });
}
