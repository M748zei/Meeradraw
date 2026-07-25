import { CREDIT_PACKS, packForChariowProduct } from "@/config/credits";
import { SUPPORT_EMAIL } from "@/config/support";
import { AppError } from "@/lib/errors";
import { maskEmail } from "@/lib/mask-email";
import {
  getSale,
  isChariowConfigured,
  listLicenses,
  type ChariowSale,
} from "@/lib/chariow/client";
import { CreditService } from "@/services/credit-service";
import { LicenseService } from "@/services/license-service";
import type { Firestore } from "firebase-admin/firestore";

export { SUPPORT_EMAIL };
export const PURCHASES_COLLECTION = "chariow_purchases";

export type PurchaseDoc = {
  sale_id: string;
  email: string;
  product_id: string | null;
  product_name: string | null;
  customer_id: string | null;
  status: "pending_payment" | "completed" | "attached" | "refunded" | "cancelled" | "failed" | "invalid";
  access_status: "none" | "pending" | "active" | "revoked" | "expired";
  user_id: string | null;
  license_key: string | null;
  license_id: string | null;
  pack_id: string | null;
  credits: number | null;
  unlocks_access: boolean;
  purchased_at: string | null;
  access_started_at: string | null;
  access_ends_at: string | null;
  max_devices: number | null;
  refunded_at: string | null;
  source: "redirect" | "webhook" | "attach";
  created_at: string;
  updated_at: string;
};

export type VerifyOutcome =
  | {
      state: "ready";
      saleId: string;
      emailMasked: string;
      email: string;
      productId: string | null;
      accountExists: boolean;
      unlocksAccess: boolean;
      credits: number | null;
      packName: string | null;
      alreadyAttachedToSession: boolean;
    }
  | { state: "missing_sale" }
  | { state: "pending_payment"; saleId: string }
  | { state: "invalid_product" }
  | { state: "refunded" }
  | { state: "already_other_account"; emailMasked: string }
  | { state: "already_attached"; redirectTo: string }
  | { state: "unavailable" }
  | { state: "not_configured" };

function nowIso() {
  return new Date().toISOString();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function isKnownMeeradrawProduct(productId: string | null | undefined): boolean {
  if (!productId) return false;
  const envId = process.env.CHARIOW_PRODUCT_ID?.trim();
  if (envId && productId === envId) return true;
  return CREDIT_PACKS.some((p) => p.chariowProductId === productId);
}

export function packUnlocksAccess(productId: string | null | undefined): boolean {
  if (!productId) return false;
  const pack = packForChariowProduct(productId);
  if (pack && "unlocksAccess" in pack && pack.unlocksAccess) return true;
  const envId = process.env.CHARIOW_PRODUCT_ID?.trim();
  return Boolean(envId && productId === envId);
}

async function findUserIdByEmail(db: Firestore, email: string): Promise<string | null> {
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  return null;
}

function saleStatusCategory(sale: ChariowSale): "completed" | "pending" | "failed" | "refunded" {
  const status = String(sale.status || "").toLowerCase();
  const payment = String(sale.payment?.status || "").toLowerCase();
  if (status === "failed" || status === "abandoned" || payment === "failed" || payment === "cancelled") {
    return "failed";
  }
  if (status === "awaiting_payment" || payment === "pending" || payment === "initiated") {
    return "pending";
  }
  // Chariow has no dedicated "refunded" sale status in docs; revoked licenses
  // / webhook refunds set our local doc. Treat completed + settled as paid.
  if (status === "completed" || status === "settled" || payment === "success") {
    return "completed";
  }
  return "pending";
}

function extractLicenseKeyFromSale(sale: ChariowSale): string | null {
  const licences = sale.fulfillment?.licences;
  if (!Array.isArray(licences)) return null;
  for (const lic of licences) {
    const key = str(lic?.licence_key);
    if (key) return key;
  }
  return null;
}

async function resolveLicenseKey(
  db: Firestore,
  sale: ChariowSale,
  productId: string | null
): Promise<{ key: string | null; licenseId: string | null; expiresAt: string | null; maxDevices: number | null }> {
  const fromSale = extractLicenseKeyFromSale(sale);
  if (fromSale) {
    const first = sale.fulfillment?.licences?.[0];
    return {
      key: fromSale,
      licenseId: str(first?.id),
      expiresAt: first?.expires_at ?? null,
      maxDevices: typeof first?.max_activations === "number" ? first.max_activations : null,
    };
  }

  // Pending from license.issued webhook (keyed by sale or email+product).
  const saleId = sale.id;
  const pendingBySale = await db.collection(PURCHASES_COLLECTION).doc(saleId).get();
  const storedKey = str(pendingBySale.data()?.license_key);
  if (storedKey) {
    return {
      key: storedKey,
      licenseId: str(pendingBySale.data()?.license_id),
      expiresAt: str(pendingBySale.data()?.access_ends_at),
      maxDevices:
        typeof pendingBySale.data()?.max_devices === "number"
          ? pendingBySale.data()!.max_devices
          : null,
    };
  }

  const customerId = str(sale.customer?.id);
  if (customerId && productId) {
    try {
      const licenses = await listLicenses({
        customer_id: customerId,
        product_id: productId,
        per_page: 20,
      });
      const usable =
        licenses.find((l) => l.status === "pending_activation" || l.can_activate) ||
        licenses.find((l) => l.is_active) ||
        licenses[0];
      if (usable?.license?.key) {
        return {
          key: usable.license.key,
          licenseId: usable.id,
          expiresAt: usable.expires_at ?? null,
          maxDevices: usable.activations?.max ?? null,
        };
      }
    } catch (err) {
      console.warn("[access-open] listLicenses failed", err instanceof Error ? err.message : err);
    }
  }

  return { key: null, licenseId: null, expiresAt: null, maxDevices: null };
}

export async function upsertPurchaseFromSale(
  db: Firestore,
  sale: ChariowSale,
  source: PurchaseDoc["source"]
): Promise<PurchaseDoc> {
  const saleId = sale.id;
  const email = str(sale.customer?.email)?.toLowerCase() ?? null;
  const productId = sale.product?.id != null ? String(sale.product.id) : null;
  const pack = packForChariowProduct(productId);
  const category = saleStatusCategory(sale);
  const license = await resolveLicenseKey(db, sale, productId);

  const ref = db.collection(PURCHASES_COLLECTION).doc(saleId);
  const existing = await ref.get();
  const prev = existing.data() as Partial<PurchaseDoc> | undefined;

  let status: PurchaseDoc["status"] =
    category === "completed"
      ? prev?.status === "attached"
        ? "attached"
        : "completed"
      : category === "failed"
        ? "failed"
        : "pending_payment";

  if (prev?.status === "refunded" || prev?.status === "cancelled") {
    status = prev.status;
  }

  const doc: PurchaseDoc = {
    sale_id: saleId,
    email: email || prev?.email || "",
    product_id: productId,
    product_name: str(sale.product?.name) || prev?.product_name || null,
    customer_id: str(sale.customer?.id) || prev?.customer_id || null,
    status,
    access_status:
      prev?.access_status === "active"
        ? "active"
        : status === "completed"
          ? "pending"
          : prev?.access_status || "none",
    user_id: prev?.user_id ?? null,
    license_key: license.key || prev?.license_key || null,
    license_id: license.licenseId || prev?.license_id || null,
    pack_id: pack?.id ?? prev?.pack_id ?? null,
    credits: pack?.credits ?? prev?.credits ?? null,
    unlocks_access: packUnlocksAccess(productId),
    purchased_at: sale.completed_at || sale.created_at || prev?.purchased_at || nowIso(),
    access_started_at: prev?.access_started_at ?? null,
    access_ends_at: license.expiresAt || prev?.access_ends_at || null,
    max_devices: license.maxDevices ?? prev?.max_devices ?? null,
    refunded_at: prev?.refunded_at ?? null,
    source: prev?.source || source,
    created_at: prev?.created_at || nowIso(),
    updated_at: nowIso(),
  };

  await ref.set(doc, { merge: true });
  return doc;
}

/**
 * Park a completed sale for later claim (webhook arrived before the buyer).
 */
export async function parkPendingAccessFromWebhook(
  db: Firestore,
  payload: Record<string, unknown>
) {
  const sale = (payload.sale as Record<string, unknown> | undefined) ?? {};
  const product = (payload.product as Record<string, unknown> | undefined) ?? {};
  const customer = (payload.customer as Record<string, unknown> | undefined) ?? {};
  const license = (payload.license as Record<string, unknown> | undefined) ?? {};
  const saleId = str(sale.id);
  const email = str(customer.email)?.toLowerCase();
  const productId = product.id != null ? String(product.id) : null;

  if (!saleId && !email) return { parked: false };

  const pack = packForChariowProduct(productId);
  const id = saleId || `email:${email}:${productId || "unknown"}`;
  const ref = db.collection(PURCHASES_COLLECTION).doc(id);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status === "attached") {
    return { parked: false, already_attached: true };
  }

  const licenseObj = (license.license as Record<string, unknown> | undefined) ?? {};
  const licenseKey =
    str(license.key) ||
    str(licenseObj.key) ||
    str(license.licence_key) ||
    null;

  const maxDevices =
    typeof license.max_activations === "number"
      ? license.max_activations
      : null;

  await ref.set(
    {
      sale_id: saleId || id,
      email: email || existing.data()?.email || "",
      product_id: productId,
      product_name: str(product.name) || null,
      customer_id: str(customer.id) || null,
      status: existing.data()?.status === "attached" ? "attached" : "completed",
      access_status: existing.data()?.access_status === "active" ? "active" : "pending",
      user_id: existing.data()?.user_id ?? null,
      license_key: licenseKey || existing.data()?.license_key || null,
      license_id: str(license.id) || existing.data()?.license_id || null,
      pack_id: pack?.id ?? null,
      credits: pack?.credits ?? null,
      unlocks_access: packUnlocksAccess(productId),
      purchased_at: str(sale.completed_at) || nowIso(),
      access_ends_at: str(license.expires_at) || null,
      max_devices: maxDevices ?? existing.data()?.max_devices ?? null,
      source: "webhook",
      created_at: existing.data()?.created_at || nowIso(),
      updated_at: nowIso(),
    },
    { merge: true }
  );
  return { parked: true, sale_id: id };
}

export async function markPurchaseRefunded(db: Firestore, saleId: string | null) {
  if (!saleId) return;
  await db.collection(PURCHASES_COLLECTION).doc(saleId).set(
    {
      status: "refunded",
      access_status: "revoked",
      refunded_at: nowIso(),
      updated_at: nowIso(),
    },
    { merge: true }
  );
}

export class AccessOpenService {
  constructor(private db: Firestore) {}

  async verifySale(saleIdRaw: string | null | undefined, sessionUserId?: string | null): Promise<VerifyOutcome> {
    const saleId = str(saleIdRaw);
    if (!saleId) return { state: "missing_sale" };

    if (!isChariowConfigured()) {
      // Dev: allow a soft path only when explicitly mocked — otherwise not_configured.
      if (process.env.NODE_ENV !== "production" && process.env.ACCESS_OPEN_DEV_BYPASS === "1") {
        return {
          state: "ready",
          saleId,
          email: "dev@example.com",
          emailMasked: maskEmail("dev@example.com"),
          productId: process.env.CHARIOW_PRODUCT_ID || "prd_d2ik58za",
          accountExists: false,
          unlocksAccess: true,
          credits: 120,
          packName: "Accès Meeradraw",
          alreadyAttachedToSession: false,
        };
      }
      return { state: "not_configured" };
    }

    let sale: ChariowSale;
    try {
      sale = await getSale(saleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/not found|404/i.test(msg)) return { state: "missing_sale" };
      console.error("[access-open] getSale failed", msg);
      return { state: "unavailable" };
    }

    const productId = sale.product?.id != null ? String(sale.product.id) : null;
    if (!isKnownMeeradrawProduct(productId)) {
      return { state: "invalid_product" };
    }

    const local = await this.db.collection(PURCHASES_COLLECTION).doc(saleId).get();
    const localData = local.data() as Partial<PurchaseDoc> | undefined;
    if (localData?.status === "refunded" || localData?.status === "cancelled") {
      return { state: "refunded" };
    }

    const category = saleStatusCategory(sale);
    if (category === "failed") return { state: "refunded" };
    if (category === "pending") return { state: "pending_payment", saleId };

    const purchase = await upsertPurchaseFromSale(this.db, sale, "redirect");
    if (!purchase.email) {
      console.error("[access-open] sale without email", saleId);
      return { state: "unavailable" };
    }

    if (purchase.user_id) {
      if (sessionUserId && purchase.user_id === sessionUserId) {
        return { state: "already_attached", redirectTo: "/create" };
      }
      if (!sessionUserId || purchase.user_id !== sessionUserId) {
        return {
          state: "already_other_account",
          emailMasked: maskEmail(purchase.email),
        };
      }
    }

    const accountExists = Boolean(await findUserIdByEmail(this.db, purchase.email));
    const pack = packForChariowProduct(purchase.product_id);

    return {
      state: "ready",
      saleId: purchase.sale_id,
      email: purchase.email,
      emailMasked: maskEmail(purchase.email),
      productId: purchase.product_id,
      accountExists,
      unlocksAccess: purchase.unlocks_access,
      credits: purchase.credits,
      packName: pack?.name ?? purchase.product_name,
      alreadyAttachedToSession: false,
    };
  }

  /**
   * Attach a verified purchase to an authenticated user.
   * Requires email ownership proof (same email + verified or Google).
   */
  async attachToUser(opts: {
    userId: string;
    userEmail: string | null | undefined;
    emailVerified: boolean;
    saleId: string;
  }) {
    const userEmail = str(opts.userEmail)?.toLowerCase();
    if (!userEmail) {
      throw new AppError("VALIDATION_ERROR", "Adresse e-mail du compte introuvable.", 400);
    }

    const purchaseRef = this.db.collection(PURCHASES_COLLECTION).doc(opts.saleId);
    let purchaseSnap = await purchaseRef.get();
    let purchase = purchaseSnap.data() as PurchaseDoc | undefined;

    if (!purchase || purchase.status === "pending_payment") {
      if (!isChariowConfigured()) {
        throw new AppError(
          "INTERNAL_ERROR",
          "Nous n’arrivons pas encore à confirmer votre achat. Réessayez dans quelques instants. Aucun nouveau paiement ne vous sera demandé.",
          503
        );
      }
      try {
        const sale = await getSale(opts.saleId);
        purchase = await upsertPurchaseFromSale(this.db, sale, "attach");
      } catch {
        throw new AppError(
          "INTERNAL_ERROR",
          "Nous n’arrivons pas encore à confirmer votre achat. Réessayez dans quelques instants. Aucun nouveau paiement ne vous sera demandé.",
          503
        );
      }
    }

    if (!purchase) {
      throw new AppError("NOT_FOUND", "Nous n’avons pas retrouvé votre achat.", 404);
    }

    if (purchase.status === "refunded" || purchase.status === "cancelled" || purchase.status === "failed") {
      throw new AppError(
        "FORBIDDEN",
        `Cet achat n’est plus valide. Contactez ${SUPPORT_EMAIL} si besoin.`,
        403
      );
    }

    if (!isKnownMeeradrawProduct(purchase.product_id)) {
      throw new AppError("FORBIDDEN", "Cet achat ne correspond pas à Meeradraw.", 403);
    }

    const purchaseEmail = str(purchase.email)?.toLowerCase();
    if (!purchaseEmail || purchaseEmail !== userEmail) {
      throw new AppError(
        "FORBIDDEN",
        `Pour protéger votre achat, connectez-vous avec l’adresse utilisée lors du paiement : ${maskEmail(purchaseEmail)}.`,
        403,
        undefined,
        { email_mismatch: true, email_masked: maskEmail(purchaseEmail) }
      );
    }

    // Ownership: Google accounts are verified by Google; email/password must be verified.
    if (!opts.emailVerified) {
      throw new AppError(
        "FORBIDDEN",
        "Confirmez votre adresse e-mail pour ouvrir votre accès (lien reçu dans votre boîte mail).",
        403,
        undefined,
        { email_unverified: true }
      );
    }

    if (purchase.user_id && purchase.user_id !== opts.userId) {
      throw new AppError(
        "CONFLICT",
        `Cet achat est déjà lié à un autre compte. Connectez-vous avec ${maskEmail(purchaseEmail)} ou contactez ${SUPPORT_EMAIL}.`,
        409
      );
    }

    // Idempotent: already attached to this user.
    if (purchase.user_id === opts.userId && purchase.status === "attached") {
      return {
        attached: true,
        duplicate: true,
        unlocksAccess: purchase.unlocks_access,
        credits: purchase.credits,
        accessEndsAt: purchase.access_ends_at,
        maxDevices: purchase.max_devices,
        redirectTo: "/create",
      };
    }

    const licenses = new LicenseService(this.db);
    let accessEndsAt = purchase.access_ends_at;
    let maxDevices = purchase.max_devices;

    if (purchase.unlocks_access) {
      let key = purchase.license_key;
      if (!key && isChariowConfigured()) {
        try {
          const sale = await getSale(opts.saleId);
          const resolved = await resolveLicenseKey(this.db, sale, purchase.product_id);
          key = resolved.key;
          accessEndsAt = resolved.expiresAt || accessEndsAt;
          maxDevices = resolved.maxDevices ?? maxDevices;
          if (key) {
            await purchaseRef.set(
              {
                license_key: key,
                license_id: resolved.licenseId,
                access_ends_at: accessEndsAt,
                max_devices: maxDevices,
                updated_at: nowIso(),
              },
              { merge: true }
            );
          }
        } catch (err) {
          console.warn("[access-open] resolve license on attach failed", err);
        }
      }

      if (!key) {
        throw new AppError(
          "INTERNAL_ERROR",
          "Nous préparons encore votre accès. Réessayez dans quelques instants — aucun nouveau paiement ne vous sera demandé.",
          503
        );
      }

      const live = await licenses.activateForUser(opts.userId, key);
      accessEndsAt = live.expires_at ?? accessEndsAt;
      maxDevices = live.activations?.max ?? maxDevices;
    }

    // Credits — same idempotent reference as webhook path.
    if (purchase.credits && purchase.credits > 0) {
      await new CreditService(this.db).credit(
        opts.userId,
        purchase.credits,
        `Achat ${purchase.pack_id ?? "pack"} — ${purchase.credits} crédits`,
        `chariow:${purchase.sale_id}`
      );
      // Mark pending credit doc claimed if present.
      await this.db
        .collection("chariow_pending_credits")
        .doc(purchase.sale_id)
        .set(
          {
            status: "claimed",
            user_id: opts.userId,
            claimed_at: nowIso(),
          },
          { merge: true }
        );
    }

    const started = nowIso();
    await purchaseRef.set(
      {
        status: "attached",
        access_status: purchase.unlocks_access ? "active" : purchase.access_status,
        user_id: opts.userId,
        access_started_at: purchase.access_started_at || started,
        access_ends_at: accessEndsAt,
        max_devices: maxDevices,
        updated_at: started,
        source: "attach",
      },
      { merge: true }
    );

    return {
      attached: true,
      duplicate: false,
      unlocksAccess: purchase.unlocks_access,
      credits: purchase.credits,
      accessEndsAt,
      maxDevices,
      redirectTo: "/create",
    };
  }

  /** Claim any pending purchases for this email after login. */
  async claimPendingForUser(userId: string, email: string, emailVerified: boolean) {
    if (!emailVerified) return { claimed: 0 };
    const normalized = email.trim().toLowerCase();
    const snap = await this.db
      .collection(PURCHASES_COLLECTION)
      .where("email", "==", normalized)
      .where("status", "==", "completed")
      .limit(10)
      .get();

    let claimed = 0;
    for (const doc of snap.docs) {
      try {
        await this.attachToUser({
          userId,
          userEmail: normalized,
          emailVerified: true,
          saleId: doc.id,
        });
        claimed += 1;
      } catch (err) {
        console.warn(
          "[access-open] claim pending failed",
          doc.id,
          err instanceof Error ? err.message : err
        );
      }
    }
    return { claimed };
  }
}
