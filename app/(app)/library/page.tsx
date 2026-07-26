import Image from "next/image";
import Link from "next/link";
import { StatusBadge } from "@/components/books/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { isCustomerVisibleBook } from "@/lib/book-visibility";
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
  const books = booksSnap
    ? docsData<Book>(booksSnap.docs).filter(isCustomerVisibleBook)
    : [];

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
                      alt={`Couverture de ${book.title}`}
                      width={360}
                      height={480}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <h3 className="font-display text-lg">{book.title}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                  <span>{book.page_count} pages</span>
                  <StatusBadge status={book.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
