import { AppError } from "@/lib/errors";
import { mapWithConcurrency } from "@/lib/async";
import {
  buildCompactScene,
  buildPageScene,
  charactersForPage,
  coverCharacters,
  expectedCastFor,
  formatCharacterLock,
  formatPageCharacterLock,
  settingElementsForScene,
} from "@/services/ai/character-bible";
import { buildWorldNegative } from "@/services/ai/prompts";
import { firestoreSafe } from "@/lib/firestore-sanitize";
import { buildSheetCrops } from "@/services/ai/sheet-crops";
import { overlayCoverTitle } from "@/lib/cover-title";
import type { ImageQcStats, SettingBible, StoryPlan } from "@/services/ai/types";
import { getImageProvider, getTextProvider } from "@/services/ai";
import { BookService } from "@/services/book-service";
import { CreditService } from "@/services/credit-service";
import { PDFService } from "@/services/pdf-service";
import { StorageService } from "@/services/storage-service";
import { isBlankOrTooFaint, isColored } from "@/lib/image-quality";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";
import { refundForFailedPages } from "@/config/credits";
import type { Firestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

/** Parse an env integer, falling back to `fallback` on NaN/≤0 (misconfig-safe). */
function envInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Aggregate per-image QC stats into a Firestore-friendly summary. */
function summarizeQcStats(all: Record<string, ImageQcStats>) {
  let pixel = 0;
  let vision = 0;
  const verdicts: Record<string, string[]> = {};
  for (const [image, s] of Object.entries(all)) {
    pixel += s.pixelRerolls || 0;
    vision += s.visionRerolls || 0;
    if (s.visionVerdicts?.length) verdicts[image] = s.visionVerdicts.slice(0, 6);
  }
  return {
    images: Object.keys(all).length,
    pixel_rerolls: pixel,
    vision_rerolls: vision,
    vision_verdicts: verdicts,
  };
}

/** Parallel page image generation (fal). Keep low to avoid rate limits. */
const PAGE_GEN_CONCURRENCY = envInt(process.env.PAGE_GEN_CONCURRENCY, 3);
/** How many times to (re)generate the character model sheet if it comes back blank/poor. */
const SHEET_MAX_ATTEMPTS = envInt(process.env.SHEET_MAX_ATTEMPTS, 3);

export class GenerationOrchestrator {
  private books: BookService;
  private credits: CreditService;
  private pdf: PDFService;
  private storage: StorageService;

  constructor(private db: Firestore) {
    this.books = new BookService(db);
    this.credits = new CreditService(db);
    this.pdf = new PDFService();
    this.storage = new StorageService();
  }

  async run(
    userId: string,
    bookId: string,
    generationId: string,
    cost: number,
    opts?: { isTrial?: boolean }
  ) {
    const started = Date.now();
    const isTrial = Boolean(opts?.isTrial);
    try {
      await this.updateGeneration(generationId, {
        status: "running",
        current_step: "researcher",
        progress: 8,
      });

      const book = await this.books.get(userId, bookId);
      const idea =
        book.idea ||
        book.original_idea ||
        "Une aventure magique pour enfants";
      const style = book.style || "cute";
      const pageCount = book.page_count || 12;
      const universeId = book.universe_id;
      const audience = book.audience || book.audience_age || undefined;

      const textProvider = getTextProvider();
      const research = await textProvider.buildResearchBrief(idea);

      await this.updateGeneration(generationId, {
        current_step: "author",
        progress: 18,
      });

      const plan = await textProvider.generateStoryPlan(
        idea,
        pageCount,
        style,
        research,
        audience
      );

      // firestoreSafe: LLM output may contain nested arrays / undefined that
      // Firestore rejects (a single bad field kills the whole generation).
      await this.db.collection("prompts").add(
        firestoreSafe({
          user_id: userId,
          universe_id: universeId,
          book_id: bookId,
          original_prompt: book.original_idea || idea,
          optimized_prompt: plan.summary,
          creative_brief: idea,
          research_brief: research,
          created_at: new Date().toISOString(),
        })
      );

      await this.updateGeneration(generationId, {
        current_step: "character_designer",
        progress: 30,
      });

      // Characters
      const charsRef = this.db.collection("universes").doc(universeId).collection("characters");
      const existing = await charsRef.get();
      const batchDel = this.db.batch();
      existing.docs.forEach((d) => batchDel.delete(d.ref));
      await batchDel.commit();

      // One batched write for the whole cast (was one round-trip per character).
      const batchChars = this.db.batch();
      for (const c of plan.characters) {
        batchChars.set(charsRef.doc(), firestoreSafe({
          id_key: c.id,
          name: c.name,
          description: c.description,
          appearance: c.appearance,
          visual_lock: c.visualLock,
          personality: c.personality,
          age_band: c.ageBand ?? null,
          skin_tone: c.skinTone ?? null,
          hair: c.hair ?? null,
          face: c.face ?? null,
          body: c.body ?? null,
          outfit: c.outfit ?? null,
          signature_accessory: c.signatureAccessory ?? null,
          proportions: c.proportions ?? null,
          created_at: new Date().toISOString(),
        }));
      }
      await batchChars.commit();

      const fullCharacterBible = formatCharacterLock(plan.characters);
      const worldSetting = [plan.world?.setting, plan.world?.mood]
        .filter(Boolean)
        .join(" — ");

      // Setting bible (audit T3): lazy per-universe visual world contract —
      // generated once, stored on the universe, reused by every book. Fail-open:
      // a bible failure must not block the run.
      const settingBible = await this.ensureSettingBible(
        universeId,
        plan,
        style
      );
      const worldNegative = buildWorldNegative(settingBible?.forbiddenElements);

      const imageProvider = getImageProvider();
      const qcStatsAll: Record<string, ImageQcStats> = {};

      // Hero cast portrait first (identity reference when FAL_REF_ENDPOINT is set).
      // The proven reference is a COLORED flat-cartoon portrait of the exact cast
      // (public/_phase2ab/_hero.png). ROOT-CAUSE GUARD: a blank OR non-colored hero must
      // NEVER be used as a Kontext reference — a B&W result means the model drifted to a
      // degenerate generic sheet (the "two boys" bug) and every page would inherit the
      // wrong cast. Generate up to SHEET_MAX_ATTEMPTS candidates; if none is plausible,
      // drop the reference so pages fall back to TEXT-ONLY generation.
      let characterSheetUrl: string | null = null;
      const sheetCast = expectedCastFor(plan.characters);
      for (let attempt = 1; attempt <= SHEET_MAX_ATTEMPTS; attempt++) {
        try {
          const sheetStats: ImageQcStats = {};
          const sheet = await imageProvider.generateImage({
            prompt: "character model sheet",
            style,
            characterBible: fullCharacterBible,
            worldSetting,
            isCharacterSheet: true,
            // Vision cast QC (audit T4): exact count + species vs the brief.
            expectedCast: sheetCast,
            qcStats: sheetStats,
          });
          qcStatsAll.model_sheet = sheetStats;
          if (await this.isImplausibleHero(sheet.url)) {
            console.warn(
              `hero portrait attempt ${attempt}/${SHEET_MAX_ATTEMPTS} implausible (blank or not colored); retrying with a fresh seed`
            );
            continue;
          }
          // Persist the hero (audit T7): fal URLs are ephemeral; Kontext also
          // needs a stable reference for retries weeks later.
          const persisted = await this.storage.persistImageFromUrl(
            sheet.url,
            `universes/${universeId}/model_sheet.png`
          );
          characterSheetUrl = persisted.url;
          console.log(`hero portrait accepted on attempt ${attempt}/${SHEET_MAX_ATTEMPTS}`);
          break;
        } catch (sheetErr) {
          console.warn(
            `hero portrait attempt ${attempt}/${SHEET_MAX_ATTEMPTS} failed`,
            sheetErr
          );
        }
      }

      // Per-character crops (benchmark winner): SOLO pages guided by the FULL
      // lineup leak the absent character back in — a crop removes the leak.
      let sheetCrops: Record<string, { url: string; path: string }> = {};
      if (characterSheetUrl) {
        sheetCrops = await buildSheetCrops(
          characterSheetUrl,
          plan.characters,
          universeId,
          this.storage
        );
        await this.db.collection("universes").doc(universeId).update({
          model_sheet_crops: sheetCrops,
          updated_at: new Date().toISOString(),
        });
        const afterChars = await charsRef.get();
        const sheetBatch = this.db.batch();
        afterChars.docs.forEach((d) => {
          sheetBatch.update(d.ref, { image_reference: characterSheetUrl });
        });
        await sheetBatch.commit();
      } else {
        console.warn(
          "hero portrait implausible/unavailable after retries; pages will use TEXT-ONLY generation (no Kontext reference)"
        );
      }

      await this.books.update(userId, bookId, {
        title: plan.title,
        subtitle: plan.subtitle ?? null,
        character_bible: fullCharacterBible,
        character_sheet_url: characterSheetUrl,
        story_plan: firestoreSafe({
          concept: plan.concept ?? null,
          summary: plan.summary,
          moral: plan.moral ?? null,
          audience_age: plan.audienceAge,
          world: plan.world,
          characters: plan.characters,
        }),
      });

      // Reset pages
      const pagesCol = this.db.collection("books").doc(bookId).collection("pages");
      const oldPages = await pagesCol.get();
      const batchPages = this.db.batch();
      oldPages.docs.forEach((d) => batchPages.delete(d.ref));
      await batchPages.commit();

      const insertedPages: Array<{
        id: string;
        scene: string;
        ref_scene: string;
        action?: string;
        negative_prompt: string;
        story_text: string;
        page_number: number;
        character_ids: string[];
        comic_beat?: string;
        shot_type?: string;
        page_character_lock: string;
        expected_cast: Array<{ name: string; kind: string }>;
        setting_elements: string[];
      }> = [];

      // All page rows land in one batched write (≤ 40 pages, far under the
      // 500-write batch limit) instead of one round-trip per page.
      const pageInserts = this.db.batch();
      for (const p of plan.pages) {
        const pageId = randomUUID();
        const pageLock = formatPageCharacterLock(plan, p);
        // Definitive per-page scene (audit T1): the page's OWN structured
        // action/poses/camera/setting dominate — never the global synopsis.
        const scene = buildPageScene(plan, p);
        const refScene = buildCompactScene(plan, p);
        const row = {
          page_number: p.pageNumber,
          title: p.title,
          story_text: p.storyText,
          illustration_prompt: scene,
          ref_scene: refScene,
          action: p.action ?? null,
          camera: p.camera ?? null,
          page_setting: p.pageSetting ?? null,
          focal_point: p.focalPoint ?? null,
          negative_prompt: p.negativePrompt ?? null,
          illustration_url: null,
          illustration_path: null,
          activity_type: null,
          generation_status: "pending",
          character_ids: p.characterIds || [],
          comic_beat: p.comicBeat ?? null,
          shot_type: p.shotType ?? null,
          character_lock: pageLock,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        pageInserts.set(pagesCol.doc(pageId), firestoreSafe(row));
        insertedPages.push({
          id: pageId,
          scene,
          ref_scene: refScene,
          action: p.action,
          negative_prompt: p.negativePrompt ?? "",
          story_text: p.storyText,
          page_number: p.pageNumber,
          character_ids: p.characterIds || [],
          comic_beat: p.comicBeat,
          shot_type: p.shotType,
          page_character_lock: pageLock,
          expected_cast: expectedCastFor(charactersForPage(plan, p)),
          setting_elements: settingElementsForScene(
            settingBible?.elements,
            `${scene} ${p.storyText}`
          ),
        });
      }
      await pageInserts.commit();

      await this.updateGeneration(generationId, {
        current_step: "illustrator",
        progress: 45,
      });

      // Cover (audit T6): poster composition — heroes IN ACTION in the world's
      // signature setting, lettered title in the reserved top band (Ideogram),
      // spoiler-free cast (characters met later stay off the cover).
      const coverCast = coverCharacters(plan);
      const coverAction =
        plan.pages.find((p) => p.action && p.comicBeat === "action")?.action ||
        plan.pages.find((p) => p.action)?.action ||
        plan.summary;
      const coverStats: ImageQcStats = {};
      // Benchmark winner: WITH a hero reference → Kontext cover (identity is
      // reliable, lettering is not) + server-side title overlay. WITHOUT a
      // reference → Ideogram lettered cover (title reliable; vision cast QC
      // re-rolls species drift).
      const useOverlayTitle = Boolean(characterSheetUrl);
      const cover = await imageProvider.generateImage({
        prompt: `${plan.title}. ${plan.summary}`,
        style,
        characterBible: formatCharacterLock(coverCast),
        worldSetting,
        isCover: true,
        referenceImageUrl: characterSheetUrl || undefined,
        coverTitle: useOverlayTitle ? undefined : plan.title,
        action: coverAction,
        refScene: coverAction,
        settingElements: settingElementsForScene(
          settingBible?.elements,
          `${coverAction} ${plan.summary}`,
          4
        ),
        worldNegative,
        expectedCast: expectedCastFor(coverCast),
        qcStats: coverStats,
      });
      qcStatsAll.cover = coverStats;
      const persistedCover = await this.persistCover(
        cover.url,
        bookId,
        useOverlayTitle ? plan.title : null
      );
      await this.books.update(userId, bookId, {
        cover_image: persistedCover.url,
        cover_image_path: persistedCover.path,
      });
      await this.db.collection("universes").doc(universeId).update({
        cover_image: persistedCover.url,
        updated_at: new Date().toISOString(),
      });

      let completedCount = 0;
      let failedCount = 0;

      const pageOutcomes = await mapWithConcurrency(
        insertedPages,
        PAGE_GEN_CONCURRENCY,
        async (page, index) => {
          await pagesCol.doc(page.id).update({ generation_status: "generating" });
          try {
            const scenePrompt = [
              page.scene || page.story_text || plan.summary,
              page.shot_type ? `Shot: ${page.shot_type}.` : "",
              page.comic_beat ? `Beat: ${page.comic_beat}.` : "",
              "Mandatory rich colorable environment matching the caption. No empty white void. Simplified mitten hands. Max 2 characters. Full figures inside frame with margins.",
            ]
              .filter(Boolean)
              .join(" ");

            const pageStats: ImageQcStats = {};
            // Benchmark winner: solo pages use the character's OWN crop as the
            // reference (full lineup leaks the absent character back in).
            const pageReference =
              page.character_ids.length === 1 &&
              sheetCrops[page.character_ids[0]]?.url
                ? sheetCrops[page.character_ids[0]].url
                : characterSheetUrl || undefined;
            const image = await imageProvider.generateImage({
              prompt: scenePrompt,
              style,
              characterBible: page.page_character_lock || fullCharacterBible,
              negativePrompt: page.negative_prompt || undefined,
              worldSetting,
              isColoringPage: true,
              referenceImageUrl: pageReference,
              refScene: page.ref_scene,
              shotType: page.shot_type,
              comicBeat: page.comic_beat,
              action: page.action,
              settingElements: page.setting_elements,
              worldNegative,
              expectedCast: page.expected_cast,
              qcStats: pageStats,
            });
            qcStatsAll[`page_${page.page_number}`] = pageStats;

            if (!image?.url) {
              throw new Error("Image provider returned empty URL");
            }

            // Persist to Storage (audit T7): never leave an ephemeral fal URL
            // as the page's source of truth.
            const persisted = await this.storage.persistImageFromUrl(
              image.url,
              `books/${bookId}/pages/${page.page_number}.png`
            );

            await pagesCol.doc(page.id).update({
              illustration_url: persisted.url,
              illustration_path: persisted.path,
              generation_status: "completed",
              updated_at: new Date().toISOString(),
            });
            return "ok" as const;
          } catch (err) {
            console.error(`page ${page.page_number} generation failed`, err);
            await pagesCol.doc(page.id).update({
              illustration_url: null,
              generation_status: "failed",
              updated_at: new Date().toISOString(),
            });
            return "fail" as const;
          } finally {
            const progress =
              45 + Math.round(((index + 1) / insertedPages.length) * 40);
            // Approximate progress under concurrency (index may finish out of order)
            await this.updateGeneration(generationId, {
              current_step: "illustrator",
              progress: Math.min(progress, 88),
            });
          }
        }
      );

      completedCount = pageOutcomes.filter((o) => o === "ok").length;
      failedCount = pageOutcomes.filter((o) => o === "fail").length;

      await this.updateGeneration(generationId, {
        current_step: "illustrator",
        progress: 90,
      });

      // Never mark a book "completed" with blank pages
      if (completedCount === 0) {
        await this.books.update(userId, bookId, { status: "failed" });
        // Nothing was produced — refund the entire reservation.
        await this.credits.refund(
          userId,
          cost,
          "Remboursement — génération échouée (aucune page)",
          `gen:${generationId}:refund`
        );
        await this.updateGeneration(generationId, {
          status: "failed",
          current_step: "illustrator",
          progress: 90,
          credits_used: 0,
          error_message:
            "Aucune page illustrée n’a pu être générée. Réessayez ou régénérez les pages.",
          duration_ms: Date.now() - started,
        });
        return;
      }

      await this.updateGeneration(generationId, {
        current_step: "editor",
        progress: 92,
      });

      const full = await this.books.getWithPages(userId, bookId);
      const pdfBytes = await this.pdf.buildBookPdf({
        title: full.title,
        subtitle: full.subtitle,
        coverUrl: full.cover_image,
        pages: full.pages.map((p) => ({
          pageNumber: p.page_number,
          title: p.title,
          storyText: p.story_text,
          illustrationUrl: p.illustration_url,
        })),
      });

      let pdfUrl: string | null = null;
      try {
        pdfUrl = await this.storage.uploadBytes(
          `exports/${userId}/${bookId}.pdf`,
          pdfBytes,
          "application/pdf"
        );
      } catch (uploadErr) {
        console.error("PDF storage upload failed; trying inline data URL", uploadErr);
        const dataUrl = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`;
        const firestoreSafeLimit = 800_000;
        if (dataUrl.length <= firestoreSafeLimit) {
          pdfUrl = dataUrl;
        } else {
          console.warn(
            "PDF data URL exceeds Firestore-safe size; pdf_url left null — use /api/pdf/export"
          );
        }
      }

      const bookStatus = failedCount > 0 ? "partial" : "completed";
      const genStatus = failedCount > 0 ? "partial" : "completed";

      await this.books.update(userId, bookId, {
        status: bookStatus,
        pdf_url: pdfUrl,
      });

      // Credits were reserved up-front for `book.page_count` pages in
      // generation/start. Refund every page the customer paid for but did not
      // receive — this covers both pages that failed to render AND pages the AI
      // plan never produced (plan shorter than requested). The customer pays
      // only for delivered pages (+ cover + PDF). Idempotent per generation.
      const plannedPages = (book.page_count as number) || insertedPages.length;
      const notDelivered = Math.max(0, plannedPages - completedCount);
      // Clamped to the reservation: a refund can never exceed what was actually
      // reserved (trials reserve 0 → refund 0 → no way to mint free credits).
      const refund = Math.min(
        refundForFailedPages(plannedPages, completedCount, book.type as string),
        cost
      );
      if (refund > 0) {
        await this.credits.refund(
          userId,
          refund,
          `Remboursement ${notDelivered} page(s) non livrée(s) — ${String(full.title)}`,
          `gen:${generationId}:refund`
        );
      }
      const creditsUsed = Math.max(0, cost - refund);

      // QC telemetry (audit T5): re-roll rate = real internal fal cost. Logged
      // per image on the generation doc so the rate is trackable over time.
      const qcSummary = summarizeQcStats(qcStatsAll);
      console.log(
        `[gen ${generationId}] QC re-rolls — pixel: ${qcSummary.pixel_rerolls}, vision: ${qcSummary.vision_rerolls}, images: ${qcSummary.images}`
      );

      await this.updateGeneration(generationId, {
        status: genStatus,
        current_step: "editor",
        progress: 100,
        qc_stats: qcSummary,
        credits_used: creditsUsed,
        provider:
          process.env.MOCK_AI === "true"
            ? "mock"
            : process.env.GROQ_API_KEY
              ? "groq+fal"
              : "openai+fal",
        duration_ms: Date.now() - started,
        error_message:
          failedCount > 0
            ? `${failedCount} page(s) sans illustration — utilisez « Régénérer cette page ».`
            : null,
      });

      // A delivered trial book consumes one free trial. Idempotent: the
      // `trial_counted` flag on the generation doc guards the increment even if
      // this path re-runs (retry after crash, replayed job).
      if (isTrial && completedCount > 0) {
        await this.consumeFreeTrial(userId, generationId);
      }
    } catch (err) {
      console.error("generation failed", err);
      await this.books.update(userId, bookId, { status: "failed" });
      // Refund the up-front reservation — the run crashed before delivering.
      // Idempotent: if a partial refund already landed this is a no-op.
      try {
        await this.credits.refund(
          userId,
          cost,
          "Remboursement — génération interrompue",
          `gen:${generationId}:refund`
        );
      } catch (refundErr) {
        console.error("refund after generation failure failed", refundErr);
      }
      await this.updateGeneration(generationId, {
        status: "failed",
        credits_used: 0,
        error_message: err instanceof Error ? err.message : "Erreur inconnue",
        duration_ms: Date.now() - started,
      });
    }
  }

  /**
   * Marks one free trial as consumed for a delivered trial book. Runs in a
   * transaction keyed on the generation's `trial_counted` flag so the same
   * generation can never consume more than one trial.
   */
  private async consumeFreeTrial(userId: string, generationId: string) {
    const genRef = this.db.collection("generations").doc(generationId);
    const userRef = this.db.collection("users").doc(userId);
    try {
      await this.db.runTransaction(async (tx) => {
        const gen = await tx.get(genRef);
        if (!gen.exists || gen.data()?.trial_counted === true) return;
        const user = await tx.get(userRef);
        const used = (user.data()?.free_trials_used as number) ?? 0;
        tx.update(genRef, { trial_counted: true });
        tx.update(userRef, {
          free_trials_used: used + 1,
          updated_at: new Date().toISOString(),
        });
      });
    } catch (err) {
      console.error("consumeFreeTrial failed", err);
    }
  }

  /**
   * Hero cast portrait plausibility gate. The proven identity reference is a COLORED
   * flat-cartoon portrait; a blank OR non-colored (B&W) result means the model drifted
   * to a degenerate generic sheet and must not seed the whole book. Returns true only
   * when we could analyze the image AND it fails the gate; network/analysis failures
   * return false (treat as usable) so a transient hiccup doesn't needlessly drop a hero.
   */
  private async isImplausibleHero(url: string | null | undefined): Promise<boolean> {
    if (!url) return true;
    try {
      const raw = new Uint8Array((await fetch(url).then((r) => r.arrayBuffer())) as ArrayBuffer);
      const png =
        detectImageFormat(raw) === "png" ? raw : new Uint8Array(await toPngBuffer(raw));
      if (isBlankOrTooFaint(png)) return true;
      return !isColored(png);
    } catch (err) {
      console.warn("could not validate hero portrait; assuming usable", err);
      return false;
    }
  }

  /**
   * Persist the cover to Storage, compositing the lettered title band first
   * when the cover came from the reference path (benchmark winner strategy).
   * Fail-open: overlay/persist failures keep the un-titled or source image.
   */
  private async persistCover(
    coverUrl: string,
    bookId: string,
    overlayTitle: string | null
  ): Promise<{ url: string; path: string | null }> {
    if (!overlayTitle) {
      return this.storage.persistImageFromUrl(coverUrl, `books/${bookId}/cover.png`);
    }
    try {
      const res = await fetch(coverUrl);
      if (!res.ok) throw new Error(`fetch cover ${res.status}`);
      const raw = new Uint8Array(await res.arrayBuffer());
      const png =
        detectImageFormat(raw) === "png" ? Buffer.from(raw) : await toPngBuffer(raw);
      const titled = await overlayCoverTitle(png, overlayTitle);
      const path = `books/${bookId}/cover.png`;
      const url = await this.storage.uploadBytes(path, titled, "image/png");
      return { url, path };
    } catch (err) {
      console.warn("cover title overlay failed; persisting untitled cover", err);
      return this.storage.persistImageFromUrl(coverUrl, `books/${bookId}/cover.png`);
    }
  }

  /**
   * Load or lazily create the universe's setting bible (audit T3). Stored on
   * the universe doc so all of its books share the same world contract.
   * Fail-open: returns null when generation fails — pages then fall back to
   * plan.world only.
   */
  private async ensureSettingBible(
    universeId: string,
    plan: StoryPlan,
    style: string
  ): Promise<SettingBible | null> {
    const ref = this.db.collection("universes").doc(universeId);
    try {
      const snap = await ref.get();
      const existing = snap.data()?.setting_bible as SettingBible | undefined;
      if (existing?.elements?.length) return existing;

      const universeTitle = (snap.data()?.title as string) || plan.title;
      const bible = await getTextProvider().generateSettingBible({
        universeTitle,
        universeDescription: (snap.data()?.description as string) || undefined,
        worldSetting: [plan.world?.setting, plan.world?.mood].filter(Boolean).join(" — "),
        style,
      });
      await ref.update({
        setting_bible: firestoreSafe(bible),
        updated_at: new Date().toISOString(),
      });
      return bible;
    } catch (err) {
      console.warn("setting bible unavailable (fail-open)", err);
      return null;
    }
  }

  private async updateGeneration(id: string, patch: Record<string, unknown>) {
    // A transient Firestore error on a progress write must never kill the run
    // (the images/PDF work would be lost for a cosmetic update). Stale docs are
    // caught by the generation reaper.
    try {
      await this.db
        .collection("generations")
        .doc(id)
        .update({ ...patch, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error(`[gen ${id}] updateGeneration failed (ignored)`, err);
    }
  }

  async getProgress(userId: string, generationId: string) {
    const snap = await this.db.collection("generations").doc(generationId).get();
    if (!snap.exists || snap.data()?.user_id !== userId) {
      throw new AppError("NOT_FOUND", "Génération introuvable", 404);
    }
    const generation = { id: snap.id, ...snap.data() } as Record<string, unknown> & {
      id: string;
      book_id: string;
    };
    const book = await this.books.getWithPages(userId, generation.book_id);
    return {
      id: generation.id,
      book_id: generation.book_id,
      status: generation.status,
      progress: generation.progress,
      current_step: generation.current_step,
      cover_image: book.cover_image,
      pages: book.pages.map((p) => ({
        id: p.id,
        page_number: p.page_number,
        title: p.title,
        story_text: p.story_text,
        illustration_url: p.illustration_url,
        generation_status: p.generation_status,
      })),
      error_message: generation.error_message,
      book,
    };
  }
}
