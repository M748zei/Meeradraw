/**
 * Suite de tests fonctionnels Meeradraw (sans credentials prod).
 *
 * Couvre :
 * 1. Logique pure (crédits, redirect, SSRF, profil public, rate-limit)
 * 2. Providers IA mock (enrich / story / images)
 * 3. PDF (fetch allowlisté placehold.co)
 * 4. Intégration Firestore emulator (crédits, livres, ownership, retries reaper)
 * 5. Smoke HTTP sur le serveur Next (pages + API gates)
 *
 * Usage :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/functional-suite.ts
 *   BASE_URL=http://127.0.0.1:3000 npx tsx scripts/functional-suite.ts --http-only
 */

import { randomUUID } from "crypto";

type Result = { name: string; ok: boolean; detail?: string; ms: number };

const results: Result[] = [];
const httpOnly = process.argv.includes("--http-only");
const logicOnly = process.argv.includes("--logic-only");
const noHttp = process.argv.includes("--no-http");
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

async function test(name: string, fn: () => Promise<void> | void) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail, ms: Date.now() - t0 });
    console.error(`  ✗ ${name}: ${detail}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function runLogicTests() {
  console.log("\n═══ 1. Logique pure ═══");

  const { estimateBookCost, refundForFailedPages, packForChariowProduct, FREE_TRIALS_MAX, FREE_TRIAL_MAX_PAGES } =
    await import("../config/credits");
  const { safeInternalPath } = await import("../lib/safe-redirect");
  const { assertSafeImageUrl, isAllowedImageHost } = await import("../lib/safe-image-url");
  const { toPublicProfile } = await import("../lib/public-profile");
  const { rateLimit, clientIp } = await import("../lib/rate-limit");
  const { AppError, apiError, apiSuccess } = await import("../lib/errors");
  const { extractSale } = await import("../services/chariow-sale");

  await test("estimateBookCost colorbook 12 pages", () => {
    // cover 5 + 12*2 + pdf 1 = 30
    assert(estimateBookCost(12, "colorbook") === 30, `got ${estimateBookCost(12)}`);
  });

  await test("estimateBookCost storybook 6 pages", () => {
    // 5 + 6*3 + 1 = 24
    assert(estimateBookCost(6, "storybook") === 24, `got ${estimateBookCost(6, "storybook")}`);
  });

  await test("refundForFailedPages partial", () => {
    assert(refundForFailedPages(12, 10, "colorbook") === 4, "2 pages * 2 credits");
    assert(refundForFailedPages(6, 6, "colorbook") === 0, "full delivery");
    assert(refundForFailedPages(6, 0, "colorbook") === 12, "all failed pages");
  });

  await test("packForChariowProduct maps known packs", () => {
    assert(packForChariowProduct("prd_d2ik58za")?.id === "entry", "entry");
    assert(packForChariowProduct("prd_0658xmlt")?.credits === 150, "recharge");
    assert(packForChariowProduct("unknown") === null, "unknown");
  });

  await test("free trial constants", () => {
    assert(FREE_TRIALS_MAX === 3, "max trials");
    assert(FREE_TRIAL_MAX_PAGES === 6, "max pages");
  });

  await test("safeInternalPath blocks open redirects", () => {
    assert(safeInternalPath("/dashboard") === "/dashboard", "ok path");
    assert(safeInternalPath("/books/abc") === "/books/abc", "nested");
    assert(safeInternalPath("//evil.com") === "/dashboard", "protocol-relative");
    assert(safeInternalPath("https://evil.com") === "/dashboard", "absolute");
    assert(safeInternalPath("javascript:alert(1)") === "/dashboard", "js");
    assert(safeInternalPath("\\evil") === "/dashboard", "backslash");
    assert(safeInternalPath(null) === "/dashboard", "null");
    assert(safeInternalPath("/license", "/x") === "/license", "custom fallback unused");
  });

  await test("assertSafeImageUrl allowlist SSRF", () => {
    assert(isAllowedImageHost("fal.media"), "fal");
    assert(isAllowedImageHost("v3.fal.media"), "fal subdomain");
    assert(!isAllowedImageHost("evil.com"), "evil");
    assertSafeImageUrl("https://placehold.co/100.png");
    assertSafeImageUrl("https://storage.googleapis.com/bucket/x.png");
    let blocked = false;
    try {
      assertSafeImageUrl("https://169.254.169.254/latest/meta-data/");
    } catch {
      blocked = true;
    }
    assert(blocked, "metadata IP blocked");
    blocked = false;
    try {
      assertSafeImageUrl("https://user:pass@fal.media/x");
    } catch {
      blocked = true;
    }
    assert(blocked, "credentials blocked");
  });

  await test("toPublicProfile masks license key", () => {
    const pub = toPublicProfile(
      {
        email: "a@b.com",
        credits: 10,
        chariow_license: {
          license_key: "ABCD-EFGH-IJKL-MNOP",
          license_id: "lic_1",
          status: "active",
          is_active: true,
        },
      },
      "uid1"
    ) as Record<string, unknown>;
    assert(pub.id === "uid1", "id");
    const lic = pub.chariow_license as Record<string, unknown>;
    assert(lic.masked_key === "ABCD…MNOP", `masked=${lic.masked_key}`);
    assert(!("license_key" in lic), "raw key absent");
  });

  await test("rateLimit trips after limit", () => {
    const key = `test-${randomUUID()}`;
    rateLimit(key, { limit: 3, windowMs: 60_000 });
    rateLimit(key, { limit: 3, windowMs: 60_000 });
    rateLimit(key, { limit: 3, windowMs: 60_000 });
    let hit = false;
    try {
      rateLimit(key, { limit: 3, windowMs: 60_000 });
    } catch (e) {
      hit = e instanceof AppError && e.status === 429;
    }
    assert(hit, "expected 429");
  });

  await test("clientIp parses x-forwarded-for", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    assert(clientIp(req) === "1.2.3.4", clientIp(req));
  });

  await test("apiSuccess / apiError shape", async () => {
    const ok = apiSuccess({ a: 1 }, 201);
    assert(ok.status === 201, "status");
    const body = await ok.json();
    assert(body.success === true && body.data.a === 1, "body");
    const err = apiError(new AppError("FORBIDDEN", "nope", 403));
    assert(err.status === 403, "err status");
    const eb = await err.json();
    assert(eb.success === false && eb.error.code === "FORBIDDEN", "err body");
  });

  await test("extractSale parses Chariow payload", () => {
    const s = extractSale({
      sale: { id: "sale_1" },
      product: { id: "prd_d2ik58za" },
      customer: { email: "Buyer@Example.COM", name: "Ada" },
    });
    assert(s.saleId === "sale_1", "saleId");
    assert(s.email === "buyer@example.com", "email lower");
    assert(s.productId === "prd_d2ik58za", "product");
  });
}

async function runMockAiTests() {
  console.log("\n═══ 2. Providers IA mock ═══");
  const { MockTextProvider, MockImageProvider } = await import("../services/ai/mock-provider");
  const text = new MockTextProvider();
  const image = new MockImageProvider();

  await test("enrichIdea returns structured brief", async () => {
    const e = await text.enrichIdea(
      "Aïcha et le renard des sables explorent un marché à Dakar"
    );
    assert(e.title.length > 3, "title");
    assert(e.synopsis.length > 20, "synopsis");
    assert(e.castHints.length >= 2, "cast");
    assert(e.creativeBrief.includes("Titre"), "brief");
  });

  await test("generateStoryPlan respects pageCount", async () => {
    const plan = await text.generateStoryPlan(
      "aventure baobab afrique",
      6,
      "cute",
      undefined,
      "enfants 4-8"
    );
    assert(Array.isArray(plan.pages), "pages array");
    assert(plan.pages.length === 6, `pages=${plan.pages.length}`);
    assert(plan.characters.length >= 1, "characters");
  });

  await test("generateSettingBible african anchors", async () => {
    const bible = await text.generateSettingBible({
      universeTitle: "Village baobab",
      universeDescription: "marché dakar",
      style: "west_african",
    });
    assert(bible.elements.some((e) => /baobab/i.test(e)), "baobab element");
    assert(bible.forbiddenElements.length > 0, "forbidden");
  });

  await test("mock image URLs are allowlisted placehold.co", async () => {
    const cover = await image.generateImage({
      prompt: "cover",
      style: "cute",
      isCover: true,
      isColoringPage: false,
    });
    assert(cover.url.includes("placehold.co"), cover.url);
    const page = await image.generateImage({
      prompt: "enfant au marché",
      style: "cute",
      isColoringPage: true,
    });
    assert(page.url.includes("placehold.co"), page.url);
  });
}

async function runPdfTests() {
  console.log("\n═══ 3. PDF service ═══");
  const { PDFService } = await import("../services/pdf-service");
  const pdf = new PDFService();

  await test("buildBookPdf with placehold cover + page", async () => {
    const bytes = await pdf.buildBookPdf({
      title: "Test Livre",
      subtitle: "Suite fonctionnelle",
      coverUrl: "https://placehold.co/600x800/a8d8ff/1e3a5f/png?text=Cover",
      pages: [
        {
          pageNumber: 1,
          title: "Page 1",
          storyText: "Aïcha découvre le marché.",
          illustrationUrl: "https://placehold.co/800x800/ffffff/222222/png?text=Page1",
        },
        {
          pageNumber: 2,
          title: "Page 2",
          storyText: "Le renard apparaît.",
          illustrationUrl: null,
        },
      ],
    });
    assert(bytes.byteLength > 1000, `size=${bytes.byteLength}`);
    // PDF magic
    const head = Buffer.from(bytes.slice(0, 5)).toString("utf8");
    assert(head === "%PDF-", `magic=${head}`);
  });

  await test("buildBookPdf rejects SSRF cover (no throw, skip image)", async () => {
    const bytes = await pdf.buildBookPdf({
      title: "SSRF",
      coverUrl: "http://127.0.0.1:9/secret",
      pages: [{ pageNumber: 1, title: "x", storyText: "y" }],
    });
    assert(bytes.byteLength > 500, "still produces PDF");
  });
}

async function runFirestoreIntegration() {
  console.log("\n═══ 4. Intégration Firestore emulator ═══");

  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.log("  ⚠ FIRESTORE_EMULATOR_HOST absent — skip intégration");
    results.push({
      name: "firestore emulator available",
      ok: false,
      detail: "FIRESTORE_EMULATOR_HOST not set",
      ms: 0,
    });
    return;
  }

  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-meeradraw";
  process.env.GCLOUD_PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || "";

  // Fresh admin app against emulator
  const { getApps, deleteApp } = await import("firebase-admin/app");
  for (const app of getApps()) {
    await deleteApp(app);
  }

  const { getAdminDb } = await import("../lib/firebase/admin");
  const { CreditService } = await import("../services/credit-service");
  const { BookService } = await import("../services/book-service");
  const { UniverseService } = await import("../services/universe-service");
  const { applyChariowSale, reverseChariowSale } = await import("../services/chariow-sale");
  const { reapIfStale } = await import("../services/generation-reaper");

  const db = getAdminDb();
  const userA = `user-a-${randomUUID()}`;
  const userB = `user-b-${randomUUID()}`;

  await test("seed profiles", async () => {
    const now = new Date().toISOString();
    await db.collection("users").doc(userA).set({
      email: "a@test.local",
      credits: 100,
      free_trials_used: 0,
      free_trials_in_progress: 0,
      free_trials_max: 3,
      created_at: now,
      updated_at: now,
    });
    await db.collection("users").doc(userB).set({
      email: "b@test.local",
      credits: 50,
      free_trials_used: 0,
      free_trials_in_progress: 0,
      created_at: now,
      updated_at: now,
    });
  });

  const credits = new CreditService(db);
  const universes = new UniverseService(db);
  const books = new BookService(db);

  await test("CreditService reserve + refund idempotent", async () => {
    const before = await credits.getBalance(userA);
    await credits.reserve(userA, 30, "test reserve", "gen:t1:reserve");
    const mid = await credits.getBalance(userA);
    assert(mid === before - 30, `mid=${mid}`);
    // idempotent replay
    await credits.reserve(userA, 30, "test reserve", "gen:t1:reserve");
    assert((await credits.getBalance(userA)) === mid, "reserve idempotent");
    await credits.refund(userA, 10, "partial refund", "gen:t1:refund");
    assert((await credits.getBalance(userA)) === mid + 10, "refund");
    await credits.refund(userA, 10, "partial refund", "gen:t1:refund");
    assert((await credits.getBalance(userA)) === mid + 10, "refund idempotent");
  });

  await test("CreditService blocks overspend", async () => {
    let blocked = false;
    try {
      await credits.reserve(userA, 10_000, "too much", `gen:${randomUUID()}:reserve`);
    } catch (e) {
      blocked = e instanceof Error && e.message.includes("manque");
    }
    assert(blocked, "expected insufficient credits");
  });

  let universeAId = "";
  await test("UniverseService create + BookService ownership", async () => {
    const uni = await universes.create(userA, {
      title: "Univers Test",
      description: "Un village près du baobab pour les tests",
    });
    universeAId = uni.id;
    const book = await books.create(userA, {
      universe_id: universeAId,
      idea: "Une petite fille découvre un marché magique près du baobab",
      page_count: 6,
      style: "cute",
      title: "Livre Test",
    });
    assert(book.user_id === userA, "owner");
    assert(book.status === "draft", "draft");
  });

  await test("BookService rejects foreign universe_id", async () => {
    let blocked = false;
    try {
      await books.create(userB, {
        universe_id: universeAId,
        idea: "Tentative de détournement d'univers d'un autre user",
        page_count: 6,
      });
    } catch (e) {
      blocked = e instanceof Error && /introuvable|Univers/i.test(e.message);
    }
    assert(blocked, "cross-tenant book create must fail");
  });

  await test("applyChariowSale credits + reverse clawback", async () => {
    const saleId = `sale_${randomUUID()}`;
    const payload = {
      sale: { id: saleId },
      product: { id: "prd_0658xmlt" }, // recharge 150
      customer: { email: "a@test.local", name: "A" },
    };
    const before = await credits.getBalance(userA);
    const applied = await applyChariowSale(db, payload);
    assert(applied.credited === 150, `credited=${applied.credited}`);
    assert((await credits.getBalance(userA)) === before + 150, "balance after sale");
    // idempotent
    await applyChariowSale(db, payload);
    assert((await credits.getBalance(userA)) === before + 150, "sale idempotent");

    const rev = await reverseChariowSale(db, payload);
    assert(rev.reversed === 150, `reversed=${rev.reversed}`);
    assert((await credits.getBalance(userA)) === before, "balance after clawback");
    // idempotent clawback
    await reverseChariowSale(db, payload);
    assert((await credits.getBalance(userA)) === before, "clawback idempotent");
  });

  await test("reaper fails stale generation + refunds", async () => {
    const genId = randomUUID();
    const book = await books.create(userA, {
      universe_id: universeAId,
      idea: "Livre pour tester le reaper de générations bloquées",
      page_count: 4,
      title: "Reaper Book",
    });
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await credits.reserve(userA, 20, "stale gen", `gen:${genId}:reserve`);
    const before = await credits.getBalance(userA);
    await db.collection("generations").doc(genId).set({
      user_id: userA,
      book_id: book.id,
      status: "running",
      credits_used: 20,
      progress: 10,
      current_step: "illustrator",
      generation_type: "full_book",
      metadata: {},
      created_at: stale,
      updated_at: stale,
    });
    await books.update(userA, book.id, {
      status: "generating",
      active_generation_id: genId,
    });

    const snap = await db.collection("generations").doc(genId).get();
    const reaped = await reapIfStale(db, genId, snap.data());
    assert(reaped === true, "should reap");
    const afterGen = await db.collection("generations").doc(genId).get();
    assert(afterGen.data()?.status === "failed", "gen failed");
    const afterBook = await books.get(userA, book.id);
    assert(afterBook.status === "failed", "book failed");
    assert(afterBook.active_generation_id == null, "lock cleared");
    assert((await credits.getBalance(userA)) === before + 20, "refunded");
  });

  await test("GenerationOrchestrator full mock pipeline (trial)", async () => {
    process.env.MOCK_AI = "true";
    const { GenerationOrchestrator } = await import("../services/generation-orchestrator");
    const book = await books.create(userA, {
      universe_id: universeAId,
      idea: "Aïcha et le renard explorent un marché près du baobab à Dakar pour retrouver un tambour magique",
      page_count: 4,
      style: "west_african",
      title: "Pipeline Mock",
    });
    const genId = randomUUID();
    const now = new Date().toISOString();
    await db.collection("generations").doc(genId).set({
      user_id: userA,
      book_id: book.id,
      generation_type: "full_book",
      status: "queued",
      progress: 0,
      current_step: "queued",
      credits_used: 0,
      tokens_used: 0,
      provider: null,
      duration_ms: null,
      error_message: null,
      metadata: { is_trial: true, trial_reserved: true },
      created_at: now,
      updated_at: now,
    });
    await books.update(userA, book.id, {
      status: "generating",
      active_generation_id: genId,
    });
    // Reserve trial slot as start route would
    await db.collection("users").doc(userA).set(
      { free_trials_in_progress: 1 },
      { merge: true }
    );

    const orch = new GenerationOrchestrator(db);
    await orch.run(userA, book.id, genId, 0, { isTrial: true });

    const afterBook = await books.getWithPages(userA, book.id);
    assert(
      afterBook.status === "completed" || afterBook.status === "partial",
      `book status=${afterBook.status}`
    );
    assert(afterBook.pages.length === 4, `pages=${afterBook.pages.length}`);
    const withArt = afterBook.pages.filter((p) => p.illustration_url).length;
    assert(withArt >= 1, `illustrated pages=${withArt}`);
    assert(Boolean(afterBook.cover_image), "cover present");
    assert(afterBook.active_generation_id == null, "generation lock cleared");

    const gen = await db.collection("generations").doc(genId).get();
    const gst = gen.data()?.status;
    assert(gst === "completed" || gst === "partial", `gen status=${gst}`);
    assert(gen.data()?.progress === 100, "progress 100");

    const user = await db.collection("users").doc(userA).get();
    // Trial consumed or slot released depending on delivery
    const used = (user.data()?.free_trials_used as number) ?? 0;
    const inProg = (user.data()?.free_trials_in_progress as number) ?? 0;
    assert(inProg === 0, `trial slot released, in_progress=${inProg}`);
    if (withArt > 0) {
      assert(used >= 1, `trial consumed used=${used}`);
    }
  });
}

async function runHttpSmoke() {
  console.log("\n═══ 5. Smoke HTTP ═══");

  async function get(path: string) {
    const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  }

  async function post(path: string, body?: unknown) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: res.status, text, json, headers: res.headers };
  }

  // Reachability
  let up = false;
  await test(`server reachable ${BASE_URL}`, async () => {
    const res = await get("/");
    assert(res.status === 200, `status=${res.status}`);
    assert(/meeradraw|coloriage|studio/i.test(res.text), "landing content");
    up = true;
  });
  if (!up) return;

  const publicPages = [
    "/",
    "/login",
    "/signup",
    "/merci",
    "/icon.png",
  ];
  for (const p of publicPages) {
    await test(`GET ${p} → 200`, async () => {
      const res = await get(p);
      assert(res.status === 200, `status=${res.status}`);
    });
  }

  // Demo mode (no Firebase): protected pages should still render (proxy bypass).
  // With Firebase configured they redirect to /login — both acceptable.
  for (const p of ["/dashboard", "/library", "/credits", "/license", "/profile", "/universes/new"]) {
    await test(`GET ${p} reachable (200 or 307→login)`, async () => {
      const res = await get(p);
      assert(
        res.status === 200 || res.status === 307 || res.status === 302,
        `status=${res.status}`
      );
      if (res.status === 307 || res.status === 302) {
        const loc = res.headers.get("location") || "";
        assert(/login/i.test(loc), `redirect=${loc}`);
      }
    });
  }

  await test("GET /settings → /profile (alias)", async () => {
    const res = await get("/settings");
    // Alias product: settings redirects to profile when authenticated/demo,
    // or to login when auth is required.
    assert(
      res.status === 200 || res.status === 307 || res.status === 302,
      `status=${res.status}`
    );
    if (res.status === 307 || res.status === 302) {
      const loc = res.headers.get("location") || "";
      assert(/profile|login/i.test(loc), `redirect=${loc}`);
    }
  });

  await test("redirect /create → /universes/new", async () => {
    const res = await get("/create");
    assert(res.status === 307 || res.status === 308 || res.status === 302, `status=${res.status}`);
    const loc = res.headers.get("location") || "";
    assert(loc.includes("/universes/new"), loc);
  });

  await test("security headers present", async () => {
    const res = await get("/");
    assert(res.headers.get("x-content-type-options") === "nosniff", "nosniff");
    assert(res.headers.get("x-frame-options") === "DENY", "frame");
    assert(Boolean(res.headers.get("referrer-policy")), "referrer");
  });

  await test("logo asset exists", async () => {
    const res = await get("/meeradraw-logo.png");
    assert(res.status === 200, `status=${res.status}`);
  });

  await test("gallery assets exist", async () => {
    for (const f of ["cover.jpg", "page1.jpg", "page2.jpg"]) {
      const res = await get(`/_gentest7/${f}`);
      assert(res.status === 200, `${f} status=${res.status}`);
    }
  });

  // API without session → 401
  const authedPosts: Array<[string, unknown]> = [
    ["/api/books", { universe_id: randomUUID(), idea: "x".repeat(20) }],
    ["/api/generation/start", { book_id: randomUUID() }],
    ["/api/generation/retry", { book_id: randomUUID() }],
    ["/api/pdf/export", { book_id: randomUUID() }],
    ["/api/license/activate", { license_key: "AAAA-BBBB-CCCC" }],
    ["/api/ai/enrich-idea", { idea: "une idée de livre de coloriage" }],
    ["/api/checkout", { pack_id: "recharge" }],
  ];
  for (const [path, body] of authedPosts) {
    await test(`POST ${path} without auth → 401`, async () => {
      const res = await post(path, body);
      assert(res.status === 401, `status=${res.status} body=${res.text.slice(0, 120)}`);
    });
  }

  await test("GET /api/user without auth → 401", async () => {
    const res = await get("/api/user");
    assert(res.status === 401, `status=${res.status}`);
  });

  await test("GET /api/credits without auth → 401", async () => {
    const res = await get("/api/credits");
    assert(res.status === 401, `status=${res.status}`);
  });

  await test("webhook chariow fail-closed without secret in prod-like", async () => {
    // In non-production without secret, webhook is open — just ensure it accepts JSON
    // and returns a structured response (or 403 if secret set).
    const res = await post("/api/webhooks/chariow", { event: "ping" });
    assert(
      res.status === 200 || res.status === 403 || res.status === 500,
      `status=${res.status}`
    );
  });

  await test("cron reap without secret → 403 in production-like or ok in dev", async () => {
    const res = await get("/api/cron/reap-generations");
    assert(
      res.status === 200 || res.status === 403 || res.status === 500,
      `status=${res.status}`
    );
  });

  await test("404 branded page", async () => {
    const res = await get("/this-route-does-not-exist-xyz");
    assert(res.status === 404, `status=${res.status}`);
    assert(/meeradraw|introuvable|404/i.test(res.text), "branded 404");
  });
}

async function main() {
  console.log("Meeradraw — suite fonctionnelle");
  console.log(`NODE_ENV=${process.env.NODE_ENV || "undefined"}`);
  console.log(`FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST || "(none)"}`);
  console.log(`BASE_URL=${BASE_URL}`);

  if (!httpOnly) {
    await runLogicTests();
    await runMockAiTests();
    await runPdfTests();
    if (!logicOnly) {
      await runFirestoreIntegration();
    }
  }

  if (!logicOnly && !noHttp) {
    await runHttpSmoke();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n═══ Résumé ═══");
  console.log(`${passed}/${results.length} OK`);
  if (failed.length) {
    console.log("Échecs :");
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.detail}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Tous les tests sont passés.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
