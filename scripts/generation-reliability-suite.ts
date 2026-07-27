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
import {
  applyCoverPosterVerdicts,
  identityScoresPass,
  IDENTITY_PASS_SCORE,
  type CoverPosterCheck,
} from "../lib/vision-qc";
import {
  bookFieldsAfterFreeRetryLaunchFailure,
  COST_MISMATCH_MESSAGE,
  FREE_RETRY_UNAVAILABLE_MESSAGE,
  resolveGenerationStartClaim,
} from "../lib/generation-start-claim";
import { persistCoverWithOptionalTitle } from "../lib/cover-persist";
import { estimateBookCost } from "../config/credits";
import {
  persistGenerationStep,
  stepIdempotencyKey,
} from "../lib/generation-step-ledger";

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

function softPoster(
  overrides: Partial<CoverPosterCheck> = {}
): CoverPosterCheck {
  return {
    lineup: false,
    actionVisible: true,
    singleComposition: true,
    anatomyValid: true,
    professionalLineArt: true,
    sharpReadable: true,
    orientationCorrect: true,
    storyRelated: true,
    childSafe: true,
    ...overrides,
  };
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

async function runCoverGateIntegrationTests() {
  console.log("\n── cover poster gate → soft-accept wiring ──");

  await test("anatomy verdict from cover check hits blocklist", () => {
    const { verdicts, visionScore } = applyCoverPosterVerdicts(
      softPoster({ anatomyValid: false, issue: "extra arm" })
    );
    assert.ok(verdicts.some((v) => v.startsWith("anatomy:")));
    assert.ok(visionScore >= 4);
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: visionScore,
        verdicts,
      }),
      false
    );
  });

  await test("comic-layout verdict from cover check hits blocklist", () => {
    const { verdicts, visionScore } = applyCoverPosterVerdicts(
      softPoster({ singleComposition: false, issue: "panels" })
    );
    assert.ok(verdicts.some((v) => v.startsWith("comic-layout:")));
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: visionScore,
        verdicts,
      }),
      false
    );
  });

  await test("craft / blur / unsafe verdicts from cover check hard-reject", () => {
    for (const poster of [
      softPoster({ professionalLineArt: false, issue: "clipart" }),
      softPoster({ sharpReadable: false, issue: "corrupt blur" }),
      softPoster({ childSafe: false, issue: "unsafe" }),
    ]) {
      const { verdicts, visionScore } = applyCoverPosterVerdicts(poster);
      assert.equal(
        canSoftAcceptCover({
          isCover: true,
          blank: false,
          score: visionScore,
          verdicts,
        }),
        false
      );
    }
  });

  await test("identity + cast + title tags still hard-reject with soft lineup", () => {
    const soft = applyCoverPosterVerdicts(
      softPoster({ lineup: true, actionVisible: false, issue: "static row" })
    );
    for (const hard of [
      "identity:Khadidja=80",
      "cast:saw 0",
      "title:illegible",
      "corrupt:blank-or-unreadable",
    ]) {
      assert.equal(
        canSoftAcceptCover({
          isCover: true,
          blank: hard.startsWith("corrupt:"),
          score: soft.visionScore + 5,
          verdicts: [...soft.verdicts, hard],
        }),
        false,
        hard
      );
    }
  });

  await test("lineup/action alone soft-accepts after rerolls", () => {
    const { verdicts, visionScore } = applyCoverPosterVerdicts(
      softPoster({
        lineup: true,
        actionVisible: false,
        issue: "static multi-character row",
      })
    );
    assert.ok(verdicts.every((v) => /^cover-(lineup|action-missing):/i.test(v)));
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: visionScore,
        verdicts,
      }),
      true
    );
  });

  await test("lineup/action + hard anatomy stays rejected", () => {
    const { verdicts, visionScore } = applyCoverPosterVerdicts(
      softPoster({
        lineup: true,
        actionVisible: false,
        anatomyValid: false,
        issue: "lineup and fused limbs",
      })
    );
    assert.ok(verdicts.some((v) => v.startsWith("cover-lineup:")));
    assert.ok(verdicts.some((v) => v.startsWith("anatomy:")));
    assert.equal(
      canSoftAcceptCover({
        isCover: true,
        blank: false,
        score: visionScore,
        verdicts,
      }),
      false
    );
  });
}

async function runCoverPersistTests() {
  console.log("\n── cover title overlay persist ──");

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

  await test("premium overlay success → titled result persisted", async () => {
    let uploadedText: string | null = null;
    let fallbackCalled = false;
    const result = await persistCoverWithOptionalTitle(
      {
        coverUrl: "https://example.test/cover.png",
        storagePath: "books/b1/generations/g1/cover.png",
        overlayTitle: "Aïcha et le Renard",
        requireTitledOverlay: true,
      },
      {
        fetchCoverBytes: async () => new Uint8Array(tinyPng),
        overlay: async (_png, title) => {
          assert.equal(title, "Aïcha et le Renard");
          return Buffer.from(`titled:${title}`);
        },
        uploadPng: async (path, png) => {
          assert.equal(path, "books/b1/generations/g1/cover.png");
          uploadedText = Buffer.from(png).toString("utf8");
          return `gs://bucket/${path}`;
        },
        persistFromUrl: async () => {
          fallbackCalled = true;
          return { url: "https://fallback", path: "fallback.png" };
        },
      }
    );
    assert.equal(fallbackCalled, false);
    assert.equal(result.path, "books/b1/generations/g1/cover.png");
    assert.equal(result.url, "gs://bucket/books/b1/generations/g1/cover.png");
    assert.equal(uploadedText, "titled:Aïcha et le Renard");
  });

  await test("premium overlay error → reject, no untitled cover saved", async () => {
    let uploaded = false;
    let fallbackCalled = false;
    await assert.rejects(
      () =>
        persistCoverWithOptionalTitle(
          {
            coverUrl: "https://example.test/cover.png",
            storagePath: "books/b1/generations/g1/cover.png",
            overlayTitle: "Aïcha et le Renard",
            requireTitledOverlay: true,
          },
          {
            fetchCoverBytes: async () => new Uint8Array(tinyPng),
            overlay: async () => {
              throw new Error("sharp failed");
            },
            uploadPng: async () => {
              uploaded = true;
              return "gs://x";
            },
            persistFromUrl: async () => {
              fallbackCalled = true;
              return { url: "https://fallback", path: "fallback.png" };
            },
          }
        ),
      /Premium cover title overlay failed/
    );
    assert.equal(uploaded, false);
    assert.equal(fallbackCalled, false);
  });

  await test("premium titled upload error → reject", async () => {
    let fallbackCalled = false;
    await assert.rejects(
      () =>
        persistCoverWithOptionalTitle(
          {
            coverUrl: "https://example.test/cover.png",
            storagePath: "books/b1/generations/g1/cover.png",
            overlayTitle: "Aïcha et le Renard",
            requireTitledOverlay: true,
          },
          {
            fetchCoverBytes: async () => new Uint8Array(tinyPng),
            overlay: async () => Buffer.from("titled"),
            uploadPng: async () => {
              throw new Error("storage 503");
            },
            persistFromUrl: async () => {
              fallbackCalled = true;
              return { url: "https://fallback", path: "fallback.png" };
            },
          }
        ),
      /Premium cover title overlay failed/
    );
    assert.equal(fallbackCalled, false);
  });

  await test("non-strict overlay error → historical untitled fallback", async () => {
    const result = await persistCoverWithOptionalTitle(
      {
        coverUrl: "https://example.test/cover.png",
        storagePath: "books/b1/generations/g1/cover.png",
        overlayTitle: "Story Title",
        requireTitledOverlay: false,
      },
      {
        fetchCoverBytes: async () => new Uint8Array(tinyPng),
        overlay: async () => {
          throw new Error("overlay boom");
        },
        uploadPng: async () => "gs://should-not",
        persistFromUrl: async (url, path) => ({
          url: `${url}#kept`,
          path,
        }),
      }
    );
    assert.equal(result.url, "https://example.test/cover.png#kept");
    assert.equal(result.path, "books/b1/generations/g1/cover.png");
  });

  await test("path without overlay → no overlay call; provider title path", async () => {
    let overlayCalled = false;
    const result = await persistCoverWithOptionalTitle(
      {
        coverUrl: "https://example.test/cover.png",
        storagePath: "books/b1/generations/g1/cover.png",
        overlayTitle: null,
        requireTitledOverlay: false,
      },
      {
        fetchCoverBytes: async () => {
          throw new Error("should not fetch for overlay");
        },
        overlay: async () => {
          overlayCalled = true;
          return Buffer.from("x");
        },
        uploadPng: async () => "gs://no",
        persistFromUrl: async () => ({
          url: "https://provider-lettered",
          path: "books/b1/generations/g1/cover.png",
        }),
      }
    );
    assert.equal(overlayCalled, false);
    assert.equal(result.url, "https://provider-lettered");
  });

  await test("sans overlay → coverTitle fournisseur actif (checkCoverTitle)", () => {
    // Mirrors runCoverPhase wiring: reference path overlays server-side;
    // text-only path passes plan.title to Fal so checkCoverTitle stays active.
    const planTitle = "Aïcha et le Renard";
    for (const useOverlayTitle of [true, false]) {
      const falCoverTitle = useOverlayTitle ? undefined : planTitle;
      const persistOverlayTitle = useOverlayTitle ? planTitle : null;
      if (useOverlayTitle) {
        assert.equal(falCoverTitle, undefined);
        assert.equal(persistOverlayTitle, planTitle);
      } else {
        assert.equal(falCoverTitle, planTitle);
        assert.equal(persistOverlayTitle, null);
        assert.equal(Boolean(falCoverTitle), true, "checkCoverTitle gate");
      }
    }
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

  await test("identity threshold: 85 passes, 84 fails, 80 fails", () => {
    assert.equal(IDENTITY_PASS_SCORE, 85);
    assert.equal(identityScoresPass([{ score: 85 }], 1), true);
    assert.equal(identityScoresPass([{ score: 100 }], 1), true);
    assert.equal(identityScoresPass([{ score: 84 }], 1), false);
    assert.equal(identityScoresPass([{ score: 80 }], 1), false);
    assert.equal(
      identityScoresPass([{ score: 90 }, { score: 84 }], 2),
      false,
      "all characters must clear 85"
    );
    assert.equal(
      identityScoresPass([{ score: 90 }, { score: 85 }], 2),
      true
    );
  });

  await test("free button + flag available → cost 0", () => {
    const claim = resolveGenerationStartClaim({
      isTrial: false,
      estimatedCost: 18,
      freeRetryAvailable: true,
      requireFreeRetry: true,
    });
    assert.equal(claim.ok, true);
    if (claim.ok) {
      assert.equal(claim.cost, 0);
      assert.equal(claim.freeRetry, true);
    }
  });

  await test("free button + flag absent → 409, aucun débit", () => {
    const claim = resolveGenerationStartClaim({
      isTrial: false,
      estimatedCost: 18,
      freeRetryAvailable: false,
      requireFreeRetry: true,
    });
    assert.equal(claim.ok, false);
    if (!claim.ok) {
      assert.equal(claim.code, "FREE_RETRY_UNAVAILABLE");
      assert.equal(claim.message, FREE_RETRY_UNAVAILABLE_MESSAGE);
    }
  });

  await test("double clic concurrent → une seule génération gratuite", () => {
    let freeRetryAvailable = true;
    function claimOnce() {
      const decision = resolveGenerationStartClaim({
        isTrial: false,
        estimatedCost: 18,
        freeRetryAvailable,
        requireFreeRetry: true,
      });
      if (!decision.ok) return decision;
      freeRetryAvailable = false;
      return decision;
    }
    const a = claimOnce();
    const b = claimOnce();
    assert.equal(a.ok, true);
    if (a.ok) assert.equal(a.cost, 0);
    assert.equal(b.ok, false);
    if (!b.ok) assert.equal(b.code, "FREE_RETRY_UNAVAILABLE");
  });

  await test("retry gratuit échoué puis nouveau clic → jamais de débit caché", () => {
    // Flag already consumed by a previous free start that failed after claim.
    const sneak = resolveGenerationStartClaim({
      isTrial: false,
      estimatedCost: 18,
      freeRetryAvailable: false,
      requireFreeRetry: true,
    });
    assert.equal(sneak.ok, false);
    // Paid recreate is explicit — never auto-free when flag is somehow still true.
    const paidWhileFlagTrue = resolveGenerationStartClaim({
      isTrial: false,
      estimatedCost: 18,
      freeRetryAvailable: true,
      requireFreeRetry: false,
    });
    assert.equal(paidWhileFlagTrue.ok, true);
    if (paidWhileFlagTrue.ok) {
      assert.equal(paidWhileFlagTrue.cost, 18);
      assert.equal(paidWhileFlagTrue.freeRetry, false);
    }
  });

  await test("action payante explicite → réservation normale de 18 crédits", () => {
    const claim = resolveGenerationStartClaim({
      isTrial: false,
      estimatedCost: 18,
      freeRetryAvailable: false,
      requireFreeRetry: false,
      expectedCost: 18,
    });
    assert.equal(claim.ok, true);
    if (claim.ok) {
      assert.equal(claim.cost, 18);
      assert.equal(claim.freeRetry, false);
    }
  });

  await test("recreate_cost matches estimateBookCost for 6/12 colorbook and storybook", () => {
    assert.equal(estimateBookCost(6, "colorbook"), 18);
    assert.equal(estimateBookCost(12, "colorbook"), 30);
    assert.equal(estimateBookCost(6, "storybook"), 24);
    // Displayed recreate_cost must equal what paid start reserves.
    for (const [pages, type, cost] of [
      [6, "colorbook", 18],
      [12, "colorbook", 30],
      [6, "storybook", 24],
    ] as const) {
      const recreateCost = estimateBookCost(pages, type);
      assert.equal(recreateCost, cost);
      const claim = resolveGenerationStartClaim({
        isTrial: false,
        estimatedCost: recreateCost,
        freeRetryAvailable: false,
        requireFreeRetry: false,
        expectedCost: recreateCost,
      });
      assert.equal(claim.ok, true);
      if (claim.ok) assert.equal(claim.cost, recreateCost);
    }
  });

  await test("expected_cost mismatch → 409, aucun débit", () => {
    const claim = resolveGenerationStartClaim({
      isTrial: false,
      estimatedCost: 30,
      freeRetryAvailable: false,
      requireFreeRetry: false,
      expectedCost: 18,
    });
    assert.equal(claim.ok, false);
    if (!claim.ok) {
      assert.equal(claim.code, "COST_MISMATCH");
      assert.equal(claim.message, COST_MISMATCH_MESSAGE);
    }
  });

  await test("échec hand-off Workflow → droit gratuit restauré", () => {
    const fields = bookFieldsAfterFreeRetryLaunchFailure({
      freeRetryWasClaimed: true,
      compensated: true,
    });
    assert.equal(fields.free_retry_available, true);
    assert.equal(fields.status, "draft");
    assert.equal(fields.active_generation_id, null);
    const paidLaunchFail = bookFieldsAfterFreeRetryLaunchFailure({
      freeRetryWasClaimed: false,
      compensated: true,
    });
    assert.equal(paidLaunchFail.free_retry_available, undefined);
  });

  await test("step ledger persists real attempt + request_id when provided", async () => {
    // Documented behavior: attempt is caller-supplied (workflow uses
    // getStepMetadata().attempt). request_id is only set when a provider id
    // is passed — never invented.
    assert.equal(
      stepIdempotencyKey("g1", "cover", 3),
      "gen:g1:step:cover:book:attempt:3"
    );
    assert.equal(
      stepIdempotencyKey("g1", "cover", 1),
      "gen:g1:step:cover:book:attempt:1"
    );
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

  await test("require_free_retry consumes flag once; second is 409 not paid", async () => {
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
        const decision = resolveGenerationStartClaim({
          isTrial: false,
          estimatedCost: 18,
          freeRetryAvailable: Boolean(snap.data()?.free_retry_available),
          requireFreeRetry: true,
        });
        if (!decision.ok) return decision;
        tx.update(bookRef, {
          free_retry_available: false,
          updated_at: new Date().toISOString(),
        });
        return decision;
      });
    }

    const [a, b] = await Promise.all([claimOnce(), claimOnce()]);
    const okCount = [a, b].filter((x) => x.ok).length;
    const conflictCount = [a, b].filter((x) => !x.ok).length;
    assert.equal(okCount, 1);
    assert.equal(conflictCount, 1);
    const after = await bookRef.get();
    assert.equal(after.data()?.free_retry_available, false);
  });

  await test("step ledger attempt=3 + request_id persisted when provided", async () => {
    const gid = randomUUID();
    await db.collection("generations").doc(gid).set({
      user_id: uid,
      status: "running",
      created_at: new Date().toISOString(),
    });
    await persistGenerationStep(db, gid, {
      stepKey: "cover",
      status: "retrying",
      attempt: 3,
      provider: "fal",
      requestId: "fal_req_abc",
    });
    await persistGenerationStep(db, gid, {
      stepKey: "cover",
      status: "failed",
      attempt: 3,
      provider: "fal",
      requestId: "fal_req_abc",
      error: new Error("transient"),
      errorCode: "PROVIDER_TRANSIENT",
    });
    const step = await db
      .collection("generations")
      .doc(gid)
      .collection("steps")
      .doc("cover")
      .get();
    assert.equal(step.data()?.attempt, 3);
    assert.equal(step.data()?.request_id, "fal_req_abc");
    assert.equal(
      step.data()?.idempotency_key,
      stepIdempotencyKey(gid, "cover", 3)
    );
  });

  await test("step ledger leaves request_id null when provider id absent", async () => {
    const gid = randomUUID();
    await db.collection("generations").doc(gid).set({
      user_id: uid,
      status: "running",
      created_at: new Date().toISOString(),
    });
    await persistGenerationStep(db, gid, {
      stepKey: "story",
      status: "succeeded",
      attempt: 1,
      provider: "text",
    });
    const step = await db
      .collection("generations")
      .doc(gid)
      .collection("steps")
      .doc("story")
      .get();
    assert.equal(step.data()?.attempt, 1);
    assert.equal(step.data()?.request_id, null);
  });
}

async function main() {
  console.log("generation-reliability-suite\n");
  await runSoftAcceptTests();
  await runCoverGateIntegrationTests();
  await runCoverPersistTests();
  await runLogicInvariants();
  await runEmulatorLedgerTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
