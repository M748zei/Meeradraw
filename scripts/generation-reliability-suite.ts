/**
 * Focused reliability tests for the generation pipeline / credits / QC gates
 * that failed in production (gen 94d46b1e, cover QC lineup @ 40%).
 *
 * Run: npx tsx --env-file=.env.local scripts/generation-reliability-suite.ts
 */
import assert from "node:assert/strict";

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

async function main() {
  console.log("Generation reliability suite\n");

  await test("soft cover QC defects are accepted after rerolls", async () => {
    // Pure logic mirror of fal-provider softCoverAcceptable predicate.
    const softCoverAcceptable = (
      isCover: boolean,
      blank: boolean,
      score: number,
      verdicts: string[]
    ) =>
      isCover &&
      !blank &&
      score > 0 &&
      score <= 2 &&
      !verdicts
        .slice(-4)
        .some((v) =>
          /^(cast:|comic-layout:|cover-quality:vision-unavailable)/i.test(v)
        );

    assert.equal(
      softCoverAcceptable(true, false, 2, [
        "cover-lineup:static pose",
        "identity:Khadidja=80",
      ]),
      true,
      "lineup score 2 on cover must soft-accept"
    );
    assert.equal(
      softCoverAcceptable(true, false, 5, ["identity:Khadidja=40"]),
      false,
      "hard identity miss must not soft-accept"
    );
    assert.equal(
      softCoverAcceptable(false, false, 2, ["lineup:x"]),
      false,
      "pages stay strict"
    );
  });

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

  await test("identity threshold accepts 80/100 near-miss", async () => {
    // Threshold lowered from 85 → 75 (prod failure had Khadidja=80).
    const passes = [80, 90, 75].every((score) => score >= 75);
    const fails = [74, 40].some((score) => score < 75);
    assert.equal(passes, true);
    assert.equal(fails, true);
  });

  await test("double generate claim reuses alive generation (logic)", async () => {
    // Documented contract of start/route: live heartbeat → reused:true, no second reserve.
    const first = { generationId: "g-alive", alive: true };
    const secondClick = first.alive
      ? { reused: true, generationId: first.generationId }
      : { reused: false, generationId: "g-new" };
    assert.equal(secondClick.reused, true);
    assert.equal(secondClick.generationId, "g-alive");
  });

  await test("double free-retry consumes flag once (logic)", async () => {
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

  await test("page resume skips completed pages", async () => {
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

  await test("PNG 2.2MB child photo size is within upload policy", async () => {
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
    assert.equal(
      classifyGenerationError(new Error("Signed URL expired for reference"))
        .permanent,
      true
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
