const CHARIOW_API_BASE = process.env.CHARIOW_API_BASE || "https://api.chariow.com/v1";

export type ChariowLicense = {
  id: string;
  status: "pending_activation" | "active" | "expired" | "revoked" | string;
  is_active: boolean;
  is_expired: boolean;
  can_activate: boolean;
  license: { key: string; masked_key?: string };
  product?: { id: string; name: string; slug?: string };
  customer?: { id: string; name?: string; email?: string };
  activations?: { count: number; max: number; remaining: number };
  expires_at?: string | null;
  activated_at?: string | null;
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

export function isLicenseUsable(license: ChariowLicense) {
  return Boolean(license.is_active) && !license.is_expired && license.status !== "revoked";
}
