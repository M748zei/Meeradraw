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

function isAllowedHttpMock(parsed: URL): boolean {
  return (
    parsed.protocol === "http:" &&
    parsed.hostname === "placehold.co" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * The Firebase Storage EMULATOR serves plain-HTTP media URLs on localhost.
 * Allowed ONLY when the emulator env var is present (never set in prod).
 */
function isStorageEmulatorUrl(parsed: URL): boolean {
  const host =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    process.env.STORAGE_EMULATOR_HOST;
  if (!host) return false;
  const normalized = host.replace(/^https?:\/\//, "");
  return parsed.protocol === "http:" && parsed.host === normalized;
}

/**
 * Parse and validate an image URL before the server fetches it.
 * Requires HTTPS, except plain HTTP placehold.co in non-production mocks.
 */
export function assertSafeImageUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid image URL");
  }
  if (
    parsed.protocol !== "https:" &&
    !isAllowedHttpMock(parsed) &&
    !isStorageEmulatorUrl(parsed)
  ) {
    throw new Error(`unsupported scheme: ${parsed.protocol}`);
  }
  // Disallow credentials in URL (userinfo SSRF / log injection).
  if (parsed.username || parsed.password) {
    throw new Error("credentials in URL not allowed");
  }
  if (!isAllowedImageHost(parsed.hostname) && !isStorageEmulatorUrl(parsed)) {
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
  let parsed = assertSafeImageUrl(url);
  let res: Response | null = null;
  for (let redirects = 0; redirects <= 3; redirects++) {
    res = await fetchWithTimeout(parsed.toString(), {
      timeoutMs: opts?.timeoutMs ?? 25_000,
      redirect: "manual",
      // Storage-emulator convention: "Bearer owner" = admin bypass of the
      // owner-only rules. Only ever sent to the local emulator host.
      ...(isStorageEmulatorUrl(parsed)
        ? { headers: { Authorization: "Bearer owner" } }
        : {}),
    });
    if (res.status < 300 || res.status > 399) break;
    const location = res.headers.get("location");
    if (!location) throw new Error(`redirect without location (${res.status})`);
    parsed = assertSafeImageUrl(new URL(location, parsed).toString());
  }
  if (!res || (res.status >= 300 && res.status <= 399)) {
    throw new Error("too many redirects");
  }
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const maxBytes = opts?.maxBytes ?? MAX_IMAGE_BYTES;
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error(`image too large (${len} bytes)`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error(`image too large (${buf.byteLength} bytes)`);
  return buf;
}
