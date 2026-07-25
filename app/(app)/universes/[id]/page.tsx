import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StatusBadge } from "@/components/books/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { docData, docsData } from "@/lib/firebase/docs";
import { getSessionUser } from "@/lib/firebase/session";
import type { Book, Universe } from "@/types/database";

type Props = { params: Promise<{ id: string }> };

export default async function UniversePage({ params }: Props) {
  const { id } = await params;

  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || !isFirebaseAdminConfigured()) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl">Univers démo</h1>
        <p className="text-ink-muted">Configurez Firebase pour sauvegarder vos univers.</p>
        <Link href={`/universes/${id}/books/new`}>
          <Button>Créer un livre de coloriage</Button>
        </Link>
      </div>
    );
  }

  const session = await getSessionUser();
  if (!session) redirect("/login");

  const db = getAdminDb();
  const universeSnap = await db.collection("universes").doc(id).get();
  if (!universeSnap.exists || universeSnap.data()?.user_id !== session.uid) notFound();
  const universe = docData<Universe>(universeSnap);

  const booksSnap = await db.collection("books").where("universe_id", "==", id).get();
  // Filter by owner in memory (avoids a composite index; volume per universe is small).
  const books = docsData<Book>(booksSnap.docs).filter((b) => b.user_id === session.uid);

  const ideaSeed = (universe.description?.trim() || universe.title).slice(0, 4000);
  const newBookHref = ideaSeed
    ? `/universes/${id}/books/new?idea=${encodeURIComponent(ideaSeed)}`
    : `/universes/${id}/books/new`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-sky-600">Univers</p>
          <h1 className="font-display text-3xl md:text-4xl">{universe.title}</h1>
          <p className="mt-2 max-w-2xl text-ink-muted">
            {universe.description || "Votre univers créatif"}
          </p>
        </div>
        <Link href={newBookHref}>
          <Button size="lg">
            {books.length ? "Créer un nouveau livre" : "Créer mon livre de coloriage"}
          </Button>
        </Link>
      </div>

      {!books.length ? (
        <EmptyState
          title="Votre univers est prêt — il manque le livre"
          description="Un univers n'est pas encore un livre. Cliquez ci-dessous pour transformer votre idée en livre de coloriage généré par l'IA."
          actionLabel="Créer mon livre de coloriage"
          actionHref={newBookHref}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <Link key={book.id} href={`/books/${book.id}`}>
              <Card className="h-full transition hover:-translate-y-1 hover:shadow-lift">
                <div className="mb-4 aspect-[3/4] overflow-hidden rounded-2xl bg-gradient-to-br from-yellow-100 to-sky-100">
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
