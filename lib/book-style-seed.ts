/** Stable FNV-1a style seed from a book id (same book → same aesthetic family). */
export function bookStyleSeed(bookId: string): number {
  let h = 2166136261;
  for (let i = 0; i < bookId.length; i++) {
    h ^= bookId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = h >>> 0;
  return n % 2147483647 || 42;
}

/** Per-page seed in the book family (small offset keeps coherence, allows scene variety). */
export function pageStyleSeed(bookId: string, pageNumber: number): number {
  return (bookStyleSeed(bookId) + Math.max(1, pageNumber) * 97) % 2147483647;
}
