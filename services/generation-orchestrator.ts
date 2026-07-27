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
import { persistCoverWithOptionalTitle } from "@/lib/cover-persist";
import type { ImageQcStats, SettingBible, StoryPlan } from "@/services/ai/types";
import { getImageProvider, getTextProvider } from "@/services/ai";
import { MockTextProvider } from "@/services/ai/mock-provider";
import { pageStyleSeed } from "@/lib/book-style-seed";
import { heroGenderPromptBits } from "@/services/ai/prompts";
import { BookService } from "@/services/book-service";
import { CreditService } from "@/services/credit-service";
import { PDFService } from "@/services/pdf-service";
import { StorageService } from "@/services/storage-service";
import { isBlankOrTooFaint, isColored } from "@/lib/image-quality";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";
import { buildBookQualitySummary } from "@/lib/quality-score";
import {
  assertGenerationActive,
  GenerationCancelledError,
} from "@/lib/generation-lifecycle";
import { estimateBookCost, refundForFailedPages } from "@/config/credits";
import type { Book } from "@/types/database";
import type { Firestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

/** Parse an env integer, falling back to `fallback` on NaN/≤0 (misconfig-safe). */
function envInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Short parent-facing failure copy — never dump fal/provider JSON into the UI. */
function userFacingGenerationError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "Erreur inconnue");
  if (/cannot be 'DESIGN'|style_preset|feature_not_supported/i.test(msg)) {
    return "L'illustration a échoué (réglage technique). Vos crédits ont été remboursés — réessayez.";
  }
  if (/Exhausted balance|User is locked/i.test(msg)) {
    return "Le service d'illustration est temporairement indisponible. Vos crédits ont été remboursés.";
  }
  if (/timeout|délai dépassé/i.test(msg)) {
    return "Génération interrompue (délai dépassé). Vos crédits ont été remboursés — réessayez.";
  }
  if (
    /fal\.ai error|Failed to validate JSON|FatalError|json_validate_failed/i.test(msg) ||
    msg.length > 280
  ) {
    return "La création n'a pas abouti. Vos crédits ont été remboursés — réessayez.";
  }
  return msg;
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
const PARENT_PAGE_WAVE = envInt(process.env.PARENT_PAGE_GEN_CONCURRENCY, 5);
/** How many times to (re)generate the character model sheet if it comes back blank/poor. */
const SHEET_MAX_ATTEMPTS = envInt(process.env.SHEET_MAX_ATTEMPTS, 3);
/** Paid parent books always build a validated cast sheet before any page. */
const PARENT_SHEET_MAX_ATTEMPTS = envInt(process.env.PARENT_SHEET_MAX_ATTEMPTS, 2);
/** Studio heal passes (failed-page re-gen). Capped to avoid fal retry storms. */
const STUDIO_HEAL_PASSES = envInt(process.env.STUDIO_HEAL_PASSES, 2);
/** Parent promise: retry missing pages automatically before declaring no delivery. */
const PARENT_HEAL_PASSES = envInt(process.env.PARENT_HEAL_PASSES, 3);

/**
 * Parent quality budget. Parents never receive a knowingly incomplete cahier,
 * so every image gets QC and provider recovery before page-level heal passes.
 */
const PARENT_FAL_CAPS = {
  maxVisionRerolls: envInt(process.env.PARENT_VISION_QC_REROLLS, 2),
  maxQualityRerolls: envInt(process.env.PARENT_FAL_QUALITY_REROLLS, 2),
  maxProviderAttempts: envInt(process.env.PARENT_FAL_RETRY_ATTEMPTS, 2),
  skipRecovery: false,
} as const;

/**
 * Studio fal budget — env-overridable caps so heal/vision/quality cannot storm.
 * Defaults are leaner than the historical fal-provider globals (2/2/3).
 */
const STUDIO_FAL_CAPS = {
  maxVisionRerolls: envInt(process.env.STUDIO_VISION_QC_REROLLS, 1),
  maxQualityRerolls: envInt(process.env.STUDIO_FAL_QUALITY_REROLLS, 1),
  maxProviderAttempts: envInt(process.env.STUDIO_FAL_RETRY_ATTEMPTS, 2),
  skipRecovery: process.env.STUDIO_SKIP_RECOVERY === "true",
} as const;

function isParentBook(book: Book): boolean {
  return book.source === "parent_create";
}

function requiresPremiumVisualQuality(book: Book): boolean {
  return isParentBook(book) || book.type === "colorbook";
}

function lightResearchBrief(idea: string) {
  return {
    topic: idea.slice(0, 120),
    subjectType: "invented" as const,
    facts: [] as string[],
    childSafeAngle: "Aventure douce, joyeuse et rassurante pour enfants.",
    culturalNotes: [] as string[],
    westAfricanHooks: [] as string[],
    coloringBookScenes: [] as string[],
    characterVisualHints: [
      "Traits distinctifs stables (coiffure, accessoire, vêtement signature)",
      "Yeux amicaux avec pupilles visibles, sourire doux",
    ],
    accuracyNotes: "Parcours parent — brief local sans recherche web.",
    sourcesNote: "parent_create / no web",
  };
}

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
      await this.runStoryPhase(userId, bookId, generationId);
      await this.runSheetPhase(userId, bookId, generationId);
      const pageIds = await this.runCoverAndPagesSetupPhase(
        userId,
        bookId,
        generationId
      );
      await mapWithConcurrency(pageIds, PAGE_GEN_CONCURRENCY, (pageId) =>
        this.runOnePagePhase(userId, bookId, generationId, pageId)
      );
      for (let pass = 1; pass <= PARENT_HEAL_PASSES; pass++) {
        await this.runHealFailedPagesPhase(userId, bookId, generationId, pass);
      }
      await this.runFinalizePhase(
        userId,
        bookId,
        generationId,
        cost,
        isTrial,
        started
      );
    } catch (err) {
      if (err instanceof GenerationCancelledError) {
        // Reaper (or a concurrent fail) already refunded — do not spend more
        // and do not double-apply fail side effects beyond an idempotent refund.
        console.warn(`[gen ${generationId}] aborted: ${err.message}`);
        await this.failRun(userId, bookId, generationId, cost, started, err, isTrial);
        return;
      }
      await this.failRun(userId, bookId, generationId, cost, started, err, isTrial);
    }
  }

  /** Throw if reaper/cancel/refund already won the race. */
  private async ensureActive(
    userId: string,
    bookId: string,
    generationId: string
  ) {
    await assertGenerationActive(this.db, { userId, bookId, generationId });
  }

  /**
   * Research → story plan → prompts audit → replace characters → setting bible.
   * Persists title/bible/full story_plan (including pages) for later phases.
   */
  async runStoryPhase(
    userId: string,
    bookId: string,
    generationId: string
  ): Promise<void> {
    await this.ensureActive(userId, bookId, generationId);
    await this.updateGeneration(generationId, {
      status: "running",
      current_step: "researcher",
      progress: 8,
    });

    const book = await this.books.get(userId, bookId);
    const parentStory =
      (typeof book.parent_story === "string" && book.parent_story.trim()) || "";
    const childName =
      (typeof book.child_name === "string" && book.child_name.trim()) || undefined;
    const childGender =
      (typeof book.child_gender === "string" && book.child_gender.trim()) ||
      undefined;
    const parentMode = isParentBook(book);

    // Parent books: plan from the parent's story ONLY — never the bloated creative
    // brief (theme labels like "Afrique" primed market/travel substitutions).
    const genderLead =
      childName && childGender === "girl"
        ? `${childName} est une petite fille.`
        : childName && childGender === "boy"
          ? `${childName} est un petit garçon.`
          : childName
            ? `${childName} est un enfant.`
            : "";
    const narrativeAnchor = parentMode
      ? [genderLead, parentStory || book.original_idea || book.idea]
          .filter(Boolean)
          .join(" ")
          .trim()
      : book.original_idea || book.idea || "Une aventure magique pour enfants";
    const originalIdea = narrativeAnchor;
    const idea = parentMode
      ? narrativeAnchor
      : book.idea || originalIdea;
    const style = book.style || "cute";
    const pageCount = book.page_count || 12;
    const universeId = book.universe_id;
    const audience = book.audience || book.audience_age || undefined;

    const textProvider = getTextProvider();
    // Parent fast path: skip web research (biggest text latency). Studio keeps full research.
    const research = parentMode
      ? lightResearchBrief(originalIdea)
      : await textProvider.buildResearchBrief(originalIdea);

    await this.updateGeneration(generationId, {
      current_step: "author",
      progress: parentMode ? 15 : 18,
    });

    let plan: StoryPlan;
    try {
      plan = await textProvider.generateStoryPlan(
        idea,
        pageCount,
        style,
        research,
        audience,
        { originalIdea, childName, childGender, parentMode }
      );
    } catch (err) {
      // A text-provider outage must not block a paid parent book. The local
      // planner preserves the requested story, child name, page count and style
      // so image generation can continue without spending extra text credits.
      console.warn("text story plan unavailable; using local fallback", err);
      plan = await new MockTextProvider().generateStoryPlan(
        idea,
        pageCount,
        style,
        research,
        audience,
        { originalIdea, childName, childGender, parentMode }
      );
    }

    // Parent identity is the source of truth. Text models may invent a local
    // name/outfit (for example "Kofi" in a tunic) even when the parent supplied
    // Léo + a photo. Normalize the hero before any prompt or visual reference is
    // persisted so every later phase follows the parent's child, not the model.
    if (parentMode && childName && plan.characters.length > 0) {
      const generatedName = String(plan.characters[0]?.name || "").trim();
      const replaceHeroName = (value: string | undefined) => {
        if (!value || !generatedName || generatedName === childName) return value;
        return value.split(generatedName).join(childName);
      };
      plan.title = replaceHeroName(plan.title) || plan.title;
      plan.subtitle = replaceHeroName(plan.subtitle);
      plan.concept = replaceHeroName(plan.concept);
      plan.summary = replaceHeroName(plan.summary) || plan.summary;
      plan.moral = replaceHeroName(plan.moral);
      plan.pages = plan.pages.map((page) => ({
        ...page,
        title: replaceHeroName(page.title) || page.title,
        storyText: replaceHeroName(page.storyText) || page.storyText,
        action: replaceHeroName(page.action) || page.action,
        illustrationDescription:
          replaceHeroName(page.illustrationDescription) || page.illustrationDescription,
      }));
      const hero = plan.characters[0];
      const genderLock =
        childGender === "girl"
          ? "young girl child"
          : childGender === "boy"
            ? "young boy child"
            : "young child";
      plan.characters[0] = {
        ...hero,
        name: childName,
        description: `${childName}, the parent-provided hero child`,
        appearance:
          "same child as the provided reference photo; preserve face, skin tone, hair, age, gender and clothing",
        visualLock:
          `${genderLock} named ${childName}; exact same face, skin tone, hairstyle, age, child proportions and outfit as the provided child reference photo on every page`,
        outfit: "exact outfit from the provided child reference photo",
      };
    }

    // firestoreSafe: LLM output may contain nested arrays / undefined that
    // Firestore rejects (a single bad field kills the whole generation).
    await this.db.collection("prompts").add(
      firestoreSafe({
        user_id: userId,
        universe_id: universeId,
        book_id: bookId,
        original_prompt: originalIdea,
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
    const charsRef = this.db
      .collection("universes")
      .doc(universeId)
      .collection("characters");
    const existing = await charsRef.get();
    const batchDel = this.db.batch();
    existing.docs.forEach((d) => batchDel.delete(d.ref));
    await batchDel.commit();

    // One batched write for the whole cast (was one round-trip per character).
    const batchChars = this.db.batch();
    for (const c of plan.characters) {
      batchChars.set(
        charsRef.doc(),
        firestoreSafe({
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
        })
      );
    }
    await batchChars.commit();

    const fullCharacterBible = formatCharacterLock(plan.characters);

    // Setting bible (audit T3): lazy per-universe visual world contract —
    // generated once, stored on the universe, reused by every book. Fail-open:
    // a bible failure must not block the run.
    await this.ensureSettingBible(universeId, plan, style);

    // Persist full plan including pages so later durable phases can resume.
    await this.books.update(userId, bookId, {
      title: plan.title,
      subtitle: plan.subtitle ?? null,
      character_bible: fullCharacterBible,
      story_plan: firestoreSafe({
        concept: plan.concept ?? null,
        summary: plan.summary,
        moral: plan.moral ?? null,
        audience_age: plan.audienceAge,
        world: plan.world,
        characters: plan.characters,
        pages: plan.pages,
      }),
    });
  }

  /**
   * Wave size for durable page steps (parent books run wider waves).
   */
  async resolvePageWaveSize(userId: string, bookId: string): Promise<number> {
    const book = await this.books.get(userId, bookId);
    if (isParentBook(book)) {
      return Math.max(1, Math.min(6, PARENT_PAGE_WAVE));
    }
    return Math.max(1, Math.min(6, PAGE_GEN_CONCURRENCY));
  }

  /**
   * Re-run failed pages (and optionally lineup-flagged pages on pass 2 for parent).
   */
  async runHealFailedPagesPhase(
    userId: string,
    bookId: string,
    generationId: string,
    pass: number
  ): Promise<void> {
    await this.ensureActive(userId, bookId, generationId);
    const book = await this.books.get(userId, bookId);
    const maxPasses = requiresPremiumVisualQuality(book)
      ? PARENT_HEAL_PASSES
      : STUDIO_HEAL_PASSES;
    if (pass > maxPasses) {
      console.log(
        `[generation] skip heal pass=${pass} gen=${generationId} (cap=${maxPasses})`
      );
      return;
    }
    const pagesCol = this.db.collection("books").doc(bookId).collection("pages");
    const snap = await pagesCol.orderBy("page_number", "asc").get();
    const toRetry: string[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      const status = data.generation_status as string;
      if (status === "failed" || status === "pending") {
        toRetry.push(d.id);
      }
    }
    if (!toRetry.length) return;

    await this.updateGeneration(generationId, {
      current_step: "illustrator",
      progress: Math.min(88, 70 + pass * 5),
      error_message: null,
    });

    const wave = PAGE_GEN_CONCURRENCY;
    await mapWithConcurrency(toRetry, wave, (pageId) =>
      this.runOnePagePhase(userId, bookId, generationId, pageId)
    );
  }

  /**
   * Model sheet attempts + sheet crops + character image_reference updates.
   * Reconstructs plan from book.story_plan written by the story phase.
   */
  async runSheetPhase(
    userId: string,
    bookId: string,
    generationId: string
  ): Promise<void> {
    await this.ensureActive(userId, bookId, generationId);
    const book = await this.books.get(userId, bookId);
    const plan = this.loadStoryPlan(book);
    const style = book.style || "cute";
    const universeId = book.universe_id;
    const fullCharacterBible =
      book.character_bible || formatCharacterLock(plan.characters);
    const worldSetting = [plan.world?.setting, plan.world?.mood]
      .filter(Boolean)
      .join(" — ");
    const photoUrl =
      (typeof book.child_photo_url === "string" && book.child_photo_url.trim()) ||
      undefined;

    const imageProvider = getImageProvider();
    const charsRef = this.db
      .collection("universes")
      .doc(universeId)
      .collection("characters");

    // Build one colored cast sheet for EVERY paid parent book, with or without a
    // child photo. It is the visual source of truth for faces, outfits and species.
    // Pages are not allowed to invent the cast independently anymore.
    let characterSheetUrl: string | null = null;
    const sheetCast = expectedCastFor(plan.characters);
    const strictVisual = requiresPremiumVisualQuality(book);
    const sheetAttempts = strictVisual ? PARENT_SHEET_MAX_ATTEMPTS : SHEET_MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= sheetAttempts; attempt++) {
      try {
        const sheetStats: ImageQcStats = {};
        const sheet = await imageProvider.generateImage({
          prompt: photoUrl
            ? "friendly cartoon child character portrait matching the reference photo likeness"
            : "character model sheet",
          style,
          characterBible: fullCharacterBible,
          worldSetting,
          isCharacterSheet: true,
          referenceImageUrl: photoUrl,
          identityFromPhoto: Boolean(photoUrl),
          expectedCast: sheetCast,
          qcStats: sheetStats,
          strictQuality: strictVisual,
          ...(strictVisual
            ? {
                ...PARENT_FAL_CAPS,
                seed: pageStyleSeed(bookId, 900 + attempt),
                consistencyMode: true,
              }
            : STUDIO_FAL_CAPS),
        });
        await this.setQcImage(generationId, "model_sheet", sheetStats);
        if (await this.isImplausibleHero(sheet.url)) {
          console.warn(
            `hero portrait attempt ${attempt}/${sheetAttempts} implausible (blank or not colored); retrying with a fresh seed`
          );
          continue;
        }
        const persisted = await this.storage.persistImageFromUrl(
          sheet.url,
          `universes/${universeId}/books/${bookId}/generations/${generationId}/model_sheet.png`
        );
        characterSheetUrl = persisted.url;
        console.log(
          `hero portrait accepted on attempt ${attempt}/${sheetAttempts}`
        );
        break;
      } catch (sheetErr) {
        console.warn(
          `hero portrait attempt ${attempt}/${sheetAttempts} failed`,
          sheetErr
        );
        // Continue through the bounded sheet attempts; no page may start without
        // a usable visual identity reference for the paid parent flow.
      }
    }

    if (strictVisual && !characterSheetUrl) {
      // The collective cast sheet is a helpful visual overview, but it is not the
      // identity source used by pages. Do not cancel a paid parent book here:
      // the immutable per-character portraits below are generated independently
      // and remain protected by the strict visual-quality gate.
      console.warn(
        "collective cast sheet unavailable; continuing with strict individual references"
      );
    }

    // Generate and validate one immutable portrait per character. Composite-sheet
    // slicing is forbidden: it silently swaps identities when spacing is uneven.
    const individualReferences: Record<string, { url: string; path: string }> = {};
    for (const [characterIndex, character] of plan.characters.entries()) {
      for (let attempt = 1; attempt <= sheetAttempts; attempt++) {
        try {
          const portraitStats: ImageQcStats = {};
          const photoReference =
            character.id === "char_1" || characterIndex === 0 ? photoUrl : undefined;
          const photoIdentityLock = photoReference
            ? `ONE young child hero named ${String(book.child_name || character.name)}. The reference photo is the absolute source of truth: preserve the same face, skin tone, hair, age, gender, body proportions and exact outfit; do not replace or redesign the clothing.`
            : null;
          const portrait = await imageProvider.generateImage({
            prompt: photoReference
              ? "single premium cartoon portrait of the exact child in the reference photo; preserve the child's name and exact outfit"
              : "single premium cartoon character portrait",
            style,
            characterBible: photoIdentityLock || formatCharacterLock([character]),
            worldSetting,
            isCharacterSheet: true,
            referenceImageUrl: photoReference,
            identityFromPhoto: Boolean(photoReference),
            expectedCast: photoReference
              ? [{
                  name: String(book.child_name || character.name),
                  kind: "human",
                  visualLock: "same child identity, age and gender as the provided reference photo; outfit comes from the photo",
                }]
              : expectedCastFor([character]),
            qcStats: portraitStats,
            strictQuality: strictVisual,
            ...(strictVisual
              ? {
                  ...PARENT_FAL_CAPS,
                  seed: pageStyleSeed(bookId, 1000 + characterIndex * 10 + attempt),
                  consistencyMode: true,
                }
              : STUDIO_FAL_CAPS),
          });
          await this.setQcImage(
            generationId,
            `character_${character.id}`,
            portraitStats
          );
          if (await this.isImplausibleHero(portrait.url)) continue;
          const persisted = await this.storage.persistImageFromUrl(
            portrait.url,
            `universes/${universeId}/books/${bookId}/generations/${generationId}/characters/${character.id}.png`
          );
          if (strictVisual && !persisted.path) {
            throw new Error(`Character ${character.name} portrait was not persisted`);
          }
          individualReferences[character.id] = {
            url: persisted.url,
            path: persisted.path || "",
          };
          break;
        } catch (portraitError) {
          console.warn(
            `character portrait ${character.name} attempt ${attempt}/${sheetAttempts} failed`,
            portraitError
          );
        }
      }
      if (strictVisual && !individualReferences[character.id]) {
        throw new Error(
          `Premium character reference failed for ${character.name}`
        );
      }
    }

    const effectiveReferences =
      Object.keys(individualReferences).length > 0
        ? individualReferences
        : characterSheetUrl
          ? await buildSheetCrops(
              characterSheetUrl,
              plan.characters,
              `${universeId}/books/${bookId}/generations/${generationId}`,
              this.storage
            )
          : {};
    if (
      strictVisual &&
      plan.characters.some((character) => !effectiveReferences[character.id]?.url)
    ) {
      throw new Error("Premium book is missing an individual character reference");
    }
    await this.db.collection("universes").doc(universeId).update({
      model_sheet_crops: effectiveReferences,
      updated_at: new Date().toISOString(),
    });
    const afterChars = await charsRef.get();
    const sheetBatch = this.db.batch();
    afterChars.docs.forEach((doc) => {
      const data = doc.data();
      const character = plan.characters.find(
        (candidate) =>
          candidate.id === doc.id ||
          candidate.id === data.id ||
          candidate.name === data.name
      );
      const reference = character
        ? effectiveReferences[character.id]?.url
        : characterSheetUrl;
      if (reference) sheetBatch.update(doc.ref, { image_reference: reference });
    });
    await sheetBatch.commit();

    await this.books.update(userId, bookId, {
      character_sheet_url: characterSheetUrl,
    });
  }

  /**
   * Cover generation only. Idempotent when cover_image already persisted for this book.
   */
  async runCoverPhase(
    userId: string,
    bookId: string,
    generationId: string
  ): Promise<void> {
    await this.ensureActive(userId, bookId, generationId);
    const book = await this.books.get(userId, bookId);
    await this.updateGeneration(generationId, {
      current_step: "illustrator",
      progress: isParentBook(book) ? 40 : 45,
      current_substep: "cover",
    });
    await this.touchHeartbeat(generationId);

    if (
      typeof book.cover_image === "string" &&
      book.cover_image &&
      typeof book.cover_image_path === "string" &&
      book.cover_image_path
    ) {
      console.log(`[gen ${generationId}] cover already persisted — skipping`);
      return;
    }

    const plan = this.loadStoryPlan(book);
    const style = book.style || "cute";
    const universeId = book.universe_id;
    const characterSheetUrl = book.character_sheet_url || null;
    const parentMode = isParentBook(book);
    const worldSetting = [plan.world?.setting, plan.world?.mood]
      .filter(Boolean)
      .join(" — ");

    const universeSnap = await this.db
      .collection("universes")
      .doc(universeId)
      .get();
    const settingBible = (universeSnap.data()?.setting_bible as
      | SettingBible
      | undefined) ?? null;
    const worldNegative = buildWorldNegative(settingBible?.forbiddenElements);

    const imageProvider = getImageProvider();

    const coverHero = parentMode
      ? (() => {
          const hero =
            plan.characters.find((c) => c.id === "char_1") || plan.characters[0];
          return hero ? [hero] : coverCharacters(plan).slice(0, 1);
        })()
      : coverCharacters(plan);
    const coverAction =
      plan.pages.find((p) => p.action && p.comicBeat === "action")?.action ||
      plan.pages.find((p) => p.action)?.action ||
      plan.summary;
    const coverStats: ImageQcStats = {};
    const coverReferenceMap =
      (universeSnap.data()?.model_sheet_crops as Record<
        string,
        { url: string; path: string }
      >) || {};
    const coverReferenceImageUrls = coverHero
      .map((character) => coverReferenceMap[character.id]?.url)
      .filter((url): url is string => Boolean(url));
    if (
      requiresPremiumVisualQuality(book) &&
      coverReferenceImageUrls.length !== coverHero.length
    ) {
      throw new Error("Premium cover is missing an individual character reference");
    }
    // Prefer individual identity sources + server title overlay.
    const useOverlayTitle = coverReferenceImageUrls.length > 0;
    const coverGender =
      (typeof book.child_gender === "string" && book.child_gender.trim()) ||
      undefined;
    const cover = await imageProvider.generateImage({
      prompt: `${plan.title}. ${plan.summary}`,
      style,
      characterBible: formatCharacterLock(coverHero),
      worldSetting,
      isCover: true,
      referenceImageUrl:
        coverReferenceImageUrls[0] || characterSheetUrl || undefined,
      referenceImageUrls:
        coverReferenceImageUrls.length > 0 ? coverReferenceImageUrls : undefined,
      forceTextOnly:
        coverReferenceImageUrls.length === 0 && !characterSheetUrl,
      coverTitle: useOverlayTitle ? undefined : plan.title,
      action: coverAction,
      refScene: `${coverAction}. Draw ONLY the one hero child in action — no crowd of extra children.`,
      settingElements: settingElementsForScene(
        settingBible?.elements,
        `${coverAction} ${plan.summary}`,
        4
      ),
      worldNegative,
      expectedCast: expectedCastFor(coverHero),
      qcStats: coverStats,
      strictQuality: requiresPremiumVisualQuality(book),
      ...(parentMode
        ? {
            ...PARENT_FAL_CAPS,
            seed: pageStyleSeed(bookId, 0),
            stylePreset: "COLORING_BOOK_I",
            heroGender: coverGender,
            consistencyMode: true,
          }
        : STUDIO_FAL_CAPS),
    });
    await this.setQcImage(generationId, "cover", coverStats);
    await this.ensureActive(userId, bookId, generationId);
    await this.touchHeartbeat(generationId);
    const persistedCover = await this.persistCover(
      cover.url,
      bookId,
      generationId,
      useOverlayTitle ? plan.title : null,
      {
        requireTitledOverlay:
          requiresPremiumVisualQuality(book) && useOverlayTitle,
      }
    );
    if (requiresPremiumVisualQuality(book) && !persistedCover.path) {
      throw new Error("Premium cover was not persisted");
    }
    await this.ensureActive(userId, bookId, generationId);
    await this.books.update(userId, bookId, {
      cover_image: persistedCover.url,
      cover_image_path: persistedCover.path,
    });
    await this.db.collection("universes").doc(universeId).update({
      cover_image: persistedCover.url,
      updated_at: new Date().toISOString(),
    });
    await this.updateGeneration(generationId, {
      current_step: "illustrator",
      progress: isParentBook(book) ? 48 : 50,
      current_substep: "cover_done",
    });
  }

  /**
   * Create page documents after cover. Returns page IDs in page_number order.
   * Reuses existing pending/generating/completed pages when already set up.
   */
  async runPagesSetupPhase(
    userId: string,
    bookId: string,
    generationId: string
  ): Promise<string[]> {
    await this.ensureActive(userId, bookId, generationId);
    const book = await this.books.get(userId, bookId);
    const parentMode = isParentBook(book);
    await this.updateGeneration(generationId, {
      current_step: "illustrator",
      progress: parentMode ? 50 : 55,
      current_substep: "pages_setup",
    });

    const plan = this.loadStoryPlan(book);
    const pagesCol = this.db.collection("books").doc(bookId).collection("pages");
    const existing = await pagesCol.get();
    if (existing.size > 0 && existing.size === plan.pages.length) {
      const ordered = existing.docs
        .map((d) => ({
          id: d.id,
          page_number: Number(d.data().page_number || 0),
        }))
        .sort((a, b) => a.page_number - b.page_number);
      console.log(
        `[gen ${generationId}] pages already set up (${ordered.length}) — reusing`
      );
      return ordered.map((p) => p.id);
    }

    const oldPages = existing;
    const batchPages = this.db.batch();
    oldPages.docs.forEach((d) => batchPages.delete(d.ref));
    await batchPages.commit();

    const pageInserts = this.db.batch();
    const pageIdsByNumber: Array<{ page_number: number; id: string }> = [];
    for (const p of plan.pages) {
      const pageId = randomUUID();
      const pageLock = formatPageCharacterLock(plan, p);
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
      pageIdsByNumber.push({ page_number: p.pageNumber, id: pageId });
    }
    await pageInserts.commit();

    await this.updateGeneration(generationId, {
      current_step: "illustrator",
      progress: parentMode ? 52 : 55,
      current_substep: "pages_ready",
    });

    return pageIdsByNumber
      .sort((a, b) => a.page_number - b.page_number)
      .map((p) => p.id);
  }

  /**
   * Cover generation + page document setup. Returns page IDs in page_number order.
   * Kept for the legacy monolith `run()` path.
   */
  async runCoverAndPagesSetupPhase(
    userId: string,
    bookId: string,
    generationId: string
  ): Promise<string[]> {
    await this.runCoverPhase(userId, bookId, generationId);
    return this.runPagesSetupPhase(userId, bookId, generationId);
  }

  /**
   * Generate illustration for one page. Progress = 55 + completed/total×35 (cap 90).
   */
  async runOnePagePhase(
    userId: string,
    bookId: string,
    generationId: string,
    pageId: string
  ): Promise<"ok" | "fail"> {
    await this.ensureActive(userId, bookId, generationId);
    // Heartbeat before long fal wait so the reaper won't kill a live page gen.
    await this.touchHeartbeat(generationId);
    const book = await this.books.get(userId, bookId);
    // Skip already-completed pages (resume after worker restart / free retry).
    {
      const existingPage = await this.db
        .collection("books")
        .doc(bookId)
        .collection("pages")
        .doc(pageId)
        .get();
      const data = existingPage.data();
      if (
        existingPage.exists &&
        data?.generation_status === "completed" &&
        typeof data.illustration_url === "string" &&
        data.illustration_url
      ) {
        return "ok";
      }
    }
    const plan = this.loadStoryPlan(book);
    const style = book.style || "cute";
    const universeId = book.universe_id;
    const fullCharacterBible =
      book.character_bible || formatCharacterLock(plan.characters);
    const worldSetting = [plan.world?.setting, plan.world?.mood]
      .filter(Boolean)
      .join(" — ");

    const universeSnap = await this.db
      .collection("universes")
      .doc(universeId)
      .get();
    const settingBible = (universeSnap.data()?.setting_bible as
      | SettingBible
      | undefined) ?? null;
    const worldNegative = buildWorldNegative(settingBible?.forbiddenElements);
    const sheetCrops =
      (universeSnap.data()?.model_sheet_crops as Record<
        string,
        { url: string; path: string }
      >) || {};

    const pagesCol = this.db.collection("books").doc(bookId).collection("pages");
    const pageSnap = await pagesCol.doc(pageId).get();
    if (!pageSnap.exists) {
      throw new Error(`page ${pageId} not found`);
    }
    const page = pageSnap.data()!;
    const pageNumber = page.page_number as number;
    const characterIds = (page.character_ids as string[]) || [];
    const scene = (page.illustration_prompt as string) || "";
    const storyText = (page.story_text as string) || "";
    const planPage = plan.pages.find((p) => p.pageNumber === pageNumber);

    const imageProvider = getImageProvider();

    await pagesCol.doc(pageId).update({ generation_status: "generating" });
    try {
      const parentMode = isParentBook(book);
      const childGender =
        (typeof book.child_gender === "string" && book.child_gender.trim()) ||
        undefined;
      const genderBits = heroGenderPromptBits(childGender);
      const scenePrompt = [
        scene || storyText || plan.summary,
        page.shot_type ? `Shot: ${page.shot_type}.` : "",
        page.comic_beat ? `Beat: ${page.comic_beat}.` : "",
        parentMode ? genderBits.positive : "",
        "PREMIUM full-scene coloring page, not a portrait: foreground, midground and background with 6–10 LARGE CLOSED scene-specific shapes to color. Hero occupies at most 35% of the page. Clean organic children's-book ink with gently varied line weight, natural modest eyes and coherent anatomy. No empty sky or ground, no generic clipart, no giant glossy emoji eyes. Max 2 characters on this page. EXACTLY the named cast with correct species — no clones or background children.",
      ]
        .filter(Boolean)
        .join(" ");

      const pageStats: ImageQcStats = {};
      const pageCharacters = planPage
        ? charactersForPage(plan, planPage)
        : plan.characters.filter((character) =>
            characterIds.includes(character.id)
          );
      const expectedCast = expectedCastFor(pageCharacters);
      const referenceImageUrls = pageCharacters
        .map((character) => sheetCrops[character.id]?.url)
        .filter((url): url is string => Boolean(url));
      if (
        requiresPremiumVisualQuality(book) &&
        referenceImageUrls.length !== pageCharacters.length
      ) {
        throw new Error("Premium page is missing an ordered character reference");
      }
      const pageReference =
        referenceImageUrls[0] || book.character_sheet_url || undefined;
      const settingElements = settingElementsForScene(
        settingBible?.elements,
        `${scene} ${storyText}`
      );
      // Prefer wide shots for parent pages so the model fills scenery.
      const shotType = parentMode
        ? page.shot_type === "close_safe"
          ? "wide"
          : page.shot_type || "wide"
        : (page.shot_type as string) || undefined;
      const pageNeg = [
        (page.negative_prompt as string) || "",
        parentMode ? genderBits.negative : "",
      ]
        .filter(Boolean)
        .join(", ");
      const image = await imageProvider.generateImage({
        prompt: scenePrompt,
        style,
        characterBible:
          (page.character_lock as string) || fullCharacterBible,
        negativePrompt: pageNeg || undefined,
        worldSetting,
        isColoringPage: true,
        referenceImageUrl: pageReference,
        referenceImageUrls:
          referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
        forceTextOnly: !pageReference,
        refScene: (page.ref_scene as string) || undefined,
        shotType,
        comicBeat: (page.comic_beat as string) || undefined,
        action: (page.action as string) || undefined,
        settingElements,
        worldNegative,
        expectedCast,
        qcStats: pageStats,
        strictQuality: requiresPremiumVisualQuality(book),
        ...(requiresPremiumVisualQuality(book)
          ? {
              ...PARENT_FAL_CAPS,
              seed: pageStyleSeed(bookId, pageNumber),
              stylePreset: "COLORING_BOOK_I",
              heroGender: childGender,
              consistencyMode: true,
            }
          : STUDIO_FAL_CAPS),
      });

      if (!image?.url) {
        throw new Error("Image provider returned empty URL");
      }
      await this.ensureActive(userId, bookId, generationId);

      // Persist to Storage (audit T7): never leave an ephemeral fal URL
      // as the page's source of truth.
      const persisted = await this.storage.persistImageFromUrl(
        image.url,
        `books/${bookId}/generations/${generationId}/pages/${pageNumber}-${pageId}.png`
      );
      if (requiresPremiumVisualQuality(book) && !persisted.path) {
        throw new Error("Premium page was not persisted");
      }
      await this.ensureActive(userId, bookId, generationId);

      await pagesCol.doc(pageId).update({
        illustration_url: persisted.url,
        illustration_path: persisted.path,
        generation_status: "completed",
        qc_stats: pageStats,
        updated_at: new Date().toISOString(),
      });

      await this.updatePageProgress(generationId, bookId);
      return "ok";
    } catch (err) {
      if (err instanceof GenerationCancelledError) {
        console.warn(`page ${pageNumber} discarded after generation cancellation`);
        return "fail";
      }
      console.error(`page ${pageNumber} generation failed`, err);
      await pagesCol.doc(pageId).update({
        illustration_url: null,
        generation_status: "failed",
        updated_at: new Date().toISOString(),
      });
      await this.updatePageProgress(generationId, bookId);
      return "fail";
    }
  }

  /**
   * PDF, refunds, status completed/partial/failed-if-zero-pages, trial consume.
   */
  async runFinalizePhase(
    userId: string,
    bookId: string,
    generationId: string,
    cost: number,
    isTrial: boolean,
    started: number
  ): Promise<void> {
    await this.ensureActive(userId, bookId, generationId);
    await this.updateGeneration(generationId, {
      current_step: "illustrator",
      progress: 90,
    });

    const book = await this.books.get(userId, bookId);
    const pagesCol = this.db.collection("books").doc(bookId).collection("pages");
    const pagesSnap = await pagesCol.get();
    const pageDocs: Array<Record<string, unknown> & { id: string }> =
      pagesSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
      }));
    const parentMode = isParentBook(book);
    const strictDelivery = requiresPremiumVisualQuality(book);
    const completedCount = pageDocs.filter(
      (p) =>
        p.generation_status === "completed" &&
        (!strictDelivery ||
          (typeof p.illustration_url === "string" &&
            Boolean(p.illustration_url) &&
            typeof p.illustration_path === "string" &&
            Boolean(p.illustration_path)))
    ).length;
    const failedCount = pageDocs.filter(
      (p) => p.generation_status === "failed"
    ).length;

    // Never mark a book "completed" with blank pages
    if (completedCount === 0) {
      await this.books.update(userId, bookId, {
        status: strictDelivery ? "draft" : "failed",
        active_generation_id: null,
        free_retry_available: !isTrial && cost > 0,
      });
      await this.credits.refund(
        userId,
        cost,
        "Remboursement — génération échouée (aucune page)",
        `gen:${generationId}:refund:full`
      );
      if (isTrial) {
        await this.releaseFreeTrialSlot(userId, generationId);
      }
      await this.updateGeneration(generationId, {
        status: "failed",
        cancelled: true,
        current_step: "illustrator",
        progress: 90,
        credits_used: 0,
        error_message:
          "La création n'a pas abouti. Réessayez depuis « Créer pour mon enfant ».",
        duration_ms: Date.now() - started,
      });
      return;
    }

    const plannedPages = book.page_count || pageDocs.length;
    // Product promise: no paid coloring book ships incomplete or below QC.
    if (strictDelivery && completedCount < plannedPages) {
      await this.books.update(userId, bookId, {
        status: "draft",
        active_generation_id: null,
        free_retry_available: !isTrial && cost > 0,
      });
      await this.credits.refund(
        userId,
        cost,
        "Remboursement — cahier incomplet",
        `gen:${generationId}:refund:full`
      );
      if (isTrial) {
        await this.releaseFreeTrialSlot(userId, generationId);
      }
      await this.updateGeneration(generationId, {
        status: "failed",
        cancelled: true,
        current_step: "illustrator",
        progress: 90,
        credits_used: 0,
        error_message:
          "Le cahier n'est pas complet. Vos crédits ont été remboursés — réessayez, on vise toutes les pages.",
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
      strict: strictDelivery,
      pages: full.pages.map((p) => ({
        pageNumber: p.page_number,
        title: p.title,
        storyText: p.story_text,
        illustrationUrl: p.illustration_url,
      })),
    });

    let pdfUrl: string | null = null;
    let pdfPath: string | null = null;
    try {
      pdfPath = `exports/${userId}/${bookId}.pdf`;
      pdfUrl = await this.storage.uploadBytes(
        pdfPath,
        pdfBytes,
        "application/pdf",
        "export"
      );
    } catch (uploadErr) {
      pdfPath = null;
      if (strictDelivery) {
        throw new Error(
          `Strict PDF storage upload failed: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`
        );
      }
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

    if (strictDelivery && (!pdfUrl || !pdfPath)) {
      throw new Error("Strict delivery requires a persisted PDF artifact");
    }

    // QC telemetry: studio only (parent path never writes/displays a quality score).
    const qcStatsAll = await this.collectQcStats(generationId, pageDocs);
    const qcSummary = summarizeQcStats(qcStatsAll);
    const pageQc = pageDocs
      .filter((p) => typeof p.page_number === "number")
      .sort((a, b) => Number(a.page_number) - Number(b.page_number))
      .map((p) => (p.qc_stats as ImageQcStats | undefined) || null);
    const quality = parentMode
      ? null
      : buildBookQualitySummary({
          pagesTotal: Math.max(plannedPages, pageDocs.length),
          pagesOk: completedCount,
          pageQc,
          pixelRerolls: qcSummary.pixel_rerolls,
          visionRerolls: qcSummary.vision_rerolls,
        });

    // Strict coloring books reached this point only when every promised page passed.
    const bookStatus =
      failedCount > 0 ? (strictDelivery ? "failed" : "partial") : "completed";
    const genStatus =
      failedCount > 0 ? (strictDelivery ? "failed" : "partial") : "completed";

    await this.books.update(userId, bookId, {
      status: bookStatus === "failed" ? "failed" : bookStatus,
      pdf_url: bookStatus === "failed" ? null : pdfUrl,
      pdf_path: bookStatus === "failed" ? null : pdfPath,
      active_generation_id: null,
      ...(parentMode
        ? { quality_summary: null }
        : quality
          ? { quality_summary: quality }
          : {}),
    });

    const notDelivered = Math.max(0, plannedPages - completedCount);
    const refund = Math.min(
      refundForFailedPages(plannedPages, completedCount, book.type),
      cost
    );
    if (refund > 0) {
      // Partial key must not block a later full refund (or vice versa).
      const refundKind =
        refund >= cost || completedCount === 0 ? "full" : "partial";
      await this.credits.refund(
        userId,
        refund,
        `Remboursement ${notDelivered} page(s) non livrée(s) — ${String(full.title)}`,
        `gen:${generationId}:refund:${refundKind}`
      );
    }
    const creditsUsed = Math.max(0, cost - refund);
    if (creditsUsed > 0) {
      await this.credits.capture(
        userId,
        creditsUsed,
        `Capture définitive — cahier livré ${String(full.title)}`,
        `gen:${generationId}:capture`
      );
    }

    console.log(
      `[gen ${generationId}] QC re-rolls — pixel: ${qcSummary.pixel_rerolls}, vision: ${qcSummary.vision_rerolls}, images: ${qcSummary.images}` +
        (quality
          ? `; studio quality score ${quality.score} (lineup ${quality.lineup_pct}%)`
          : " [parent: no quality score]")
    );

    await this.updateGeneration(generationId, {
      status: genStatus,
      current_step: "editor",
      progress: 100,
      qc_stats: quality ? { ...qcSummary, quality } : qcSummary,
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
          ? strictDelivery
            ? "Le cahier n'est pas complet ou n'a pas passé le contrôle qualité. Vos crédits sont protégés."
            : `${failedCount} page(s) sans illustration — utilisez « Régénérer cette page ».`
          : null,
    });

    if (isTrial) {
      if (completedCount > 0 && bookStatus === "completed") {
        await this.consumeFreeTrial(userId, generationId);
      } else {
        await this.releaseFreeTrialSlot(userId, generationId);
      }
    }
  }

  /** Current catch-block logic for a hard run failure. */
  async failRun(
    userId: string,
    bookId: string,
    generationId: string,
    cost: number,
    started: number,
    err: unknown,
    isTrial = false
  ): Promise<void> {
    console.error("generation failed", err);
    // Compensation must succeed before this generation becomes terminal.
    // Otherwise leave it queued+cancelled with an ancient heartbeat: polling
    // and cron will retry the same idempotent refund through the reaper.
    let compensated = isTrial || cost <= 0;
    try {
      if (!isTrial && cost > 0) {
        await this.credits.refund(
          userId,
          cost,
          "Remboursement — génération interrompue",
          `gen:${generationId}:refund:full`
        );
        compensated = true;
      }
      if (isTrial) {
        await this.releaseFreeTrialSlot(userId, generationId);
      }
    } catch (refundErr) {
      console.error("refund after generation failure failed", refundErr);
    }

    if (!compensated) {
      try {
        await this.db.collection("generations").doc(generationId).set(
          {
            status: "queued",
            cancelled: true,
            refund_pending: true,
            error_message:
              "La création s’est interrompue. Le remboursement automatique est en cours.",
            updated_at: new Date().toISOString(),
            heartbeat_at: "1970-01-01T00:00:00.000Z",
          },
          { merge: true }
        );
      } catch (pendingErr) {
        console.error("could not persist pending refund state", pendingErr);
      }
      return;
    }

    // Only clear the book lock after compensation is confirmed, and only if it
    // still points at this generation.
    try {
      const bookRef = this.db.collection("books").doc(bookId);
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(bookRef);
        if (!snap.exists) return;
        const active = snap.data()?.active_generation_id;
        if (active != null && active !== generationId) return;
        tx.update(bookRef, {
          status:
            snap.data()?.source === "parent_create" ||
            snap.data()?.type === "colorbook"
              ? "draft"
              : "failed",
          active_generation_id: null,
          // One controlled free restart after a compensated terminal failure.
          free_retry_available: !isTrial && cost > 0 && compensated,
          updated_at: new Date().toISOString(),
        });
      });
    } catch (lockErr) {
      console.error("failRun book lock clear failed", lockErr);
    }

    await this.updateGeneration(generationId, {
      status: "failed",
      cancelled: true,
      refund_pending: false,
      credits_used: 0,
      error_message: userFacingGenerationError(err),
      duration_ms: Date.now() - started,
    });
  }

  /**
   * Rebuild a StoryPlan from the book document's story_plan field
   * (must include pages — written by runStoryPhase).
   */
  private loadStoryPlan(book: Book): StoryPlan {
    const sp = book.story_plan;
    if (!sp || typeof sp.summary !== "string" || !Array.isArray(sp.pages)) {
      throw new Error(
        "story_plan missing or incomplete (pages required) — run story phase first"
      );
    }
    return {
      title: book.title || "",
      subtitle: book.subtitle || undefined,
      concept: (sp.concept as string) ?? undefined,
      summary: sp.summary,
      moral: (sp.moral as string) ?? undefined,
      audienceAge: (sp.audience_age as string) || "",
      world: sp.world as StoryPlan["world"],
      characters: (sp.characters as StoryPlan["characters"]) || [],
      pages: sp.pages as StoryPlan["pages"],
    };
  }

  /** Progress during page gen: 55 + completed/total×35, capped at 90. */
  private async updatePageProgress(generationId: string, bookId: string) {
    const pagesCol = this.db.collection("books").doc(bookId).collection("pages");
    const snap = await pagesCol.get();
    const totalPages = snap.size || 1;
    const completedPages = snap.docs.filter(
      (d) => d.data().generation_status === "completed"
    ).length;
    const progress = Math.min(
      90,
      55 + Math.round((completedPages / totalPages) * 35)
    );
    await this.updateGeneration(generationId, {
      current_step: "illustrator",
      progress,
    });
  }

  /** Merge one image's QC stats onto the generation doc (sheet/cover). */
  private async setQcImage(
    generationId: string,
    key: string,
    stats: ImageQcStats
  ) {
    try {
      const ref = this.db.collection("generations").doc(generationId);
      const snap = await ref.get();
      const existing =
        (snap.data()?.qc_images as Record<string, ImageQcStats>) || {};
      await this.updateGeneration(generationId, {
        qc_images: { ...existing, [key]: stats },
      });
    } catch (err) {
      console.error(`[gen ${generationId}] setQcImage failed (ignored)`, err);
    }
  }

  /** Aggregate sheet/cover QC from generation + per-page qc_stats. */
  private async collectQcStats(
    generationId: string,
    pageDocs: Array<Record<string, unknown>>
  ): Promise<Record<string, ImageQcStats>> {
    const all: Record<string, ImageQcStats> = {};
    try {
      const snap = await this.db.collection("generations").doc(generationId).get();
      const images =
        (snap.data()?.qc_images as Record<string, ImageQcStats>) || {};
      Object.assign(all, images);
    } catch (err) {
      console.warn("collectQcStats: could not load generation qc_images", err);
    }
    for (const p of pageDocs) {
      if (p.qc_stats && typeof p.page_number === "number") {
        all[`page_${p.page_number}`] = p.qc_stats as ImageQcStats;
      }
    }
    return all;
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
        const inProgress = (user.data()?.free_trials_in_progress as number) ?? 0;
        tx.update(genRef, { trial_counted: true });
        tx.update(userRef, {
          free_trials_used: used + 1,
          free_trials_in_progress: Math.max(0, inProgress - 1),
          updated_at: new Date().toISOString(),
        });
      });
    } catch (err) {
      console.error("consumeFreeTrial failed", err);
    }
  }

  /**
   * Releases a reserved free-trial slot when a trial run fails with no
   * delivery. Idempotent via trial_counted / metadata.trial_released.
   */
  private async releaseFreeTrialSlot(userId: string, generationId: string) {
    const genRef = this.db.collection("generations").doc(generationId);
    const userRef = this.db.collection("users").doc(userId);
    try {
      await this.db.runTransaction(async (tx) => {
        const gen = await tx.get(genRef);
        if (!gen.exists) return;
        const data = gen.data()!;
        if (data.trial_counted === true) return;
        const meta = (data.metadata as Record<string, unknown> | null) ?? {};
        if (meta.trial_released === true || meta.trial_reserved !== true) return;
        const user = await tx.get(userRef);
        const inProgress = (user.data()?.free_trials_in_progress as number) ?? 0;
        tx.update(genRef, {
          metadata: { ...meta, trial_released: true },
        });
        tx.update(userRef, {
          free_trials_in_progress: Math.max(0, inProgress - 1),
          updated_at: new Date().toISOString(),
        });
      });
    } catch (err) {
      console.error("releaseFreeTrialSlot failed", err);
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
   * Premium + overlay: fail closed — never store an untitled cover.
   * Non-strict: historical fail-open fallback to the source image.
   */
  private async persistCover(
    coverUrl: string,
    bookId: string,
    generationId: string,
    overlayTitle: string | null,
    options?: { requireTitledOverlay?: boolean }
  ): Promise<{ url: string; path: string | null }> {
    const storagePath = `books/${bookId}/generations/${generationId}/cover.png`;
    return persistCoverWithOptionalTitle(
      {
        coverUrl,
        storagePath,
        overlayTitle,
        requireTitledOverlay: Boolean(options?.requireTitledOverlay),
      },
      {
        fetchCoverBytes: async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`fetch cover ${res.status}`);
          return new Uint8Array(await res.arrayBuffer());
        },
        uploadPng: (path, png) =>
          this.storage.uploadBytes(path, png, "image/png"),
        persistFromUrl: (url, path) =>
          this.storage.persistImageFromUrl(url, path),
      }
    );
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
    // (the images/PDF work would be lost for a cosmetic update). Heartbeat keeps
    // the reaper from killing live jobs during long fal waits.
    try {
      const now = new Date().toISOString();
      await this.db
        .collection("generations")
        .doc(id)
        .update({ ...patch, updated_at: now, heartbeat_at: now });
    } catch (err) {
      console.error(`[gen ${id}] updateGeneration failed (ignored)`, err);
    }
  }

  /** Lightweight heartbeat during long fal waits (no progress rewrite). */
  private async touchHeartbeat(id: string) {
    try {
      const now = new Date().toISOString();
      await this.db
        .collection("generations")
        .doc(id)
        .update({ heartbeat_at: now, updated_at: now });
    } catch (err) {
      console.error(`[gen ${id}] heartbeat failed (ignored)`, err);
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
    const pagesDone = book.pages.filter(
      (p) => p.generation_status === "completed" && Boolean(p.illustration_url)
    ).length;
    const pagesTotal = Math.max(book.page_count || 0, book.pages.length);
    const createdAt =
      typeof generation.created_at === "string" ? generation.created_at : null;
    const heartbeatAt =
      typeof generation.heartbeat_at === "string"
        ? generation.heartbeat_at
        : typeof generation.updated_at === "string"
          ? generation.updated_at
          : null;
    const elapsedMs = createdAt
      ? Math.max(0, Date.now() - Date.parse(createdAt))
      : null;
    const staleMs = heartbeatAt
      ? Math.max(0, Date.now() - Date.parse(heartbeatAt))
      : null;
    const supportId = `MD-${generation.id.slice(0, 8).toUpperCase()}`;
    return {
      id: generation.id,
      book_id: generation.book_id,
      status: generation.status,
      progress: generation.progress,
      current_step: generation.current_step,
      current_substep: generation.current_substep ?? null,
      cover_image: book.cover_image,
      pages: book.pages.map((p) => ({
        id: p.id,
        page_number: p.page_number,
        title: p.title,
        story_text: p.story_text,
        illustration_url: p.illustration_url,
        generation_status: p.generation_status,
      })),
      pages_done: pagesDone,
      pages_total: pagesTotal,
      elapsed_ms: elapsedMs,
      // Honest estimate: ~75s/page + 3 min story/sheet/cover for parent 6-pagers.
      estimated_total_ms: Math.max(240_000, pagesTotal * 75_000 + 180_000),
      taking_longer: Boolean(
        generation.status === "running" || generation.status === "queued"
          ? (staleMs != null && staleMs > 90_000) ||
              (elapsedMs != null && elapsedMs > pagesTotal * 90_000 + 240_000)
          : false
      ),
      credits_reserved: Number(generation.credits_used || 0),
      credits_state:
        generation.status === "completed"
          ? "captured"
          : generation.status === "failed" || generation.status === "partial"
            ? "released"
            : "reserved",
      support_id: supportId,
      free_retry_available: Boolean(book.free_retry_available),
      /** Exact credit cost /api/generation/start will reserve for a paid recreate. */
      recreate_cost: estimateBookCost(
        Number(book.page_count) || pagesTotal || 0,
        (book.type as string) || "colorbook"
      ),
      error_message: generation.error_message,
      book,
    };
  }
}
