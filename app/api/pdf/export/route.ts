import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit-store";
import {
  isPdfExportLeaseActive,
  validatePdfExportState,
} from "@/lib/pdf-export-state";
import { BookService } from "@/services/book-service";
import { PDFService } from "@/services/pdf-service";
import { StorageService } from "@/services/storage-service";
import { randomUUID } from "crypto";
import { z } from "zod";

export const maxDuration = 120;

const schema = z.object({ book_id: z.string().uuid() });
const FIRESTORE_SAFE_DATA_URL = 800_000;

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    rateLimit(`pdfexport:${user.id}`, { limit: 8, windowMs: 60_000 });
    const { book_id } = schema.parse(await request.json());
    const books = new BookService(db);
    const bookRef = db.collection("books").doc(book_id);
    const exportToken = randomUUID();
    const startedAt = new Date().toISOString();

    const lease = await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookRef);
      if (!snap.exists || snap.data()?.user_id !== user.id) {
        throw new AppError("NOT_FOUND", "Livre introuvable", 404);
      }
      const data = snap.data()!;
      if (typeof data.pdf_url === "string" && data.pdf_url.length > 0) {
        return { existingUrl: data.pdf_url };
      }
      if (
        isPdfExportLeaseActive(
          data.pdf_export_token,
          data.pdf_export_started_at
        )
      ) {
        throw new AppError(
          "CONFLICT",
          "Le PDF est déjà en préparation dans un autre onglet.",
          409
        );
      }
      tx.update(bookRef, {
        pdf_export_token: exportToken,
        pdf_export_started_at: startedAt,
        updated_at: startedAt,
      });
      return { existingUrl: null };
    });

    if (lease.existingUrl) {
      return apiSuccess({ pdf_url: lease.existingUrl, reused: true });
    }

    try {
      const book = await books.getWithPages(user.id, book_id);
      const exportState = validatePdfExportState(book.status, book.pages);
      if (exportState !== "ok") {
        const messages = {
          book_not_ready: "Ce livre n'est pas encore prêt pour l'export.",
          page_retry_active:
            "Une page est en cours de régénération. Attendez sa fin avant l'export.",
          no_printable_pages: "Aucune page illustrée n'est prête à imprimer.",
        } as const;
        throw new AppError(
          "CONFLICT",
          messages[exportState],
          409
        );
      }

      const bytes = await new PDFService().buildBookPdf({
        title: book.title,
        subtitle: book.subtitle,
        coverUrl: book.cover_image,
        pages: book.pages.map((p) => ({
          pageNumber: p.page_number,
          title: p.title,
          storyText: p.story_text,
          illustrationUrl: p.illustration_url,
        })),
      });

      const pdfPath = `exports/${user.id}/${book_id}.pdf`;
      let url: string;
      let persistedPath: string | null = null;
      try {
        url = await new StorageService().uploadBytes(
          pdfPath,
          bytes,
          "application/pdf",
          "export"
        );
        persistedPath = pdfPath;
      } catch {
        const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
        if (dataUrl.length > FIRESTORE_SAFE_DATA_URL) {
          throw new AppError(
            "PDF_EXPORT_FAILED",
            "Export trop volumineux — réessaie dans un instant.",
            503
          );
        }
        url = dataUrl;
      }

      const published = await db.runTransaction(async (tx) => {
        const snap = await tx.get(bookRef);
        if (
          !snap.exists ||
          snap.data()?.user_id !== user.id ||
          snap.data()?.pdf_export_token !== exportToken
        ) {
          return false;
        }
        tx.update(bookRef, {
          pdf_url: url,
          pdf_path: persistedPath,
          pdf_export_token: null,
          pdf_export_started_at: null,
          updated_at: new Date().toISOString(),
        });
        return true;
      });
      if (!published) {
        throw new AppError(
          "CONFLICT",
          "Une page a changé pendant l'export. Relancez le PDF pour obtenir la version à jour.",
          409
        );
      }

      return apiSuccess({ pdf_url: url });
    } catch (error) {
      await db
        .runTransaction(async (tx) => {
          const snap = await tx.get(bookRef);
          if (!snap.exists || snap.data()?.pdf_export_token !== exportToken) return;
          tx.update(bookRef, {
            pdf_export_token: null,
            pdf_export_started_at: null,
            updated_at: new Date().toISOString(),
          });
        })
        .catch(() => undefined);
      throw error;
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
