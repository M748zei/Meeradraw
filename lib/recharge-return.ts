const BOOK_RETURN_PATH = /^\/books\/[A-Za-z0-9_-]+$/;

/**
 * Keep post-payment navigation on known in-app destinations. The value crosses
 * Chariow as a query parameter, so it must never be usable as an open redirect.
 */
export function safeRechargeReturnPath(value: string | null | undefined) {
  if (!value) return null;
  if (value === "/create" || value === "/credits" || value === "/dashboard") {
    return value;
  }
  return BOOK_RETURN_PATH.test(value) ? value : null;
}
