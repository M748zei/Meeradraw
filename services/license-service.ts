import { AppError } from "@/lib/errors";
import {
  activateLicense,
  getLicenseByKey,
  isChariowConfigured,
  isLicenseUsable,
  type ChariowLicense,
} from "@/lib/chariow/client";
import type { Firestore } from "firebase-admin/firestore";
import { createHash } from "crypto";

export type UserLicense = {
  license_key: string;
  license_id: string;
  status: string;
  product_id?: string | null;
  product_name?: string | null;
  product_slug?: string | null;
  is_active: boolean;
  expires_at?: string | null;
  activated_at?: string | null;
  last_validated_at: string;
};

export type LicenseStatusView = {
  configured: boolean;
  required: boolean;
  valid: boolean;
  license: {
    status?: string;
    product?: string | null;
    expires_at?: string | null;
    masked_key?: string | null;
    is_active?: boolean;
  } | null;
  message?: string;
};

function deviceIdForUser(userId: string) {
  return createHash("sha256").update(`aibookstudio:${userId}`).digest("hex").slice(0, 32);
}

/**
 * Unique gateway between Meeradraw and Chariow.
 * No other module should call the Chariow HTTP client directly for business logic.
 */
export class LicenseService {
  constructor(private db: Firestore) {}

  static isConfigured() {
    return isChariowConfigured();
  }

  /** Emails listed in ADMIN_EMAILS (comma-separated) bypass Chariow entirely. */
  static isAdminEmail(email?: string | null): boolean {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;
    const list = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(normalized);
  }

  async getLinkedLicense(userId: string) {
    const snap = await this.db.collection("users").doc(userId).get();
    const data = snap.data();
    return (data?.chariow_license as UserLicense | undefined) ?? null;
  }

  private async resolveEmail(userId: string, email?: string | null) {
    if (email?.trim()) return email.trim();
    const snap = await this.db.collection("users").doc(userId).get();
    const stored = snap.data()?.email;
    return typeof stored === "string" ? stored : null;
  }

  private adminStatusView(): LicenseStatusView {
    return {
      configured: LicenseService.isConfigured(),
      required: false,
      valid: true,
      license: null,
      message: "Accès administrateur — aucun code d'accès requis.",
    };
  }

  /**
   * Simple status for the rest of the app / API.
   * Always re-validates against Chariow when a key is linked and Chariow is configured.
   * Admin emails (ADMIN_EMAILS) are always treated as valid without Chariow.
   */
  async getStatus(userId: string, email?: string | null): Promise<LicenseStatusView> {
    const resolvedEmail = await this.resolveEmail(userId, email);
    if (LicenseService.isAdminEmail(resolvedEmail)) {
      return this.adminStatusView();
    }

    const linked = await this.getLinkedLicense(userId);

    if (!LicenseService.isConfigured()) {
      return {
        configured: false,
        required: false,
        valid: true,
        license: linked
          ? {
              status: linked.status,
              product: linked.product_name ?? null,
              expires_at: linked.expires_at ?? null,
              masked_key: null,
              is_active: linked.is_active,
            }
          : null,
        message: "Vérification d'accès non configurée — mode développement.",
      };
    }

    if (!linked?.license_key) {
      return {
        configured: true,
        required: true,
        valid: false,
        license: null,
        message: "Débloque ton accès Meeradraw pour ouvrir le studio.",
      };
    }

    try {
      const live = await this.requireActiveLicense(userId, resolvedEmail);
      // `live` can be null only on paths already handled above (admin / not
      // configured); guard anyway so a future change can't throw a TypeError
      // that the catch would silently turn into `valid:false`.
      if (!live) {
        return {
          configured: true,
          required: true,
          valid: true,
          license: linked
            ? {
                status: linked.status,
                product: linked.product_name ?? null,
                expires_at: linked.expires_at ?? null,
                masked_key: null,
                is_active: linked.is_active,
              }
            : null,
        };
      }
      return {
        configured: true,
        required: true,
        valid: true,
        license: {
          status: live.status,
          product: live.product?.name ?? linked.product_name,
          expires_at: live.expires_at ?? linked.expires_at,
          masked_key: live.license.masked_key ?? null,
          is_active: true,
        },
      };
    } catch {
      const refreshed = await this.getLinkedLicense(userId);
      return {
        configured: true,
        required: true,
        valid: false,
        license: refreshed
          ? {
              status: refreshed.status,
              product: refreshed.product_name ?? null,
              expires_at: refreshed.expires_at ?? null,
              masked_key: null,
              is_active: refreshed.is_active,
            }
          : null,
        message: "Ton accès n'est plus actif. Entre un code d'accès valide pour le réactiver.",
      };
    }
  }

  /**
   * Boolean view of `requireActiveLicense` for flows that have a fallback
   * (e.g. free trials) instead of a hard 403.
   */
  async hasActiveAccess(userId: string, email?: string | null): Promise<boolean> {
    try {
      await this.requireActiveLicense(userId, email);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gate for paid actions (generation, etc.).
   * Chariow is the source of truth — local cache is updated after each check.
   * Admin emails skip Chariow entirely.
   */
  async requireActiveLicense(userId: string, email?: string | null) {
    const resolvedEmail = await this.resolveEmail(userId, email);
    if (LicenseService.isAdminEmail(resolvedEmail)) {
      return null;
    }

    if (!LicenseService.isConfigured()) {
      if (process.env.NODE_ENV !== "production") return null;
      throw new AppError(
        "FORBIDDEN",
        "Un accès Meeradraw est requis pour utiliser le studio.",
        403
      );
    }

    const linked = await this.getLinkedLicense(userId);
    if (!linked?.license_key) {
      throw new AppError(
        "FORBIDDEN",
        "Débloque ton accès Meeradraw pour continuer.",
        403
      );
    }

    let license: ChariowLicense;
    try {
      license = await getLicenseByKey(linked.license_key);
    } catch {
      await this.markLinkedInactive(userId, "invalid");
      throw new AppError("FORBIDDEN", "Code d'accès introuvable ou invalide.", 403);
    }

    this.assertProductMatch(license);

    if (!isLicenseUsable(license)) {
      await this.persistLicense(userId, license);
      throw new AppError("FORBIDDEN", "Ton accès Meeradraw n'est plus actif.", 403);
    }

    await this.persistLicense(userId, license);
    return license;
  }

  async activateForUser(userId: string, licenseKey: string) {
    if (!LicenseService.isConfigured()) {
      throw new AppError(
        "INTERNAL_ERROR",
        "La vérification d'accès n'est pas encore configurée (CHARIOW_API_KEY).",
        500
      );
    }

    const key = licenseKey.trim();
    if (!key) {
      throw new AppError("VALIDATION_ERROR", "Code d'accès requis", 400);
    }

    let license = await getLicenseByKey(key);
    this.assertProductMatch(license);

    if (license.status === "pending_activation" || license.can_activate) {
      try {
        license = await activateLicense(key, deviceIdForUser(userId));
      } catch (err) {
        license = await getLicenseByKey(key);
        if (!isLicenseUsable(license)) {
          throw new AppError(
            "FORBIDDEN",
            err instanceof Error ? err.message : "Activation impossible",
            403
          );
        }
      }
    }

    this.assertProductMatch(license);

    if (!isLicenseUsable(license)) {
      throw new AppError(
        "FORBIDDEN",
        "Ce code d'accès n'est plus actif ou a expiré.",
        403
      );
    }

    await this.persistLicense(userId, license);
    return license;
  }

  /**
   * Primary sync path when Chariow sends Pulse webhooks.
   * Verifies nothing about the sale flow — only applies license state locally.
   *
   * Real Chariow payload shape (per docs): the license object is at the TOP
   * level (`payload.license`), NOT `payload.data.license`. Real event values:
   * `license.issued`, `license.activated`, `license.expired`, `license.revoked`,
   * `successful.sale`, `abandoned.sale`, `failed.sale`, `affiliate.joined`.
   *
   * Idempotent: the same event (retried up to 5× by Chariow) is recorded once
   * via a deterministic doc id, and license state is derived idempotently.
   */
  async handleWebhookEvent(payload: Record<string, unknown>) {
    const event = String(payload?.event || payload?.type || "unknown");

    // License object is top-level in real Chariow payloads; keep the legacy
    // `payload.data.license` path as a fallback for older/test shapes.
    const data = (payload?.data as Record<string, unknown> | undefined) ?? {};
    const topLicense = (payload?.license as Record<string, unknown> | undefined) ?? {};
    const nestedLicense = (data.license as Record<string, unknown> | undefined) ?? {};
    const licenseKey =
      (typeof topLicense.key === "string" && topLicense.key) ||
      (typeof nestedLicense.key === "string" && nestedLicense.key) ||
      (typeof data.license_key === "string" && data.license_key) ||
      null;
    const licenseId =
      (typeof topLicense.id === "string" && topLicense.id) ||
      (typeof nestedLicense.id === "string" && nestedLicense.id) ||
      null;
    const sale = (payload?.sale as Record<string, unknown> | undefined) ?? {};
    const saleId = typeof sale.id === "string" ? sale.id : null;

    // Deterministic id → recording the same delivered event twice is a no-op.
    // Sale events are keyed by sale_id so two sales without a license object
    // can never collide on the same doc.
    const eventDocId = `${event}:${saleId ?? licenseId ?? licenseKey ?? "none"}`
      .replace(/[^a-zA-Z0-9:_-]/g, "_")
      .slice(0, 480);
    const eventRef = this.db.collection("chariow_events").doc(eventDocId);
    const alreadySeen = (await eventRef.get()).exists;
    await eventRef.set(
      {
        event,
        license_key: licenseKey,
        license_id: licenseId,
        payload,
        received_at: new Date().toISOString(),
      },
      { merge: true }
    );

    if (!licenseKey) return { received: true, updated: 0, duplicate: alreadySeen };
    if (alreadySeen) return { received: true, updated: 0, duplicate: true };

    const lower = event.toLowerCase();
    const shouldDeactivate =
      lower.includes("revok") ||
      lower.includes("expir") ||
      lower.includes("refund") ||
      lower.includes("cancel") ||
      lower.includes("failed.sale");

    if (!shouldDeactivate) {
      // Soft refresh: fetch the live license and sync linked users.
      // (license.issued / license.activated / successful.sale → refresh access)
      try {
        const live = await getLicenseByKey(licenseKey);
        return {
          received: true,
          updated: await this.syncKeyToUsers(licenseKey, live),
          duplicate: false,
        };
      } catch {
        return { received: true, updated: 0, duplicate: false };
      }
    }

    const status = lower.includes("revok")
      ? "revoked"
      : lower.includes("expir")
        ? "expired"
        : lower.includes("refund")
          ? "refunded"
          : "inactive";

    return {
      received: true,
      updated: await this.markInactiveByKey(licenseKey, status),
      duplicate: false,
    };
  }

  /**
   * Enforce that the license belongs to the Meeradraw product.
   *
   * The live Chariow API exposes `product.id` (e.g. `prd_fl4at9rv`) — there is
   * NO `product.slug`, so we match on id only. Fails CLOSED: if a product id is
   * expected but the license carries no product id, the license is rejected.
   * This prevents a customer of a *different* product on the same store from
   * unlocking Meeradraw with a valid-but-wrong license.
   */
  private assertProductMatch(license: ChariowLicense) {
    const expectedId = process.env.CHARIOW_PRODUCT_ID?.trim();
    if (!expectedId) return; // product scoping not enabled

    const productId =
      license.product?.id != null ? String(license.product.id) : null;
    if (!productId || productId !== expectedId) {
      throw new AppError(
        "FORBIDDEN",
        "Ce code d'accès ne correspond pas à Meeradraw.",
        403
      );
    }
  }

  private async persistLicense(userId: string, license: ChariowLicense) {
    const payload: UserLicense = {
      license_key: license.license.key,
      license_id: license.id,
      status: license.status,
      product_id: license.product?.id != null ? String(license.product.id) : null,
      product_name: license.product?.name ?? null,
      product_slug: license.product?.slug ?? null,
      is_active: isLicenseUsable(license),
      expires_at: license.expires_at ?? null,
      activated_at: license.activated_at ?? null,
      last_validated_at: new Date().toISOString(),
    };

    await this.db.collection("users").doc(userId).set(
      {
        chariow_license: payload,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    await this.db.collection("licenses").doc(license.id).set(
      {
        ...payload,
        user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  private async markLinkedInactive(userId: string, status: string) {
    const linked = await this.getLinkedLicense(userId);
    if (!linked) return;
    await this.db.collection("users").doc(userId).set(
      {
        chariow_license: {
          ...linked,
          is_active: false,
          status,
          last_validated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  private async markInactiveByKey(licenseKey: string, status: string) {
    const users = await this.db
      .collection("users")
      .where("chariow_license.license_key", "==", licenseKey)
      .get();

    let updated = 0;
    for (const doc of users.docs) {
      const current = doc.data().chariow_license || {};
      await doc.ref.set(
        {
          chariow_license: {
            ...current,
            is_active: false,
            status,
            last_validated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
      updated += 1;
    }
    return updated;
  }

  private async syncKeyToUsers(licenseKey: string, license: ChariowLicense) {
    const users = await this.db
      .collection("users")
      .where("chariow_license.license_key", "==", licenseKey)
      .get();

    let updated = 0;
    for (const doc of users.docs) {
      await this.persistLicense(doc.id, license);
      updated += 1;
    }
    return updated;
  }
}
