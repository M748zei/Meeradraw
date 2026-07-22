import { AppError } from "@/lib/errors";

/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Scope: per server instance. On Vercel Fluid Compute instances are reused
 * across requests, so this meaningfully throttles tight abuse loops (the
 * expensive LLM/checkout routes) without adding a Redis dependency. It is a
 * best-effort brake, not a hard global quota — good enough for the current
 * scale; swap for Upstash Ratelimit if multi-instance precision matters later.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 5_000;

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
) {
  const now = Date.now();
  let hits = buckets.get(key);
  if (!hits) {
    if (buckets.size >= MAX_KEYS) buckets.clear(); // crude GC, resets windows
    hits = [];
    buckets.set(key, hits);
  }
  // Drop entries older than the window.
  while (hits.length && hits[0] <= now - windowMs) hits.shift();
  if (hits.length >= limit) {
    throw new AppError(
      "TIMEOUT",
      "Trop de requêtes — patiente quelques secondes puis réessaie.",
      429
    );
  }
  hits.push(now);
}

/** Client IP for anonymous limits (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
