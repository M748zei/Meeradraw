import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { docsData } from "@/lib/firebase/docs";
import { getSessionUser } from "@/lib/firebase/session";
import type { Book } from "@/types/database";

export default async function LibraryPage() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || !isFirebaseAdminConfigured()) {
    return (
      <EmptyState
        title="Bibliothèque vide"
        description="Configurez Firebase pour retrouver tous vos livres."
        actionLabel="Créer un univers"
        actionHref="/universes/new"
      />
    );
  }

  const session = await getSessionUser();
  const booksSnap = session
    ? await getAdminDb().collection("books").where("user_id", "==", session.uid).get()
    : null;
  const books = booksSnap ? docsData<Book>(booksSnap.docs) : [];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Bibliothèque</h1>
      {!books.length ? (
        <EmptyState
          title="Votre bibliothèque attend son premier livre"
          description="Créez un univers, racontez une idée, et le livre apparaît."
          actionLabel="Créer"
          actionHref="/universes/new"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <Link key={book.id} href={`/books/${book.id}`}>
              <Card className="h-full transition hover:-translate-y-1 hover:shadow-lift">
                <div className="mb-4 aspect-[3/4] overflow-hidden rounded-2xl bg-gradient-to-br from-mint-100 to-yellow-100">
                  {book.cover_image ? (
                    <Image
                      src={book.cover_image}
                      alt=""
                      width={360}
                      height={480}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <h3 className="font-display text-lg">{book.title}</h3>
                <p className="text-sm text-ink-muted">
                  {book.page_count} pages · {book.type}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
