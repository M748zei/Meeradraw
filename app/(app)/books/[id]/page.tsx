import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PdfDownloadButton } from "@/components/books/pdf-download-button";
import { RegeneratePageButton } from "@/components/books/regenerate-page-button";
import { StatusBadge } from "@/components/books/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { docsData } from "@/lib/firebase/docs";
import { getSessionUser } from "@/lib/firebase/session";
import { BookService } from "@/services/book-service";

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
  let book;
  let pages;
  try {
    // Re-signs short-TTL Storage URLs from persisted paths.
    const full = await new BookService(db).getWithPages(session.uid, id);
    book = full;
    pages = full.pages;
  } catch {
    notFound();
  }

  // A refunded parent attempt is not a deliverable. Keep technical recovery
  // states out of the parent experience even when an old direct link is used.
  if (
    book.source === "parent_create" &&
    (book.status === "draft" ||
      book.status === "failed" ||
      book.status === "partial")
  ) {
    redirect("/create");
  }

  const missingPages = pages.filter(
    (p) => !p.illustration_url || p.generation_status === "failed"
  );
  const expectedPageCount =
    typeof book.page_count === "number" && book.page_count > 0
      ? Math.floor(book.page_count)
      : pages.length;
  const missingDocumentCount = Math.max(0, expectedPageCount - pages.length);
  const totalMissingCount = missingPages.length + missingDocumentCount;
  const hasActivePageRetry = pages.some((p) => p.generation_status === "generating");
  const canExportPdf =
    !hasActivePageRetry &&
    missingDocumentCount === 0 &&
    (book.status === "completed" || book.status === "partial" || Boolean(book.pdf_url)) &&
    missingPages.length < pages.length;

  let generateHref = `/books/${id}/generate`;
  if (book.status === "generating") {
    let gid =
      typeof book.active_generation_id === "string" ? book.active_generation_id : null;
    if (!gid) {
      const genSnap = await db
        .collection("generations")
        .where("book_id", "==", id)
        .where("user_id", "==", session.uid)
        .limit(25)
        .get();
      const latest = docsData<{ id: string; created_at?: string; status?: string }>(
        genSnap.docs
      )
        .filter((g) => g.status === "queued" || g.status === "running")
        .sort((a, b) =>
          String(b.created_at || "").localeCompare(String(a.created_at || ""))
        )[0];
      gid = latest?.id ?? null;
    }
    if (gid) generateHref = `/books/${id}/generate?gid=${gid}`;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="mx-auto w-48 shrink-0 md:mx-0">
          <div className="aspect-[3/4] overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 to-lavender-100 shadow-lift">
            {book.cover_image ? (
              <Image
                src={book.cover_image}
                alt={`Couverture de ${book.title}`}
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
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>{book.page_count} pages</span>
            <StatusBadge status={book.status} />
            {book.child_name ? ` · pour ${book.child_name}` : ""}
          </p>
          {book.status === "generating" ? (
            <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-ink">
              On termine encore votre cahier — quelques pages arrivent.
            </div>
          ) : null}
          {book.status === "failed" ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-ink">
              La création n&apos;a pas abouti. Vos crédits ont été remboursés — réessayez
              depuis « Créer pour mon enfant ».
            </div>
          ) : null}
          {totalMissingCount > 0 && book.status !== "generating" && book.status !== "failed" ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-ink">
              {totalMissingCount} page{totalMissingCount > 1 ? "s manquent" : " manque"} encore.
              Reprenez-les avant l&apos;impression pour obtenir le cahier complet.
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            {canExportPdf ? (
              <PdfDownloadButton
                bookId={id}
                pdfUrl={book.pdf_url}
                label="Télécharger le PDF"
              />
            ) : book.status === "generating" ? (
              <Link href={generateHref}>
                <Button size="lg">Voir la création</Button>
              </Link>
            ) : (
              <Link href="/create">
                <Button variant="secondary">Créer pour mon enfant</Button>
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
                      alt={`Page ${page.page_number}${page.title ? ` — ${page.title}` : ""}`}
                      width={512}
                      height={512}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-cream-100 to-sky-50 px-6 text-center">
                      <p className="text-sm font-medium text-ink-muted">
                        Illustration manquante
                      </p>
                      <RegeneratePageButton
                        bookId={id}
                        pageId={page.id}
                        costCredits={2}
                      />
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
                    <RegeneratePageButton
                      bookId={id}
                      pageId={page.id}
                      costCredits={2}
                    />
                  ) : null}
                </div>
              </Card>
            ))}
        </div>
      </section>
    </div>
  );
}
