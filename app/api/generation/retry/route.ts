import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { getImageProvider } from "@/services/ai";
import { LicenseService } from "@/services/license-service";
import { CreditService } from "@/services/credit-service";
import { CREDIT_COSTS } from "@/config/credits";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { z } from "zod";

/** Retry may regenerate several page images. */
export const maxDuration = 300;

const schema = z.object({
  book_id: z.string().uuid(),
  page_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    await new LicenseService(db).requireActiveLicense(user.id, user.email);
    const body = schema.parse(await request.json());
    const bookSnap = await db.collection("books").doc(body.book_id).get();
    if (!bookSnap.exists || bookSnap.data()?.user_id !== user.id) {
      throw new AppError("NOT_FOUND", "Livre introuvable", 404);
    }
    const book = bookSnap.data()!;
    const credits = new CreditService(db);
    const pagesCol = db.collection("books").doc(body.book_id).collection("pages");
    const retryToken = randomUUID();

    let pages: QueryDocumentSnapshot[] = [];

    if (body.page_id) {
      const one = await pagesCol.doc(body.page_id).get();
      if (!one.exists) {
        throw new AppError("NOT_FOUND", "Page introuvable", 404);
      }
      pages = [one as QueryDocumentSnapshot];
    } else {
      const allSnap = await pagesCol.get();
      pages = allSnap.docs.filter((d) => {
        const p = d.data();
        return (
          p.generation_status === "failed" ||
          !p.illustration_url ||
          p.generation_status === "pending"
        );
      });
    }

    const characterBible =
      (typeof book.character_bible === "string" && book.character_bible) ||
      (await loadCharacterBibleFromUniverse(db, book.universe_id as string));
    const characterSheetUrl =
      typeof book.character_sheet_url === "string"
        ? book.character_sheet_url
        : undefined;
    const worldSetting =
      typeof book.story_plan === "object" &&
      book.story_plan &&
      "world" in (book.story_plan as object)
        ? [
            (book.story_plan as { world?: { setting?: string; mood?: string } })
              .world?.setting,
            (book.story_plan as { world?: { setting?: string; mood?: string } })
              .world?.mood,
          ]
            .filter(Boolean)
            .join(" — ")
        : undefined;

    // Charge per page up-front (atomic reservation). Pages that still fail are
    // refunded below, so the customer only pays for pages actually recovered.
    const perPage = CREDIT_COSTS.regenerate_page;
    const reserveAmount = pages.length * perPage;
    if (reserveAmount > 0) {
      await credits.reserve(
        user.id,
        reserveAmount,
        `Réservation régénération ${pages.length} page(s)`,
        `retry:${retryToken}:reserve`
      );
    }

    const imageProvider = getImageProvider();
    let recovered = 0;
    let stillFailed = 0;

    // Everything after the reservation is wrapped so a crash mid-run always
    // refunds the unused portion (reserved − paid-for-recovered) rather than
    // stranding the customer's credits. The refund is idempotent per token.
    try {
      for (const pageDoc of pages) {
        const page = pageDoc.data();
        await pageDoc.ref.update({
          generation_status: "generating",
          updated_at: new Date().toISOString(),
        });
        try {
          const pageLock =
            (typeof page.character_lock === "string" && page.character_lock) ||
            characterBible;
          const image = await imageProvider.generateImage({
            prompt: [
              page.illustration_prompt ||
                page.story_text ||
                book.idea ||
                book.title,
              page.shot_type ? `Shot: ${page.shot_type}.` : "",
              "Mandatory rich colorable environment matching the caption. No empty white void. Simplified mitten hands. Max 2 characters. Full figures inside frame with margins.",
            ]
              .filter(Boolean)
              .join(" "),
            style: book.style || "cute",
            characterBible: pageLock,
            negativePrompt:
              (typeof page.negative_prompt === "string" && page.negative_prompt) ||
              undefined,
            worldSetting,
            isColoringPage: true,
            referenceImageUrl: characterSheetUrl,
            shotType: page.shot_type,
            comicBeat: page.comic_beat,
          });
          if (!image?.url) throw new Error("Empty image URL");
          await pageDoc.ref.update({
            illustration_url: image.url,
            generation_status: "completed",
            updated_at: new Date().toISOString(),
          });
          recovered += 1;
        } catch {
          await pageDoc.ref.update({
            generation_status: "failed",
            illustration_url: null,
            updated_at: new Date().toISOString(),
          });
          stillFailed += 1;
        }
      }
    } finally {
      // Refund everything that was reserved but not turned into a recovered
      // page (covers both still-failed pages and an early crash). Idempotent.
      const refundAmount = Math.max(0, reserveAmount - recovered * perPage);
      if (refundAmount > 0) {
        await credits.refund(
          user.id,
          refundAmount,
          `Remboursement ${pages.length - recovered} page(s) non régénérée(s)`,
          `retry:${retryToken}:refund`
        );
      }
    }

    // Promote book to completed when every page has an image
    const afterSnap = await pagesCol.get();
    const missing = afterSnap.docs.filter((d) => {
      const p = d.data();
      return !p.illustration_url || p.generation_status === "failed";
    }).length;

    if (afterSnap.size > 0 && missing === 0) {
      await bookSnap.ref.update({
        status: "completed",
        updated_at: new Date().toISOString(),
      });
    } else if (missing > 0 && book.status !== "generating") {
      await bookSnap.ref.update({
        status: "partial",
        updated_at: new Date().toISOString(),
      });
    }

    return apiSuccess({
      retried: pages.length,
      recovered,
      still_failed: stillFailed,
      book_status: missing === 0 ? "completed" : "partial",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}

async function loadCharacterBibleFromUniverse(
  db: Firestore,
  universeId: string
): Promise<string | undefined> {
  try {
    const snap = await db
      .collection("universes")
      .doc(universeId)
      .collection("characters")
      .get();
    if (snap.empty) return undefined;
    return snap.docs
      .map((d) => {
        const c = d.data();
        const lock = c.visual_lock || c.appearance || "";
        return `${c.name}: ${lock}`;
      })
      .join(" | ");
  } catch {
    return undefined;
  }
}
