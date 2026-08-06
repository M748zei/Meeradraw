import type { DocumentData, DocumentSnapshot, QueryDocumentSnapshot } from "firebase-admin/firestore";

/** Map a Firestore document snapshot to a typed record with `id`. */
export function docData<T extends { id: string }>(
  snap: DocumentSnapshot | QueryDocumentSnapshot
): T {
  return { id: snap.id, ...(snap.data() as DocumentData) } as T;
}

export function docsData<T extends { id: string }>(
  docs: Array<QueryDocumentSnapshot>
): T[] {
  return docs.map((d) => docData<T>(d));
}
