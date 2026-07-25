import { AppError } from "@/lib/errors";

/**
 * Rate limiting.
 *
 * Default: in-memory sliding window (fast; per-instance — under-enforces on
 * multi-instance Vercel). Documented limitation.
 *
 * Critical routes: `rateLimitAsync(..., { durable: true })` uses a Firestore
 * atomic counter so child-photo / generation-start share limits across
 * instances. Fail-open on Firestore errors.
 *
 * Firestore Admin is loaded lazily so pure logic tests never pull firebase-admin.
 */

type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

export type RateLimitOpts = {
  limit: number;
  windowMs: number;
  /** Firestore-backed counter for multi-instance critical routes. */
  durable?: boolean;
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

/**
 * Async limiter: in-memory first, then optional Firestore durable counter.
 */
export async function rateLimitAsync(
  key: string,
  opts: RateLimitOpts
): Promise<void> {
  rateLimit(key, opts);
  if (!opts.durable) return;
  const over = await durableBump(key, opts);
  if (over) {
    throw new AppError(
      "RATE_LIMITED",
      "Trop de requêtes. Réessaie dans une minute.",
      429
    );
  }
}

async function durableBump(
  key: string,
  opts: RateLimitOpts
): Promise<boolean> {
  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const ref = db.collection("rate_limits").doc(encodeKey(key));
    const now = Date.now();
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() || {};
      const currentWindow = Math.floor(now / opts.windowMs);
      const windowId =
        typeof data.window_id === "number" ? data.window_id : currentWindow;
      let count = typeof data.count === "number" ? data.count : 0;
      if (windowId !== currentWindow) count = 0;
      if (count >= opts.limit) return true;
      tx.set(
        ref,
        {
          key,
          count: count + 1,
          window_id: currentWindow,
          window_ms: opts.windowMs,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
      return false;
    });
  } catch (err) {
    console.warn("[rate-limit] durable bump failed (fail-open)", err);
    return false;
  }
}

function encodeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 700);
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
