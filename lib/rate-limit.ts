/**
 * Re-export — implementation lives in `rate-limit-store.ts`
 * (Firestore-backed durable counters for critical routes + in-memory fallback).
 *
 * Limitation: the in-memory path is still per-instance; critical routes should
 * call `rateLimitAsync(..., { durable: true })`.
 */
export {
  rateLimit,
  rateLimitAsync,
  clientIp,
  type RateLimitOpts,
} from "@/lib/rate-limit-store";
