/**
 * Reset a book's previous-generation artifacts before a PAID recreate.
 *
 * Prod validation run 6350c675 (book 55237586): the paid recreate of an
 * invalidated book REUSED the stale black cover ("cover already persisted —
 * skipping") and the six stale page docs (pages_setup reuse + per-page
 * completed-skip), so nothing regenerated and the final-book raster gate had
 * to fail-refund the whole run.
 *
 * Contract:
 *  - PAID recreate (cost > 0, new generation claim): the parent pays for a
 *    fresh book — every prior page doc is deleted and the cover fields are
 *    cleared so cover + pages_setup + pages regenerate from the NEW plan.
 *  - FREE retry keeps the historical resume semantics on purpose: genuinely
 *    completed pages of the failed run are reused (bad ones are marked
 *    `failed` by the final raster gate, so only they regenerate).
 *
 * Storage objects are intentionally kept (evidence / audit); only the
 * Firestore pointers are reset.
 */
import type { Firestore } from "firebase-admin/firestore";

export async function resetBookArtifactsForPaidRecreate(
  db: Firestore,
  bookId: string
): Promise<{ pagesDeleted: number; coverCleared: boolean }> {
  const bookRef = db.collection("books").doc(bookId);
  const snap = await bookRef.get();
  if (!snap.exists) return { pagesDeleted: 0, coverCleared: false };
  const data = snap.data() || {};

  const pages = await bookRef.collection("pages").get();
  if (pages.size > 0) {
    const batch = db.batch();
    pages.docs.forEach((p) => batch.delete(p.ref));
    await batch.commit();
  }

  const hadCover = Boolean(data.cover_image || data.cover_image_path);
  const patch: Record<string, unknown> = {
    pdf_url: null,
    pdf_path: null,
    updated_at: new Date().toISOString(),
  };
  if (hadCover) {
    patch.cover_image = null;
    patch.cover_image_path = null;
  }
  await bookRef.set(patch, { merge: true });

  return { pagesDeleted: pages.size, coverCleared: hadCover };
}
