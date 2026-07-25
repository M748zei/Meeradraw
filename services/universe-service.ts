import { AppError } from "@/lib/errors";
import { docData, docsData } from "@/lib/firebase/docs";
import { deleteDocumentsInBatches } from "@/services/firestore-delete";
import type { Universe } from "@/types/database";
import type { Firestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

export class UniverseService {
  constructor(private db: Firestore) {}

  async list(userId: string): Promise<Universe[]> {
    const snap = await this.db
      .collection("universes")
      .where("user_id", "==", userId)
      .get();
    return docsData<Universe>(snap.docs).sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at))
    );
  }

  async get(userId: string, id: string): Promise<Universe> {
    const snap = await this.db.collection("universes").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== userId) {
      throw new AppError("NOT_FOUND", "Univers introuvable", 404);
    }
    return docData<Universe>(snap);
  }

  async create(
    userId: string,
    input: {
      title: string;
      description?: string;
      language?: string;
      audience_age?: string;
    }
  ): Promise<Universe> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const data = {
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      language: input.language ?? "fr",
      audience_age: input.audience_age ?? null,
      cover_image: null,
      visibility: "private" as const,
      created_at: now,
      updated_at: now,
    };
    await this.db.collection("universes").doc(id).set(data);
    return { id, ...data };
  }

  async update(userId: string, id: string, input: Record<string, unknown>): Promise<Universe> {
    await this.get(userId, id);
    const patch = { ...input, updated_at: new Date().toISOString() };
    await this.db.collection("universes").doc(id).update(patch);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    const universeRef = this.db.collection("universes").doc(id);
    const books = await this.db.collection("books").where("universe_id", "==", id).get();
    const ownedBooks = books.docs.filter((d) => d.data()?.user_id === userId);
    const active = ownedBooks.find((d) => d.data()?.status === "generating");
    if (active) {
      throw new AppError(
        "CONFLICT",
        "Un livre de cet univers est en cours de génération. Attendez la fin avant de supprimer l’univers.",
        409
      );
    }

    const bookIds = ownedBooks.map((d) => d.id);
    const [characters, pageSnaps, generationSnaps, retrySnaps] = await Promise.all([
      universeRef.collection("characters").get(),
      Promise.all(ownedBooks.map((d) => d.ref.collection("pages").get())),
      Promise.all(
        bookIds.map((bookId) =>
          this.db.collection("generations").where("book_id", "==", bookId).get()
        )
      ),
      Promise.all(
        bookIds.map((bookId) =>
          this.db.collection("generation_retries").where("book_id", "==", bookId).get()
        )
      ),
    ]);

    const refs = [
      ...characters.docs.map((d) => d.ref),
      ...pageSnaps.flatMap((snap) => snap.docs.map((d) => d.ref)),
      ...generationSnaps.flatMap((snap) =>
        snap.docs.filter((d) => d.data()?.user_id === userId).map((d) => d.ref)
      ),
      ...retrySnaps.flatMap((snap) =>
        snap.docs.filter((d) => d.data()?.user_id === userId).map((d) => d.ref)
      ),
      ...ownedBooks.map((d) => d.ref),
      universeRef,
    ];
    await deleteDocumentsInBatches(this.db, refs);
  }
}
