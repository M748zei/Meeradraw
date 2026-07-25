import type { DocumentReference, Firestore } from "firebase-admin/firestore";

export async function deleteDocumentsInBatches(
  db: Firestore,
  refs: DocumentReference[],
  batchSize = 450
): Promise<void> {
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + batchSize)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}
