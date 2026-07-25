import { createHmac, timingSafeEqual } from "crypto";

const CHARIOW_API_BASE = process.env.CHARIOW_API_BASE || "https://api.chariow.com/v1";

export type ChariowLicense = {
  id: string;
  status: "pending_activation" | "active" | "expired" | "revoked" | string;
  is_active: boolean;
  is_expired: boolean;
  can_activate: boolean;
  license: { key: string; masked_key?: string };
  // Chariow's product id is a string like "prd_..." on GET, but the activate
  // endpoint can return a numeric id — normalize to string when comparing.
  product?: { id: string | number; name: string; slug?: string };
  customer?: { id: string; name?: string; email?: string };
  activations?: { count: number; max: number; remaining: number };
  expires_at?: string | null;
  activated_at?: string | null;
};

export type ChariowSale = {
  id: string;
  status: "awaiting_payment" | "completed" | "failed" | "abandoned" | "settled" | string;
  product?: { id: string | number; name?: string; slug?: string; type?: string };
  customer?: {
    id?: string;
    email?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
  };
  payment?: { status?: string };
  fulfillment?: {
    licences?: Array<{
      id?: string;
      licence_key?: string;
      status?: string;
      activations?: number;
      max_activations?: number;
      expires_at?: string | null;
    }>;
    files?: unknown[];
    instructions?: string;
  };
  completed_at?: string | null;
  failed_at?: string | null;
  abandoned_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

function getApiKey() {
  const key = process.env.CHARIOW_API_KEY;
  if (!key) throw new Error("CHARIOW_API_KEY manquant");
  return key;
}

export function isChariowConfigured() {
  return Boolean(process.env.CHARIOW_API_KEY?.trim());
}

async function chariowFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CHARIOW_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (json as { message?: string }).message || `Chariow error ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

export async function getLicenseByKey(licenseKey: string) {
  const encoded = encodeURIComponent(licenseKey.trim());
  const result = await chariowFetch<{ data: ChariowLicense }>(`/licenses/${encoded}`);
  return result.data;
}

export async function activateLicense(licenseKey: string, deviceIdentifier: string) {
  const encoded = encodeURIComponent(licenseKey.trim());
  const result = await chariowFetch<{ data: ChariowLicense }>(
    `/licenses/${encoded}/activate`,
    {
      method: "POST",
      body: JSON.stringify({ device_identifier: deviceIdentifier }),
    }
  );
  return result.data;
}

export async function getSale(saleId: string) {
  const encoded = encodeURIComponent(saleId.trim());
  const result = await chariowFetch<{ data: ChariowSale }>(`/sales/${encoded}`);
  return result.data;
}

export async function listLicenses(params: {
  customer_id?: string;
  product_id?: string;
  status?: string;
  per_page?: number;
}) {
  const qs = new URLSearchParams();
  if (params.customer_id) qs.set("customer_id", params.customer_id);
  if (params.product_id) qs.set("product_id", params.product_id);
  if (params.status) qs.set("status", params.status);
  if (params.per_page) qs.set("per_page", String(params.per_page));
  const path = qs.toString() ? `/licenses?${qs}` : "/licenses";
  const result = await chariowFetch<{ data: ChariowLicense[] }>(path);
  return Array.isArray(result.data) ? result.data : [];
}

export function isLicenseUsable(license: ChariowLicense) {
  return Boolean(license.is_active) && !license.is_expired && license.status !== "revoked";
}

/**
 * Official Chariow best-practice verification: HMAC-SHA256 of the payload
 * with CHARIOW_WEBHOOK_SECRET, compared to `x-chariow-signature`.
 * We prefer the raw request body; also accept hex of JSON.stringify(parsed)
 * when Chariow signs a re-serialized object.
 */
export function verifyChariowWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  if (!provided) return false;

  const candidates = [rawBody];
  try {
    candidates.push(JSON.stringify(JSON.parse(rawBody)));
  } catch {
    /* keep raw only */
  }

  for (const body of candidates) {
    const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
