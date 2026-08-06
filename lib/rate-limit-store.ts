import { AppError } from "@/lib/errors";

/**
 * Rate limiting — in-memory sliding window (fast; per-instance — under-enforces
 * on multi-instance Vercel ; limite documentée). Le compteur durable Firestore
 * a disparu avec firebase-admin ; si un besoin multi-instance revient, le
 * porter sur Supabase.
 */

type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

export type RateLimitOpts = {
  limit: number;
  windowMs: number;
};

/** Sync in-memory limiter (keeps existing call-site API). */
export function rateLimit(key: string, opts: RateLimitOpts): void {
  const now = Date.now();
  const windowStart = now - opts.windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
  if (bucket.timestamps.length >= opts.limit) {
    throw new AppError(
      "RATE_LIMITED",
      "Trop de requêtes. Réessaie dans une minute.",
      429
    );
  }
  bucket.timestamps.push(now);
}

/** Async limiter — même fenêtre en mémoire (API conservée pour les routes). */
export async function rateLimitAsync(key: string, opts: RateLimitOpts): Promise<void> {
  rateLimit(key, opts);
}

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
