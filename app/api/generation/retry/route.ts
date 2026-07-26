import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit-store";
import { getImageProvider } from "@/services/ai";
import { buildWorldNegative } from "@/services/ai/prompts";
import {
  buildCompactScene,
  buildPageScene,
  charactersForPage,
  expectedCastFor,
  formatPageCharacterLock,
  settingElementsForScene,
} from "@/services/ai/character-bible";
import type { ImageQcStats, SettingBible, StoryPlan } from "@/services/ai/types";
import { pageStyleSeed } from "@/lib/book-style-seed";
import { LicenseService } from "@/services/license-service";
import { CreditService } from "@/services/credit-service";
import { StorageService } from "@/services/storage-service";
import { CREDIT_COSTS } from "@/config/credits";
import { firestoreSafe } from "@/lib/firestore-sanitize";
import type {
  CollectionReference,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
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
    rateLimit(`genretry:${user.id}`, { limit: 10, windowMs: 60_000 });
    await new LicenseService(db).requireActiveLicense(user.id, user.email);
    const body = schema.parse(await request.json());
    const bookSnap = await db.collection("books").doc(body.book_id).get();
    if (!bookSnap.exists || bookSnap.data()?.user_id !== user.id) {
      throw new AppError("NOT_FOUND", "Livre introuvable", 404);
    }
    const book = bookSnap.data()!;
    const credits = new CreditService(db);
    const strictDelivery =
      book.source === "parent_create" || book.type === "colorbook";
    const storyPlan = strictDelivery ? storyPlanFromBook(book) : null;
    const pagesCol = db.collection("books").doc(body.book_id).collection("pages");
    const retryToken = randomUUID();
    const now = new Date().toISOString();

    // Preload candidates, then claim inside a transaction so concurrent retries
    // cannot double-charge the same page.
    let candidates: QueryDocumentSnapshot[] = [];
    if (body.page_id) {
      const one = await pagesCol.doc(body.page_id).get();
      if (!one.exists) {
        throw new AppError("NOT_FOUND", "Page introuvable", 404);
      }
      candidates = [one as QueryDocumentSnapshot];
    } else {
      await restoreMissingPageDocuments(db, pagesCol, book);
      const allSnap = await pagesCol.get();
      candidates = allSnap.docs.filter((d) => {
        const p = d.data();
        return (
          p.generation_status === "failed" ||
          !p.illustration_url ||
          p.generation_status === "pending"
        );
      }) as QueryDocumentSnapshot[];
    }

    const claimedIds = await db.runTransaction(async (tx) => {
      const ids: string[] = [];
      for (const doc of candidates) {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) continue;
        const p = fresh.data()!;
        if (p.generation_status === "generating") {
          if (body.page_id) {
            throw new AppError(
              "CONFLICT",
              "Cette page est déjà en cours de régénération.",
              409
            );
          }
          continue;
        }
        const needs =
          body.page_id != null ||
          p.generation_status === "failed" ||
          !p.illustration_url ||
          p.generation_status === "pending";
        if (!needs) continue;
        tx.update(doc.ref, {
          generation_status: "generating",
          retry_token: retryToken,
          updated_at: now,
        });
        ids.push(doc.id);
      }
      // Keep the previous PDF and illustration until a replacement has passed
      // the complete premium gate. A rejected retry must be lossless.
      return ids;
    });

    if (claimedIds.length === 0) {
      return apiSuccess({
        retried: 0,
        recovered: 0,
        still_failed: 0,
        book_status: book.status,
        message: "Aucune page à régénérer.",
      });
    }

    const claimedSnaps: QueryDocumentSnapshot[] = [];
    for (const id of claimedIds) {
      const snap = await pagesCol.doc(id).get();
      if (snap.exists) claimedSnaps.push(snap as QueryDocumentSnapshot);
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

    const universeSnap = await db
      .collection("universes")
      .doc(book.universe_id as string)
      .get();
    const settingBible = universeSnap.data()?.setting_bible as SettingBible | undefined;
    const worldNegative = buildWorldNegative(settingBible?.forbiddenElements);
    const sheetCrops = (universeSnap.data()?.model_sheet_crops || {}) as Record<
      string,
      { url?: string }
    >;
    const storage = new StorageService();

    const perPage = CREDIT_COSTS.regenerate_page;
    const reserveAmount = claimedIds.length * perPage;
    const retryRef = db.collection("generation_retries").doc(retryToken);

    // Durable retry op so the reaper can refund if this process dies mid-run.
    await retryRef.set({
      user_id: user.id,
      book_id: body.book_id,
      page_ids: claimedIds,
      reserved_amount: reserveAmount,
      per_page: perPage,
      recovered: 0,
      status: "running",
      created_at: now,
      updated_at: now,
    });

    if (reserveAmount > 0) {
      try {
        await credits.reserve(
          user.id,
          reserveAmount,
          `Réservation régénération ${claimedIds.length} page(s)`,
          `retry:${retryToken}:reserve`
        );
      } catch (err) {
        // Unlock claimed pages and mark retry failed.
        await Promise.all(
          claimedIds.map((id) =>
            pagesCol.doc(id).set(
              {
                generation_status: "failed",
                retry_token: null,
                updated_at: new Date().toISOString(),
              },
              { merge: true }
            )
          )
        );
        await retryRef.set(
          { status: "failed", updated_at: new Date().toISOString() },
          { merge: true }
        );
        throw err;
      }
    }

    const imageProvider = getImageProvider();
    let recovered = 0;
    let stillFailed = 0;

    try {
      for (const pageDoc of claimedSnaps) {
        const page = pageDoc.data();
        try {
          const pageLock =
            (typeof page.character_lock === "string" && page.character_lock) ||
            characterBible;
          const scene =
            page.illustration_prompt || page.story_text || book.idea || book.title;
          const planPage = storyPlan?.pages.find(
            (candidate) => candidate.pageNumber === page.page_number
          );
          const expectedCast = planPage && storyPlan
            ? expectedCastFor(charactersForPage(storyPlan, planPage))
            : undefined;
          const referenceImageUrl =
            (Array.isArray(page.character_ids) &&
              page.character_ids.length === 1 &&
              sheetCrops[page.character_ids[0]]?.url) ||
            characterSheetUrl;
          if (strictDelivery && !referenceImageUrl) {
            throw new Error("Premium retry requires a character reference");
          }
          const qcStats: ImageQcStats = {};
          const image = await imageProvider.generateImage({
            prompt: [
              scene,
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
            referenceImageUrl,
            shotType: page.shot_type,
            comicBeat: page.comic_beat,
            action: (typeof page.action === "string" && page.action) || undefined,
            refScene:
              (typeof page.ref_scene === "string" && page.ref_scene) || undefined,
            settingElements: settingElementsForScene(
              settingBible?.elements,
              `${scene} ${page.story_text || ""}`
            ),
            worldNegative,
            expectedCast,
            qcStats,
            strictQuality: strictDelivery,
            ...(strictDelivery
              ? {
                  maxVisionRerolls: 2,
                  maxQualityRerolls: 2,
                  maxProviderAttempts: 2,
                  skipRecovery: false,
                  seed: pageStyleSeed(body.book_id, Number(page.page_number) || 1),
                  stylePreset: "COLORING_BOOK_I",
                  heroGender:
                    typeof book.child_gender === "string"
                      ? book.child_gender
                      : undefined,
                  consistencyMode: true,
                }
              : {}),
          });
          if (!image?.url) throw new Error("Empty image URL");
          const persisted = await storage.persistImageFromUrl(
            image.url,
            `books/${body.book_id}/retries/${retryToken}/pages/${page.page_number}-${pageDoc.id}.png`
          );
          if (strictDelivery && !persisted.path) {
            throw new Error("Premium retry image was not persisted");
          }
          await pageDoc.ref.update({
            illustration_url: persisted.url,
            illustration_path: persisted.path,
            generation_status: "completed",
            qc_stats: qcStats,
            retry_token: null,
            updated_at: new Date().toISOString(),
          });
          await bookSnap.ref.update({
            pdf_url: null,
            pdf_path: null,
            pdf_export_token: null,
            pdf_export_started_at: null,
            status: strictDelivery ? "draft" : book.status,
            updated_at: new Date().toISOString(),
          });
          recovered += 1;
          await retryRef.set(
            { recovered, updated_at: new Date().toISOString() },
            { merge: true }
          );
        } catch {
          const hadPrevious =
            typeof page.illustration_url === "string" &&
            Boolean(page.illustration_url) &&
            (!strictDelivery ||
              (typeof page.illustration_path === "string" &&
                Boolean(page.illustration_path)));
          await pageDoc.ref.update({
            generation_status: hadPrevious ? "completed" : "failed",
            illustration_url: hadPrevious ? page.illustration_url : null,
            illustration_path: hadPrevious ? page.illustration_path || null : null,
            retry_token: null,
            updated_at: new Date().toISOString(),
          });
          stillFailed += 1;
        }
      }
    } finally {
      const refundAmount = Math.max(0, reserveAmount - recovered * perPage);
      if (refundAmount > 0) {
        await credits.refund(
          user.id,
          refundAmount,
          `Remboursement ${claimedIds.length - recovered} page(s) non régénérée(s)`,
          `retry:${retryToken}:refund`
        );
      }
      await retryRef.set(
        {
          status: "completed",
          recovered,
          still_failed: stillFailed,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    const afterSnap = await pagesCol.get();
    const missing = afterSnap.docs.filter((d) => {
      const p = d.data();
      return !p.illustration_url || p.generation_status === "failed";
    }).length;

    if (afterSnap.size > 0 && missing === 0) {
      await bookSnap.ref.update({
        status: strictDelivery && recovered > 0 ? "draft" : "completed",
        updated_at: new Date().toISOString(),
      });
    } else if (missing > 0 && book.status !== "generating") {
      await bookSnap.ref.update({
        status: "partial",
        updated_at: new Date().toISOString(),
      });
    }

    return apiSuccess({
      retried: claimedIds.length,
      recovered,
      still_failed: stillFailed,
      book_status: missing === 0 ? (strictDelivery && recovered > 0 ? "draft" : "completed") : "partial",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", e.errors[0]?.message ?? "Invalid", 400));
    }
    return apiError(e);
  }
}

async function restoreMissingPageDocuments(
  db: Firestore,
  pagesCol: CollectionReference,
  book: Record<string, unknown>
) {
  const expected =
    typeof book.page_count === "number" && book.page_count > 0
      ? Math.floor(book.page_count)
      : 0;
  if (expected === 0) return;

  const raw = book.story_plan as Record<string, unknown> | null | undefined;
  if (!raw || !Array.isArray(raw.pages)) {
    throw new AppError(
      "CONFLICT",
      "Le plan source de ce livre est incomplet. Créez un nouveau cahier.",
      409
    );
  }

  const plan: StoryPlan = {
    title: typeof book.title === "string" ? book.title : "",
    subtitle: typeof book.subtitle === "string" ? book.subtitle : undefined,
    concept: typeof raw.concept === "string" ? raw.concept : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    moral: typeof raw.moral === "string" ? raw.moral : undefined,
    audienceAge:
      typeof raw.audience_age === "string" ? raw.audience_age : "",
    world: (raw.world || {
      setting: "",
      palette: "",
      mood: "",
    }) as StoryPlan["world"],
    characters: Array.isArray(raw.characters)
      ? (raw.characters as StoryPlan["characters"])
      : [],
    pages: raw.pages as StoryPlan["pages"],
  };

  const existing = await pagesCol.get();
  const existingNumbers = new Set(
    existing.docs
      .map((doc) => doc.data().page_number)
      .filter((value): value is number => Number.isInteger(value))
  );
  const missingPlanPages = plan.pages
    .filter(
      (page) =>
        Number.isInteger(page.pageNumber) &&
        page.pageNumber >= 1 &&
        page.pageNumber <= expected &&
        !existingNumbers.has(page.pageNumber)
    )
    .sort((a, b) => a.pageNumber - b.pageNumber);

  if (missingPlanPages.length === 0) return;
  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    const pending = await Promise.all(
      missingPlanPages.map(async (page) => {
        const ref = pagesCol.doc(`recovered-page-${page.pageNumber}`);
        const snap = await tx.get(ref);
        return { page, ref, exists: snap.exists };
      })
    );
    for (const { page, ref, exists } of pending) {
      if (exists) continue;
      tx.set(
        ref,
        firestoreSafe({
          page_number: page.pageNumber,
          title: page.title,
          story_text: page.storyText,
          illustration_prompt: buildPageScene(plan, page),
          ref_scene: buildCompactScene(plan, page),
          action: page.action ?? null,
          camera: page.camera ?? null,
          page_setting: page.pageSetting ?? null,
          focal_point: page.focalPoint ?? null,
          negative_prompt: page.negativePrompt ?? null,
          illustration_url: null,
          illustration_path: null,
          activity_type: null,
          generation_status: "pending",
          character_ids: page.characterIds || [],
          comic_beat: page.comicBeat ?? null,
          shot_type: page.shotType ?? null,
          character_lock: formatPageCharacterLock(plan, page),
          created_at: now,
          updated_at: now,
        })
      );
    }
  });
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


function storyPlanFromBook(book: Record<string, unknown>): StoryPlan {
  const raw = book.story_plan as Record<string, unknown> | null | undefined;
  if (!raw || !Array.isArray(raw.pages) || !Array.isArray(raw.characters)) {
    throw new AppError(
      "CONFLICT",
      "La bible visuelle de ce cahier est incomplète. Créez un nouveau cahier.",
      409
    );
  }
  return {
    title: typeof book.title === "string" ? book.title : "",
    subtitle: typeof book.subtitle === "string" ? book.subtitle : undefined,
    concept: typeof raw.concept === "string" ? raw.concept : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    moral: typeof raw.moral === "string" ? raw.moral : undefined,
    audienceAge: typeof raw.audience_age === "string" ? raw.audience_age : "",
    world: (raw.world || { setting: "", palette: "", mood: "" }) as StoryPlan["world"],
    characters: raw.characters as StoryPlan["characters"],
    pages: raw.pages as StoryPlan["pages"],
  };
}
