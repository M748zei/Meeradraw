import { AppError } from "@/lib/errors";
import { docData, docsData } from "@/lib/firebase/docs";
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
    const books = await this.db.collection("books").where("universe_id", "==", id).get();
    const batch = this.db.batch();
    books.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(this.db.collection("universes").doc(id));
    await batch.commit();
  }
}
