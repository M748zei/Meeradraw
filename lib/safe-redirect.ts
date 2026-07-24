/**
 * Sanitize a post-login `next` path. Only same-origin relative paths are
 * allowed — blocks open redirects and `javascript:` URLs.
 */
export function safeInternalPath(
  candidate: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!candidate) return fallback;
  const next = candidate.trim();
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.includes("\\")) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(next)) return fallback;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next)) return fallback;
  return next;
}
