import type { Profile } from "@/types/database";

/**
 * Strip server-only fields (full Chariow license key, etc.) before returning
 * a user document to the client.
 */
export function toPublicProfile(
  data: Record<string, unknown> | Profile | null | undefined,
  id: string
) {
  if (!data) {
    return { id, email: "", credits: 0 };
  }
  const raw = { ...(data as Record<string, unknown>) };
  const license = raw.chariow_license as Record<string, unknown> | undefined;
  delete raw.chariow_license;

  let chariow_license: Record<string, unknown> | null = null;
  if (license && typeof license === "object") {
    const key = typeof license.license_key === "string" ? license.license_key : "";
    const masked =
      key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key ? "••••" : null;
    chariow_license = {
      license_id: license.license_id ?? null,
      status: license.status ?? null,
      product_id: license.product_id ?? null,
      product_name: license.product_name ?? null,
      is_active: Boolean(license.is_active),
      expires_at: license.expires_at ?? null,
      activated_at: license.activated_at ?? null,
      last_validated_at: license.last_validated_at ?? null,
      masked_key: masked,
    };
  }

  return {
    ...raw,
    id,
    chariow_license,
  };
}
