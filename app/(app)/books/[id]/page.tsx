import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PdfDownloadButton } from "@/components/books/pdf-download-button";
import { RegeneratePageButton } from "@/components/books/regenerate-page-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { docData, docsData } from "@/lib/firebase/docs";
import { getSessionUser } from "@/lib/firebase/session";
import type { Book, Page } from "@/types/database";

type Props = { params: Promise<{ id: string }> };

export default async function BookPage({ params }: Props) {
  const { id } = await params;

  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || !isFirebaseAdminConfigured()) {
    return (
      <div>
        <h1 className="font-display text-3xl">Livre démo</h1>
        <p className="mt-2 text-ink-muted">Connectez Firebase pour prévisualiser vos livres.</p>
      </div>
    );
  }

  const session = await getSessionUser();
  if (!session) redirect("/login");

  const db = getAdminDb();
  const bookSnap = await db.collection("books").doc(id).get();
  if (!bookSnap.exists || bookSnap.data()?.user_id !== session.uid) notFound();
  const book = docData<Book>(bookSnap);

  const pagesSnap = await db
    .collection("books")
    .doc(id)
    .collection("pages")
    .orderBy("page_number", "asc")
    .get();
  const pages = docsData<Page>(pagesSnap.docs);

  const missingPages = pages.filter(
    (p) => !p.illustration_url || p.generation_status === "failed"
  );
  const canExportPdf =
    (book.status === "completed" || book.status === "partial" || Boolean(book.pdf_url)) &&
    missingPages.length < pages.length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="mx-auto w-48 shrink-0 md:mx-0">
          <div className="aspect-[3/4] overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 to-lavender-100 shadow-lift">
            {book.cover_image ? (
              <Image
                src={book.cover_image}
                alt=""
                width={384}
                height={512}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold uppercase tracking-wider text-sky-600">Livre de coloriage</p>
          <h1 className="font-display text-3xl md:text-4xl">{book.title}</h1>
          {book.subtitle ? <p className="mt-2 text-lg text-ink-muted">{book.subtitle}</p> : null}
          <p className="mt-4 text-sm text-ink-muted">
            {book.page_count} pages · {book.status}
          </p>
          {missingPages.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-ink">
              {missingPages.length} page(s) sans illustration. Utilisez « Régénérer cette page »
              sous chaque page manquante.
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            {canExportPdf ? (
              <PdfDownloadButton bookId={id} pdfUrl={book.pdf_url} />
            ) : book.status === "generating" ? (
              <Link href={`/books/${id}/generate`}>
                <Button size="lg">Voir la création</Button>
              </Link>
            ) : (
              <Link href={`/universes/${book.universe_id}/books/new`}>
                <Button variant="secondary">Créer un autre livre</Button>
              </Link>
            )}
            <Link href={`/universes/${book.universe_id}`}>
              <Button variant="ghost">Retour à l&apos;univers</Button>
            </Link>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="font-display text-2xl">Aperçu des pages</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {pages.map((page) => (
              <Card key={page.id} className="overflow-hidden p-0">
                <div className="relative aspect-square bg-cream-100">
                  {page.illustration_url ? (
                    <Image
                      src={page.illustration_url}
                      alt=""
                      width={512}
                      height={512}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-cream-100 to-sky-50 px-6 text-center">
                      <p className="text-sm font-medium text-ink-muted">
                        Illustration manquante
                      </p>
                      <RegeneratePageButton bookId={id} pageId={page.id} />
                    </div>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <p className="text-xs text-ink-muted">Page {page.page_number}</p>
                    <h3 className="font-semibold">{page.title}</h3>
                    <p className="mt-1 text-sm text-ink-muted">{page.story_text}</p>
                  </div>
                  {page.illustration_url ? (
                    <RegeneratePageButton bookId={id} pageId={page.id} />
                  ) : null}
                </div>
              </Card>
            ))}
        </div>
      </section>
    </div>
  );
}
