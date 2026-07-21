import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { UniverseService } from "@/services/universe-service";
import { BookService } from "@/services/book-service";
import { GenerationOrchestrator } from "@/services/generation-orchestrator";
import { estimateBookCost } from "@/config/credits";

/**
 * DEV-ONLY test harness to drive the REAL generation pipeline (Groq + fal).
 * Strictly gated: only runs when NODE_ENV !== "production" AND ?secret matches.
 * REMOVE after quality-lock testing.
 */
export const maxDuration = 300;

const DEV_SECRET = "colorbook-quality-lock-2026";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 404 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== DEV_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const adminEmail =
    (process.env.ADMIN_EMAILS || "").split(",")[0]?.trim() ||
    "manbroukmohamedzei@gmail.com";
  const idea =
    url.searchParams.get("idea") ||
    "Aïcha, une petite fille curieuse, et son ami le renard des sables explorent un marché ouest-africain animé pour retrouver le tambour magique perdu de son grand-père.";
  const style = url.searchParams.get("style") || "west_african";
  const pageCount = Number(url.searchParams.get("pages") || 6);

  const db = getAdminDb();

  try {
    const auth = getAdminAuth();
    const userRecord = await auth.getUserByEmail(adminEmail);
    const uid = userRecord.uid;

    // Ensure a user profile doc exists (credit ops read/write it)
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      await userRef.set({
        id: uid,
        email: adminEmail,
        fullname: userRecord.displayName || "Admin",
        subscription_plan: "free",
        credits: 1000,
        preferred_language: "fr",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else if (!userSnap.data()?.email) {
      await userRef.update({ email: adminEmail });
    }

    const universes = new UniverseService(db);
    const books = new BookService(db);

    const universe = await universes.create(uid, {
      title: `[GENTEST] ${style} — ${new Date().toISOString()}`,
      description: "Dev quality-lock test universe",
      language: "fr",
      audience_age: "4-8",
    });

    const book = await books.create(uid, {
      universe_id: universe.id,
      type: "colorbook",
      idea,
      original_idea: idea,
      page_count: pageCount,
      style,
      title: "[GENTEST] Coloring Book",
    });

    const cost = estimateBookCost(pageCount, "colorbook");
    const generationId = randomUUID();
    const now = new Date().toISOString();
    await db.collection("generations").doc(generationId).set({
      user_id: uid,
      book_id: book.id,
      generation_type: "full_book",
      status: "queued",
      progress: 0,
      current_step: "queued",
      credits_used: cost,
      tokens_used: 0,
      provider: null,
      duration_ms: null,
      error_message: null,
      metadata: { dev_test: true },
      created_at: now,
      updated_at: now,
    });
    await books.update(uid, book.id, { status: "generating" });

    const startedAt = Date.now();
    const orchestrator = new GenerationOrchestrator(db);
    await orchestrator.run(uid, book.id, generationId, cost);
    const durationMs = Date.now() - startedAt;

    // Read back results
    const full = await books.getWithPages(uid, book.id);
    const genSnap = await db.collection("generations").doc(generationId).get();
    const gen = genSnap.data();

    const pages = full.pages
      .sort((a, b) => (a.page_number as number) - (b.page_number as number))
      .map((p) => ({
        page_number: p.page_number,
        title: p.title,
        generation_status: p.generation_status,
        has_illustration: Boolean(p.illustration_url),
        illustration_url: p.illustration_url,
      }));

    return NextResponse.json({
      ok: true,
      duration_ms: durationMs,
      uid,
      universe_id: universe.id,
      book_id: book.id,
      generation_id: generationId,
      book_status: full.status,
      generation_status: gen?.status,
      generation_error: gen?.error_message ?? null,
      provider: gen?.provider ?? null,
      title: full.title,
      subtitle: full.subtitle,
      cover_image: full.cover_image,
      character_sheet_url: full.character_sheet_url ?? null,
      pdf_url_present: Boolean(full.pdf_url),
      pdf_url_kind: full.pdf_url
        ? String(full.pdf_url).startsWith("data:")
          ? "data-url"
          : "remote"
        : null,
      pages_ok: pages.filter((p) => p.has_illustration).length,
      pages_total: pages.length,
      pages,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
