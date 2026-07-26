export type CustomerBookState = {
  status?: string | null;
  source?: string | null;
};

/**
 * A customer library contains delivered work and active creations, never
 * technical failures. Parent drafts are refunded attempts, not products the
 * parent should have to diagnose.
 */
export function isCustomerVisibleBook(book: CustomerBookState): boolean {
  if (book.status === "failed" || book.status === "partial") return false;
  if (book.source === "parent_create" && book.status === "draft") return false;
  return true;
}
