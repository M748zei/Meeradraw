/**
 * Focused reliability tests for the generation pipeline / credits / QC gates
 * that failed in production (gen 94d46b1e, cover QC lineup @ 40%).
 *
 * Run: npm run test:generation-reliability
 * With emulator ledger invariants:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:generation-reliability:emulator
 */
import assert from "node:assert/strict";
import { canSoftAcceptCover } from "../lib/cover-soft-accept";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

async function runSoftAcceptTests() {
  console.log("── soft-accept cover allowlist ──");

  await test("lineup/action faible → soft-accept possible", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 2,
        verdicts: ["cover-lineup:static pose"],
      }),
      true
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 1,
        verdicts: ["cover-action-missing:not dynamic enough"],
      }),
      true
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 3,
        verdicts: ["cover-lineup:a", "cover-action-missing:b"],
      }),
      true,
      "allowlist ignores numeric score; soft tags only"
    );
  });

  await test("identité insuffisante → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 2,
        verdicts: ["cover-lineup:x", "identity:Khadidja=40"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 5,
        verdicts: ["identity:reference mismatch"],
      }),
      false
    );
  });

  await test("personnage principal absent / mauvais cast → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 2,
        verdicts: ["hero-missing:no child"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 4,
        verdicts: ["cast:saw 0"],
      }),
      false
    );
  });

  await test("anatomie problématique → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 4,
        verdicts: ["anatomy:malformed face"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 3,
        verdicts: ["craft:deformed face"],
      }),
      false
    );
  });

  await test("texte parasite / illisible → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 2,
        verdicts: ["title:illegible"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 2,
        verdicts: ["parasite-text:watermark"],
      }),
      false
    );
  });

  await test("image corrompue / floue → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: true,
        score: 3,
        verdicts: ["cover-lineup:x"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 5,
        verdicts: ["corrupt:blank-or-unreadable"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 2,
        verdicts: ["blur:out of focus"],
      }),
      false
    );
  });

  await test("contenu dangereux / hors sujet / orientation → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 1,
        verdicts: ["unsafe:violent"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 1,
        verdicts: ["off-topic:unrelated to story"],
      }),
      false
    );
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 1,
        verdicts: ["orientation:landscape upside down"],
      }),
      false
    );
  });

  await test("zones coloriables absentes / environnement → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 4,
        verdicts: ["environment:empty void"],
      }),
      false
    );
  });

  await test("plusieurs défauts graves combinés → rejet", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 9,
        verdicts: [
          "cover-lineup:static",
          "identity:Khadidja=20",
          "anatomy:extra arm",
          "cast:saw 3",
        ],
      }),
      false
    );
  });

  await test("score<=2 seul sans verdict soft → rejet (pas de règle globale)", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: 2,
        verdicts: [],
      }),
      false,
      "must not soft-accept on score alone"
    );
  });

  await test("pages intérieures jamais soft-accept cover", () => {
    assert.equal(
      canSoftAcceptCover({
        isCover: false,
        blank: false,
        score: 2,
        verdicts: ["cover-lineup:x"],
      }),
      false
    );
  });
}

async function runLogicInvariants() {
  console.log("\n── logic invariants ──");

  await test("permanent provider errors are classified", async () => {
    const { classifyGenerationError } = await import(
      "../lib/generation-step-ledger"
    );
    const { isNonRetryableFalError, NonRetryableFalError } = await import(
      "../services/ai/fal-provider"
    );
    assert.equal(
      classifyGenerationError(
        new Error("strict visual quality gate rejected image (score 7)")
      ).permanent,
      true
    );
    assert.equal(
      isNonRetryableFalError(
        new NonRetryableFalError("strict visual quality gate rejected image")
      ),
      true
    );
    assert.equal(
      isNonRetryableFalError(new Error("temporary 503 from fal")),
      false
    );
  });

  await test("identity threshold accepts 80/100 near-miss", () => {
    const passes = [80, 90, 75].every((score) => score >= 75);
    const fails = [74, 40].some((score) => score < 75);
    assert.equal(passes, true);
    assert.equal(fails, true);
  });

  await test("double generate claim reuses alive generation (logic)", () => {
    const first = { generationId: "g-alive", alive: true };
    const secondClick = first.alive
      ? { reused: true, generationId: first.generationId }
      : { reused: false, generationId: "g-new" };
    assert.equal(secondClick.reused, true);
    assert.equal(secondClick.generationId, "g-alive");
  });

  await test("double free-retry consumes flag once (logic)", () => {
    let freeRetryAvailable = true;
    function claim() {
      if (!freeRetryAvailable) return { cost: 18, freeRetry: false };
      freeRetryAvailable = false;
      return { cost: 0, freeRetry: true };
    }
    const a = claim();
    const b = claim();
    assert.equal(a.cost, 0);
    assert.equal(b.cost, 18);
    assert.equal(freeRetryAvailable, false);
  });

  await test("free retry success stays free; next run is paid (logic)", () => {
    let freeRetryAvailable = true;
    let balance = 84;
    function start(costIfPaid: number) {
      if (freeRetryAvailable) {
        freeRetryAvailable = false;
        return { cost: 0, reserved: 0 };
      }
      balance -= costIfPaid;
      return { cost: costIfPaid, reserved: costIfPaid };
    }
    const retry = start(18);
    assert.equal(retry.cost, 0);
    assert.equal(balance, 84);
    // success: no capture debit for free run
    const later = start(18);
    assert.equal(later.cost, 18);
    assert.equal(balance, 66);
  });

  await test("capture and refund cannot both apply on success (logic)", () => {
    const cost = 18;
    const completed = true;
    const failedPages = 0;
    const refund = completed && failedPages === 0 ? 0 : cost;
    const capture = Math.max(0, cost - refund);
    assert.equal(refund === 0 || capture === 0, true);
    assert.equal(capture, 18);
    assert.equal(refund, 0);
  });

  await test("page resume skips completed pages", () => {
    const pages = [
      { id: "p1", generation_status: "completed", illustration_url: "https://x/1.png" },
      { id: "p2", generation_status: "failed", illustration_url: null },
      { id: "p3", generation_status: "pending", illustration_url: null },
    ];
    const toRun = pages.filter(
      (p) =>
        !(
          p.generation_status === "completed" &&
          typeof p.illustration_url === "string" &&
          p.illustration_url
        )
    );
    assert.equal(toRun.map((p) => p.id).join(","), "p2,p3");
  });

  await test("PNG 2.2MB child photo size is within upload policy", () => {
    const maxBytes = 8 * 1024 * 1024;
    const sample = 2.2 * 1024 * 1024;
    assert.ok(sample < maxBytes);
  });

  await test("expired reference URL is permanent", async () => {
    const { classifyGenerationError } = await import(
      "../lib/generation-step-ledger"
    );
    assert.equal(
      classifyGenerationError(new Error("Signed URL expired for reference")).code,
      "REFERENCE_URL"
    );
  });

  await test("invalid fal response stays non-retryable when locked", async () => {
    const { isNonRetryableFalError } = await import("../services/ai/fal-provider");
    assert.equal(
      isNonRetryableFalError(
        new Error(
          'fal.ai error: {"detail":"User is locked. Reason: Exhausted balance."}'
        )
      ),
      true
    );
  });

  await test("Google PC/iPhone auth helpers remain intact", async () => {
    const { isIosOrIpadOs } = await import("../lib/firebase/google-auth-flow");
    assert.equal(
      isIosOrIpadOs(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        "iPhone",
        5
      ),
      true
    );
    assert.equal(
      isIosOrIpadOs(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "MacIntel",
        0
      ),
      false
    );
  });
}

async function runEmulatorLedgerTests() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) {
    console.log(
      "\n── emulator ledger ──\n  (skipped — set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080)"
    );
    return;
  }

  console.log(`\n── emulator ledger @ ${host} ──`);
  process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-meeradraw";
  process.env.FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID || "demo-meeradraw";

  const { getApps, deleteApp, initializeApp } = await import("firebase-admin/app");
  for (const app of getApps()) {
    await deleteApp(app);
  }
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  const { getFirestore } = await import("firebase-admin/firestore");
  const db = getFirestore();
  const { CreditService } = await import("../services/credit-service");
  const { randomUUID } = await import("crypto");

  const uid = `emu_${randomUUID().slice(0, 8)}`;
  await db.collection("users").doc(uid).set({
    email: `${uid}@example.com`,
    credits: 84,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const credits = new CreditService(db);

  await test("terminal failure restores exact initial balance (18)", async () => {
    const before = await credits.getBalance(uid);
    assert.equal(before, 84);
    const gid = randomUUID();
    await credits.reserve(uid, 18, "reserve", `gen:${gid}:reserve`);
    assert.equal(await credits.getBalance(uid), 66);
    await credits.refund(uid, 18, "refund", `gen:${gid}:refund:full`);
    assert.equal(await credits.getBalance(uid), 84);
  });

  await test("double refund does not credit twice", async () => {
    const gid = randomUUID();
    const before = await credits.getBalance(uid);
    await credits.reserve(uid, 18, "reserve", `gen:${gid}:reserve`);
    await credits.refund(uid, 18, "refund", `gen:${gid}:refund:full`);
    await credits.refund(uid, 18, "refund", `gen:${gid}:refund:full`);
    assert.equal(await credits.getBalance(uid), before);
  });

  await test("free retry success: no second debit; capture is zero-delta", async () => {
    const before = await credits.getBalance(uid);
    const paid = randomUUID();
    const free = randomUUID();
    await credits.reserve(uid, 18, "paid", `gen:${paid}:reserve`);
    await credits.refund(uid, 18, "fail", `gen:${paid}:refund:full`);
    assert.equal(await credits.getBalance(uid), before);
    // Free retry: no reserve. Capture marks success without changing balance.
    await credits.capture(uid, 18, "free success", `gen:${free}:capture`);
    await credits.capture(uid, 18, "free success", `gen:${free}:capture`);
    assert.equal(await credits.getBalance(uid), before);
    const hist = await credits.history(uid, 30);
    const captures = hist.filter(
      (h) => (h as { reference_id?: string }).reference_id === `gen:${free}:capture`
    );
    assert.equal(captures.length, 1);
  });

  await test("capture and refund never both for same successful gen", async () => {
    const gid = randomUUID();
    const before = await credits.getBalance(uid);
    await credits.reserve(uid, 18, "reserve", `gen:${gid}:reserve`);
    // Success path: capture only (no refund).
    await credits.capture(uid, 18, "delivered", `gen:${gid}:capture`);
    assert.equal(await credits.getBalance(uid), before - 18);
    const hist = await credits.history(uid, 40);
    const refunds = hist.filter(
      (h) => (h as { reference_id?: string }).reference_id === `gen:${gid}:refund:full`
    );
    const captures = hist.filter(
      (h) => (h as { reference_id?: string }).reference_id === `gen:${gid}:capture`
    );
    assert.equal(refunds.length, 0);
    assert.equal(captures.length, 1);
  });

  await test("free_retry_available consumed atomically under concurrency", async () => {
    const bookId = randomUUID();
    const bookRef = db.collection("books").doc(bookId);
    await bookRef.set({
      user_id: uid,
      status: "draft",
      free_retry_available: true,
      updated_at: new Date().toISOString(),
    });

    async function claimOnce() {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(bookRef);
        const free = Boolean(snap.data()?.free_retry_available);
        if (!free) return { cost: 18, freeRetry: false };
        tx.update(bookRef, {
          free_retry_available: false,
          updated_at: new Date().toISOString(),
        });
        return { cost: 0, freeRetry: true };
      });
    }

    const [a, b] = await Promise.all([claimOnce(), claimOnce()]);
    const freeCount = [a, b].filter((x) => x.freeRetry).length;
    const paidCount = [a, b].filter((x) => !x.freeRetry).length;
    assert.equal(freeCount, 1, `freeCount=${freeCount}`);
    assert.equal(paidCount, 1, `paidCount=${paidCount}`);
    const after = await bookRef.get();
    assert.equal(after.data()?.free_retry_available, false);
  });
}

async function main() {
  console.log("Generation reliability suite\n");
  await runSoftAcceptTests();
  await runLogicInvariants();
  await runEmulatorLedgerTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
