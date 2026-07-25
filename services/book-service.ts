import { AppError } from "@/lib/errors";
import { docData, docsData } from "@/lib/firebase/docs";
import { deleteDocumentsInBatches } from "@/services/firestore-delete";
import { StorageService } from "@/services/storage-service";
import type { Book, Page } from "@/types/database";
import type { Firestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

export type BookWithPages = Book & { pages: Page[] };

export class BookService {
  private storage = new StorageService();

  constructor(private db: Firestore) {}

  async list(userId: string, universeId?: string): Promise<Book[]> {
    let query = this.db.collection("books").where("user_id", "==", userId);
    if (universeId) {
      query = this.db
        .collection("books")
        .where("user_id", "==", userId)
        .where("universe_id", "==", universeId);
    }
    const snap = await query.get();
    const books = docsData<Book>(snap.docs).sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at))
    );
    return Promise.all(books.map((b) => this.withFreshUrls(b)));
  }

  async get(userId: string, id: string): Promise<Book> {
    const snap = await this.db.collection("books").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== userId) {
      throw new AppError("NOT_FOUND", "Livre introuvable", 404);
    }
    return this.withFreshUrls(docData<Book>(snap));
  }

  async getWithPages(userId: string, id: string): Promise<BookWithPages> {
    const book = await this.get(userId, id);
    const pagesSnap = await this.db
      .collection("books")
      .doc(id)
      .collection("pages")
      .orderBy("page_number", "asc")
      .get();
    const pages = await Promise.all(
      docsData<Page>(pagesSnap.docs).map(async (p) => {
        if (p.illustration_path) {
          const url = await this.storage.signPath(p.illustration_path, "bookAsset");
          if (url) return { ...p, illustration_url: url };
        }
        return p;
      })
    );
    return { ...book, pages };
  }

  /** Re-sign short-TTL Storage URLs from persisted paths. */
  private async withFreshUrls(book: Book): Promise<Book> {
    const next = { ...book };
    if (book.cover_image_path) {
      const url = await this.storage.signPath(book.cover_image_path, "bookAsset");
      if (url) next.cover_image = url;
    }
    if (book.child_photo_path) {
      const url = await this.storage.signPath(book.child_photo_path, "sensitive");
      if (url) next.child_photo_url = url;
    }
    return next;
  }

  async create(
    userId: string,
    input: {
      universe_id: string;
      type?: string;
      idea: string;
      original_idea?: string;
      enrichment?: {
        title?: string;
        synopsis?: string;
        castHints?: string[];
        beats?: string[];
      };
      page_count?: number;
      style?: string;
      title?: string;
      audience?: string;
      audience_age?: string;
      child_name?: string;
      child_gender?: string;
      parent_story?: string;
      child_photo_url?: string;
      child_photo_path?: string;
      source?: string;
    }
  ): Promise<Book> {
    // Cross-tenant guard: never attach a book to someone else's universe.
    const universeSnap = await this.db.collection("universes").doc(input.universe_id).get();
    if (!universeSnap.exists || universeSnap.data()?.user_id !== userId) {
      throw new AppError("NOT_FOUND", "Univers introuvable", 404);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const data = {
      user_id: userId,
      universe_id: input.universe_id,
      type: (input.type ?? "colorbook") as Book["type"],
      idea: input.idea,
      original_idea: input.original_idea ?? input.idea,
      enrichment: input.enrichment ?? null,
      page_count: input.page_count ?? 12,
      style: input.style ?? "cute",
      title: input.title ?? input.enrichment?.title ?? "Nouveau livre",
      subtitle: null,
      status: "draft" as const,
      cover_image: null,
      cover_image_path: null,
      active_generation_id: null,
      pdf_url: null,
      audience: input.audience ?? null,
      audience_age: input.audience_age ?? null,
      child_name: input.child_name?.trim() || null,
      child_gender: input.child_gender?.trim() || null,
      parent_story: input.parent_story?.trim() || null,
      child_photo_url: input.child_photo_url?.trim() || null,
      child_photo_path: input.child_photo_path?.trim() || null,
      source: input.source?.trim() || null,
      created_at: now,
      updated_at: now,
    };
    await this.db.collection("books").doc(id).set(data);
    return { id, ...data };
  }

  async update(userId: string, id: string, input: Record<string, unknown>): Promise<Book> {
    await this.get(userId, id);
    // Never let callers reassign ownership or universe via update.
    const safe = { ...input };
    delete safe.user_id;
    delete safe.universe_id;
    delete safe.id;
    await this.db
      .collection("books")
      .doc(id)
      .update({ ...safe, updated_at: new Date().toISOString() });
    return this.get(userId, id);
  }

  async remove(userId: string, id: string) {
    const book = await this.get(userId, id);
    if (book.status === "generating") {
      throw new AppError(
        "CONFLICT",
        "Ce livre est en cours de génération. Attendez la fin avant de le supprimer.",
        409
      );
    }

    const bookRef = this.db.collection("books").doc(id);
    const [pages, generations, retries] = await Promise.all([
      bookRef.collection("pages").get(),
      this.db.collection("generations").where("book_id", "==", id).get(),
      this.db.collection("generation_retries").where("book_id", "==", id).get(),
    ]);
    const refs = [
      ...pages.docs.map((d) => d.ref),
      ...generations.docs.filter((d) => d.data()?.user_id === userId).map((d) => d.ref),
      ...retries.docs.filter((d) => d.data()?.user_id === userId).map((d) => d.ref),
      bookRef,
    ];
    await deleteDocumentsInBatches(this.db, refs);
  }
}
