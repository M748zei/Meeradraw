import { fetchWithTimeout } from "@/lib/async";

/** Hosts allowed for server-side image fetches (SSRF guard). */
export function isAllowedImageHost(hostname: string): boolean {
  return (
    hostname === "fal.media" ||
    hostname.endsWith(".fal.media") ||
    hostname === "storage.googleapis.com" ||
    hostname === "firebasestorage.googleapis.com" ||
    hostname === "placehold.co"
  );
}

/**
 * Parse and validate an image URL before the server fetches it.
 * Requires https (or http for placehold.co in local mocks) and an allowlisted host.
 */
export function assertSafeImageUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid image URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`unsupported scheme: ${parsed.protocol}`);
  }
  // Disallow credentials in URL (userinfo SSRF / log injection).
  if (parsed.username || parsed.password) {
    throw new Error("credentials in URL not allowed");
  }
  if (!isAllowedImageHost(parsed.hostname)) {
    throw new Error(`host not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB

/** Fetch an allowlisted image with timeout and size cap. */
export async function fetchSafeImageBytes(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<Uint8Array> {
  const parsed = assertSafeImageUrl(url);
  const res = await fetchWithTimeout(parsed.toString(), {
    timeoutMs: opts?.timeoutMs ?? 25_000,
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const maxBytes = opts?.maxBytes ?? MAX_IMAGE_BYTES;
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error(`image too large (${len} bytes)`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error(`image too large (${buf.byteLength} bytes)`);
  return buf;
}
