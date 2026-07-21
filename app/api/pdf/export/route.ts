import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { BookService } from "@/services/book-service";
import { PDFService } from "@/services/pdf-service";
import { StorageService } from "@/services/storage-service";
import { z } from "zod";

export const maxDuration = 120;

const schema = z.object({ book_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    const { book_id } = schema.parse(await request.json());
    const books = new BookService(db);
    const book = await books.getWithPages(user.id, book_id);
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

    let url: string;
    try {
      url = await new StorageService().uploadBytes(
        `exports/${user.id}/${book_id}-${Date.now()}.pdf`,
        bytes,
        "application/pdf"
      );
      await books.update(user.id, book_id, { pdf_url: url });
    } catch {
      url = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
    }

    return apiSuccess({ pdf_url: url });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}
