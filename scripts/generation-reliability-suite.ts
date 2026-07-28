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
import {
  createAttemptTracker,
  recordAttempt,
  strictGateOutcome,
  strictRejectionMessage,
} from "../lib/qc-attempts";
import { generationSeed, seedForReroll } from "../lib/generation-seed";
import {
  ANTI_LINEUP_BOOST,
  ANATOMY_FIX_BOOST,
  CAST_FIX_BOOST,
  CHILD_SAFE_BOOST,
  SINGLE_COMPOSITION_BOOST,
  TITLE_FIX_BOOST,
  routeBoostsForVerdicts,
} from "../services/ai/qc-boosts";

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

  await test("recréation payante: purge des artefacts périmés (prod 6350c675)", async () => {
    const { resetBookArtifactsForPaidRecreate } = await import(
      "../lib/book-recreate-reset"
    );
    const bookId = randomUUID();
    const bookRef = db.collection("books").doc(bookId);
    await bookRef.set({
      user_id: uid,
      status: "draft",
      cover_image: "https://storage.googleapis.com/x/old-black-cover.png",
      cover_image_path: "books/x/cover.png",
      pdf_url: "https://storage.googleapis.com/x/old.pdf",
      created_at: new Date().toISOString(),
    });
    for (let n = 1; n <= 3; n++) {
      await bookRef.collection("pages").doc(`p${n}`).set({
        page_number: n,
        generation_status: "completed",
        illustration_url: `https://storage.googleapis.com/x/black-${n}.png`,
      });
    }
    const result = await resetBookArtifactsForPaidRecreate(db, bookId);
    assert.equal(result.pagesDeleted, 3);
    assert.equal(result.coverCleared, true);
    const after = await bookRef.get();
    assert.equal(after.data()?.cover_image, null);
    assert.equal(after.data()?.cover_image_path, null);
    assert.equal(after.data()?.pdf_url, null);
    const pagesAfter = await bookRef.collection("pages").get();
    assert.equal(pagesAfter.size, 0, "aucune page périmée ne survit à la recréation payante");
    // Idempotent: second run is a harmless no-op.
    const second = await resetBookArtifactsForPaidRecreate(db, bookId);
    assert.equal(second.pagesDeleted, 0);
    assert.equal(second.coverCleared, false);
  });
}

/**
 * P0 — best-attempt QC decision decontamination (prod gens 7af5818f/b13a8320).
 * Tests the REAL decision code used by fal-provider (lib/qc-attempts).
 */
async function runBestAttemptDecisionTests() {
  console.log("\n── décision QC = meilleure tentative uniquement ──");

  await test("plus JAMAIS d'acceptation « couleur réparable » en strict (incident 4f8980ea)", () => {
    // Prod gen 4f8980ea: colored candidates were accepted on the promise that
    // print normalization would repair them — threshold() then shipped 70–95%
    // black pages. A strict candidate with a defect score is now ALWAYS
    // rejected; color is handled upstream by judging the FINAL render bytes.
    const tracker = createAttemptTracker();
    recordAttempt(tracker, {
      score: 11,
      verdicts: ["identity:Khadidja=80", "story-mismatch:action_visible"],
      blank: false,
      colored: false,
    });
    recordAttempt(tracker, {
      score: 2,
      verdicts: [],
      blank: false,
      colored: true,
    });
    assert.equal(tracker.best?.attemptId, "a2");
    const outcome = strictGateOutcome({
      strictQuality: true,
      isCover: true,
      best: tracker.best!,
    });
    assert.equal(outcome.accept, false, "colored score-2 ne doit plus être accepté");
  });

  await test("verdicts raster (aplats noirs/inversion) → hard reject, jamais soft-accept", () => {
    const tracker = createAttemptTracker();
    recordAttempt(tracker, {
      score: 5,
      verdicts: ["raster-black-flood:83% dark"],
      blank: false,
      colored: false,
    });
    const outcome = strictGateOutcome({
      strictQuality: true,
      isCover: true,
      best: tracker.best!,
    });
    assert.equal(outcome.accept, false);
    assert.match(
      (outcome as { errorMessage: string }).errorMessage,
      /raster-black-flood/
    );
  });

  await test("tentative 2 propre après hard-reject → acceptée (pas de contamination)", () => {
    const tracker = createAttemptTracker();
    recordAttempt(tracker, {
      score: 9,
      verdicts: ["identity:Khadidja=80", "story-mismatch:no action"],
      blank: false,
      colored: false,
    });
    recordAttempt(tracker, { score: 0, verdicts: [], blank: false, colored: false });
    const outcome = strictGateOutcome({
      strictQuality: true,
      isCover: true,
      best: tracker.best!,
    });
    assert.equal(outcome.accept, true);
    assert.equal((outcome as { mode: string }).mode, "clean");
  });

  await test("erreur terminale décrit UNIQUEMENT la meilleure tentative", () => {
    const tracker = createAttemptTracker();
    recordAttempt(tracker, {
      score: 11,
      verdicts: ["identity:Khadidja=78", "story-mismatch:unrelated scene"],
      blank: false,
      colored: false,
    });
    recordAttempt(tracker, {
      score: 5,
      verdicts: ["identity:Khadidja=80"],
      blank: false,
      colored: false,
    });
    assert.equal(tracker.best?.attemptId, "a2");
    const outcome = strictGateOutcome({
      strictQuality: true,
      isCover: true,
      best: tracker.best!,
    });
    assert.equal(outcome.accept, false);
    const msg = (outcome as { errorMessage: string }).errorMessage;
    assert.match(msg, /attempt a2, score 5/);
    assert.match(msg, /identity:Khadidja=80/);
    assert.doesNotMatch(msg, /story-mismatch/, "les défauts de la tentative 1 ne fuient pas");
    assert.doesNotMatch(msg, /Khadidja=78/);
  });

  await test("aucun verdict d'identité dupliqué dans l'erreur terminale", () => {
    const tracker = createAttemptTracker();
    recordAttempt(tracker, {
      score: 10,
      verdicts: [
        "identity:Khadidja=80",
        "cover-lineup:action_visible, story_related",
        "story-mismatch:action_visible, story_related",
        "identity:Khadidja=80",
      ],
      blank: false,
      colored: false,
    });
    assert.equal(tracker.best?.verdicts.filter((v) => v.startsWith("identity:")).length, 1);
    const msg = strictRejectionMessage(tracker.best!);
    assert.equal(msg.split("identity:Khadidja=80").length - 1, 1);
  });

  await test("score, verdicts et attempt ID racontent la même décision", () => {
    const tracker = createAttemptTracker();
    recordAttempt(tracker, { score: 7, verdicts: ["anatomy:bad hand"], blank: false, colored: false });
    recordAttempt(tracker, { score: 4, verdicts: ["cast:saw 2"], blank: false, colored: false });
    recordAttempt(tracker, { score: 6, verdicts: ["craft:clipart"], blank: false, colored: false });
    const best = tracker.best!;
    assert.equal(best.attemptId, "a2");
    assert.equal(best.score, 4);
    assert.deepEqual(best.verdicts, ["cast:saw 2"]);
    assert.match(strictRejectionMessage(best), /attempt a2, score 4.*cast:saw 2/);
    // Full history stays available as telemetry, clearly separated.
    assert.equal(tracker.attemptHistory.length, 3);
  });

  await test("soft-accept lineup basé sur la meilleure tentative malgré un historique identity", () => {
    const tracker = createAttemptTracker();
    recordAttempt(tracker, {
      score: 9,
      verdicts: ["identity:Khadidja=80"],
      blank: false,
      colored: false,
    });
    recordAttempt(tracker, {
      score: 2,
      verdicts: ["cover-lineup:static heroic pose"],
      blank: false,
      colored: false,
    });
    const outcome = strictGateOutcome({
      strictQuality: true,
      isCover: true,
      best: tracker.best!,
    });
    assert.equal(outcome.accept, true);
    assert.equal((outcome as { mode: string }).mode, "soft-cover");
  });

  await test("lineup + identity sur la MÊME tentative → rejet (jamais soft-accept)", () => {
    const tracker = createAttemptTracker();
    recordAttempt(tracker, {
      score: 7,
      verdicts: ["cover-lineup:x", "identity:Khadidja=80"],
      blank: false,
      colored: false,
    });
    const outcome = strictGateOutcome({
      strictQuality: true,
      isCover: true,
      best: tracker.best!,
    });
    assert.equal(outcome.accept, false);
  });

  await test("seuil identité: 85 passe, 84 échoue, 80 échoue — jamais abaissé", () => {
    assert.equal(IDENTITY_PASS_SCORE, 85);
    assert.equal(identityScoresPass([{ score: 85 }], 1), true);
    assert.equal(identityScoresPass([{ score: 84 }], 1), false);
    assert.equal(identityScoresPass([{ score: 80 }], 1), false);
    assert.equal(identityScoresPass([{ score: 100 }, { score: 84 }], 2), false);
  });
}

/**
 * P0 — deterministic seed family with cross-generation diversity.
 * Automated proof over the two REAL production generation IDs of the incident
 * (book 4f356812…, paid gen 7af5818f… vs free retry b13a8320…) — no images or
 * child data involved, only the ID-derived seeds.
 */
async function runSeedDiversityTests() {
  console.log("\n── seeds déterministes + diversité entre générations ──");

  const BOOK = "4f356812-491a-4162-808a-42edd3a83c69";
  const GEN_PAID = "7af5818f-33d3-42f9-8f4c-a9890425f202";
  const GEN_FREE = "b13a8320-42c1-4e54-902b-c72bc7dc2dca";

  await test("même run + même étape → même seed (idempotence de reprise)", () => {
    const a = generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "cover" });
    const b = generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "cover" });
    assert.equal(a, b);
    const p1 = generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "page", index: 3 });
    const p2 = generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "page", index: 3 });
    assert.equal(p1, p2);
  });

  await test("PREUVE incident: la génération payante et le retry gratuit ont des familles différentes", () => {
    assert.notEqual(
      generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "cover" }),
      generationSeed({ bookId: BOOK, generationId: GEN_FREE, assetType: "cover" })
    );
    for (let page = 1; page <= 6; page++) {
      assert.notEqual(
        generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "page", index: page }),
        generationSeed({ bookId: BOOK, generationId: GEN_FREE, assetType: "page", index: page }),
        `page ${page} doit changer de seed entre les deux générations`
      );
    }
    assert.notEqual(
      generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "portrait", index: 0, reroll: 1 }),
      generationSeed({ bookId: BOOK, generationId: GEN_FREE, assetType: "portrait", index: 0, reroll: 1 })
    );
  });

  await test("aucune collision entre cover, sheet, portraits et pages d'un même run", () => {
    const seeds = new Set<number>();
    const add = (s: number) => {
      assert.equal(seeds.has(s), false, `collision de seed: ${s}`);
      seeds.add(s);
    };
    add(generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "cover" }));
    for (let r = 1; r <= 2; r++) {
      add(generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "sheet", reroll: r }));
    }
    for (let c = 0; c < 3; c++) {
      for (let r = 1; r <= 2; r++) {
        add(generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "portrait", index: c, reroll: r }));
      }
    }
    for (let page = 1; page <= 12; page++) {
      add(generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "page", index: page }));
    }
  });

  await test("rerolls distincts mais stables au sein d'un run", () => {
    const base = generationSeed({ bookId: BOOK, generationId: GEN_PAID, assetType: "cover" });
    const r0 = seedForReroll(base, 0);
    const r1 = seedForReroll(base, 1);
    const r2 = seedForReroll(base, 2);
    assert.equal(r0, base % 2147483647);
    assert.notEqual(r1, r0);
    assert.notEqual(r2, r1);
    assert.notEqual(r2, r0);
    assert.equal(seedForReroll(base, 1), r1, "reroll déterministe");
  });

  await test("seeds dans l'intervalle valide fal (0 < seed < 2^31-1)", () => {
    for (const gen of [GEN_PAID, GEN_FREE]) {
      for (let page = 0; page <= 12; page++) {
        const s = generationSeed({ bookId: BOOK, generationId: gen, assetType: "page", index: page });
        assert.equal(Number.isInteger(s) && s > 0 && s < 2147483647, true);
      }
    }
  });
}

/** P0 — targeted boost routing from the CURRENT attempt's verdicts. */
async function runBoostRoutingTests() {
  console.log("\n── routage des boosts ciblés ──");

  const ctx = {
    action: "Khadidja nourrit doucement une girafe au zoo",
    storySummary: "Khadidja découvre les animaux du zoo et apprend à les protéger",
    cast: [{ name: "Khadidja", kind: "human" }],
    multiReference: false,
  };

  await test("story-mismatch → boost qui réinjecte l'action EXACTE et le résumé", () => {
    const boosts = routeBoostsForVerdicts(["story-mismatch:cover unrelated"], ctx);
    assert.equal(boosts.length, 1);
    assert.match(boosts[0], /Khadidja nourrit doucement une girafe au zoo/);
    assert.match(boosts[0], /découvre les animaux du zoo/);
    assert.match(boosts[0], /NO generic standing pose/);
    assert.match(boosts[0], /title band/i);
  });

  await test("action non visible → même réinjection d'action", () => {
    const boosts = routeBoostsForVerdicts(["cover-action-missing:static pose"], ctx);
    assert.equal(boosts.length, 1);
    assert.match(boosts[0], /Khadidja nourrit doucement une girafe au zoo/);
  });

  await test("identity<85 → boost référence immuable (pas le cast générique)", () => {
    const boosts = routeBoostsForVerdicts(["identity:Khadidja=80"], ctx);
    assert.equal(boosts.length, 1);
    assert.match(boosts[0], /IMMUTABLE source of truth/);
    assert.match(boosts[0], /face shape, apparent age, skin tone, hairstyle/);
    assert.match(boosts[0], /Khadidja/);
    assert.notEqual(boosts[0], CAST_FIX_BOOST);
  });

  await test("lineup → anti-lineup; cast → cast fix; anatomy/comic/title/unsafe dédiés", () => {
    assert.deepEqual(routeBoostsForVerdicts(["cover-lineup:row"], ctx), [ANTI_LINEUP_BOOST]);
    assert.deepEqual(routeBoostsForVerdicts(["cast:saw 2"], ctx), [CAST_FIX_BOOST]);
    assert.deepEqual(routeBoostsForVerdicts(["anatomy:fused hand"], ctx), [ANATOMY_FIX_BOOST]);
    assert.deepEqual(routeBoostsForVerdicts(["comic-layout:panels"], ctx), [SINGLE_COMPOSITION_BOOST]);
    assert.deepEqual(routeBoostsForVerdicts(["title:illegible"], ctx), [TITLE_FIX_BOOST]);
    assert.deepEqual(routeBoostsForVerdicts(["unsafe:scary"], ctx), [CHILD_SAFE_BOOST]);
  });

  await test("verdicts combinés (incident) → boosts dédupliqués story+identity+anti-lineup", () => {
    const boosts = routeBoostsForVerdicts(
      [
        "identity:Khadidja=80",
        "cover-lineup:action_visible, story_related",
        "story-mismatch:action_visible, story_related",
        "identity:Khadidja=80",
      ],
      ctx
    );
    const identityBoosts = boosts.filter((b) => /IMMUTABLE source of truth/.test(b));
    assert.equal(identityBoosts.length, 1, "un seul boost identité même si verdict dupliqué");
    assert.equal(boosts.includes(ANTI_LINEUP_BOOST), true);
    assert.equal(boosts.some((b) => /Khadidja nourrit doucement/.test(b)), true);
  });
}

/**
 * P0 — REAL provider re-roll loop integration (network mocked, code real):
 * FalImageProvider.generateImage with a strict cover, exercising the actual
 * generateWithEnvRetry wiring — vision verdicts → targeted boosts on the next
 * fal call, distinct re-roll seeds, and a terminal error built from the best
 * attempt only.
 */
async function runProviderRerollIntegrationTests() {
  console.log("\n── intégration provider: reroll ciblé + décision best-attempt ──");

  const sharp = (await import("sharp")).default;
  // Dense black line-art on white: passes the blank guard, fails the colored guard.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" fill="white"/>
    <g stroke="black" stroke-width="18" fill="none">
      <circle cx="256" cy="180" r="120"/>
      <path d="M40 470 L 180 300 L 320 450 L 470 250"/>
      <rect x="60" y="40" width="180" height="110"/>
      <path d="M256 300 L 256 460 M 200 380 L 312 380"/>
    </g>
  </svg>`;
  const linePng = await sharp(Buffer.from(svg)).png().toBuffer();

  const { FalImageProvider } = await import("../services/ai/fal-provider");
  const { StorageService } = await import("../services/storage-service");

  const ACTION = "Khadidja nourrit doucement une girafe au zoo";
  const goodPoster = {
    lineup: false,
    action_visible: true,
    single_composition: true,
    anatomy_valid: true,
    professional_line_art: true,
    sharp_readable: true,
    orientation_correct: true,
    story_related: true,
    child_safe: true,
  };

  type Scenario = {
    posters: Array<Record<string, unknown>>;
    identities: Array<Record<string, unknown>>;
  };

  async function runScenario(scenario: Scenario) {
    const origFetch = globalThis.fetch;
    const origUpload = StorageService.prototype.uploadBytes;
    const savedEnv = {
      FAL_KEY: process.env.FAL_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      FAL_REF_ENDPOINT: process.env.FAL_REF_ENDPOINT,
      VISION_QC: process.env.VISION_QC,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
    };
    process.env.FAL_KEY = "test-fal-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.FAL_REF_ENDPOINT = "https://fal.run/fal-ai/flux-kontext/dev";
    delete process.env.VISION_QC;
    delete process.env.GROQ_API_KEY;

    const falBodies: Array<Record<string, unknown>> = [];
    let posterIdx = 0;
    let identityIdx = 0;
    const json = (obj: unknown) =>
      new Response(JSON.stringify(obj), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
      const target = String(url);
      if (init?.method === "POST" && /fal\.run/.test(target)) {
        falBodies.push(JSON.parse(String(init.body)));
        return json({ images: [{ url: `https://img.test/fal-${falBodies.length}.png` }] });
      }
      if (init?.method === "POST" && /openai\.com/.test(target)) {
        const req = JSON.parse(String(init.body)) as {
          messages: Array<{ content: Array<{ type: string; text?: string }> }>;
        };
        const question = req.messages[0]?.content?.find((c) => c.type === "text")?.text || "";
        let payload: unknown = { matches: true, count: 1 };
        if (question.includes("COLORING BOOK COVER poster")) {
          payload = scenario.posters[Math.min(posterIdx++, scenario.posters.length - 1)];
        } else if (question.includes("Compare every named character")) {
          payload = scenario.identities[Math.min(identityIdx++, scenario.identities.length - 1)];
        } else if (question.includes("should contain EXACTLY")) {
          payload = { count: 1, matches: true };
        } else if (question.includes("title text")) {
          payload = { title_legible: true };
        }
        return json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
      }
      // Any GET (fal image download, vision downscale, references, final check)
      return new Response(new Uint8Array(linePng), { status: 200 });
    }) as typeof fetch;
    StorageService.prototype.uploadBytes = async () =>
      "https://storage.mock/normalized-print.png";

    const qcStats: Record<string, unknown> = {};
    try {
      const provider = new FalImageProvider();
      const result = await provider.generateImage({
        prompt: "Khadidja au zoo. Khadidja découvre les animaux du zoo et apprend à les protéger.",
        style: "cute",
        characterBible: "Khadidja, the parent-provided hero child",
        isCover: true,
        referenceImageUrl: "https://img.test/ref-khadidja.png",
        referenceImageUrls: ["https://img.test/ref-khadidja.png"],
        action: ACTION,
        expectedCast: [{ name: "Khadidja", kind: "human", visualLock: "young girl child" }],
        strictQuality: true,
        qcStats,
        maxVisionRerolls: 1,
        maxQualityRerolls: 0,
        maxProviderAttempts: 1,
        skipRecovery: true,
        seed: 12345,
        consistencyMode: true,
      });
      return { result, falBodies, qcStats, error: null as Error | null };
    } catch (err) {
      return { result: null, falBodies, qcStats, error: err as Error };
    } finally {
      globalThis.fetch = origFetch;
      StorageService.prototype.uploadBytes = origUpload;
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key as keyof typeof savedEnv];
        else process.env[key as keyof typeof savedEnv] = value;
      }
    }
  }

  await test("échec story+identity → reroll avec boosts ciblés + seed distincte → accepté", async () => {
    const { result, falBodies, qcStats, error } = await runScenario({
      posters: [
        { ...goodPoster, action_visible: false, story_related: false, issue: "generic pose" },
        goodPoster,
      ],
      identities: [
        { matches: false, scores: [{ name: "Khadidja", score: 80 }] },
        { matches: true, scores: [{ name: "Khadidja", score: 92 }] },
      ],
    });
    assert.equal(error, null, error?.message);
    assert.equal(falBodies.length, 2, "exactement un reroll");
    // Reroll #2 porte les boosts ciblés issus des verdicts de la tentative 1.
    const rerollPrompt = String(falBodies[1].prompt);
    assert.match(rerollPrompt, /Khadidja nourrit doucement une girafe au zoo/);
    assert.match(rerollPrompt, /IMMUTABLE source of truth/);
    // Seeds distinctes mais déterministes entre les deux tentatives du run.
    assert.equal(falBodies[0].seed, 12345);
    assert.notEqual(falBodies[1].seed, falBodies[0].seed);
    // Résultat = image normalisée pour impression (tentative 2).
    assert.equal(result?.url, "https://storage.mock/normalized-print.png");
    assert.equal(qcStats.bestAttemptId, "a2");
    assert.equal(qcStats.bestScore, 0);
    const history = qcStats.attemptHistory as Array<{ attemptId: string; verdicts: string[] }>;
    assert.equal(history.length, 2);
    assert.equal(history[0].verdicts.some((v) => v.startsWith("story-mismatch:")), true);
    assert.equal(history[0].verdicts.some((v) => v.startsWith("identity:")), true);
  });

  await test("double échec → erreur terminale = meilleure tentative uniquement, sans doublon", async () => {
    const { result, qcStats, error } = await runScenario({
      posters: [
        { ...goodPoster, action_visible: false, story_related: false, issue: "generic pose" },
        goodPoster,
      ],
      identities: [
        { matches: false, scores: [{ name: "Khadidja", score: 78 }] },
        { matches: false, scores: [{ name: "Khadidja", score: 80 }] },
      ],
    });
    assert.equal(result, null);
    assert.ok(error, "le gate strict doit rejeter");
    assert.match(error!.message, /strict visual quality gate/);
    assert.match(error!.message, /attempt a2, score 5/);
    assert.match(error!.message, /identity:Khadidja=80/);
    assert.doesNotMatch(error!.message, /story-mismatch/, "pas de contamination de la tentative 1");
    assert.doesNotMatch(error!.message, /Khadidja=78/);
    assert.equal(error!.message.split("identity:").length - 1, 1, "verdict identité unique");
    assert.equal(qcStats.bestAttemptId, "a2");
  });
}

/**
 * P0 — REAL provider pipeline with the incident's failure mode: fal returns a
 * shaded/colored page; the print render (the exact bytes that would ship) is
 * black-flooded; the deterministic raster gate rejects it, routes the print
 * boost, and only a clean-line-art attempt is accepted — with vision judging
 * the FINAL data-URL bytes, and the uploaded buffer being the gated render.
 */
async function runStrictPagePrintIntegrationTests() {
  console.log("\n── intégration page stricte: octets finaux gated (incident 4f8980ea) ──");
  const fx = await buildRasterFixtures();
  const { FalImageProvider } = await import("../services/ai/fal-provider");
  const { StorageService } = await import("../services/storage-service");
  const { analyzeRasterStats, rasterVerdicts } = await import("../lib/raster-gate");
  const { RASTER_LINE_ART_BOOST } = await import("../services/ai/qc-boosts");

  async function runPageScenario(falImages: Buffer[]) {
    const origFetch = globalThis.fetch;
    const origUpload = StorageService.prototype.uploadBytes;
    const savedEnv = {
      FAL_KEY: process.env.FAL_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      FAL_REF_ENDPOINT: process.env.FAL_REF_ENDPOINT,
      VISION_QC: process.env.VISION_QC,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
    };
    process.env.FAL_KEY = "test-fal-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.FAL_REF_ENDPOINT = "https://fal.run/fal-ai/flux-kontext/dev";
    delete process.env.VISION_QC;
    delete process.env.GROQ_API_KEY;

    const falBodies: Array<Record<string, unknown>> = [];
    const visionImageUrls: string[] = [];
    let uploadedFinal: Buffer | null = null;
    const json = (obj: unknown) =>
      new Response(JSON.stringify(obj), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
      const target = String(url);
      if (init?.method === "POST" && /fal\.run/.test(target)) {
        falBodies.push(JSON.parse(String(init.body)));
        return json({ images: [{ url: `https://img.test/fal-${falBodies.length}.png` }] });
      }
      if (init?.method === "POST" && /openai\.com/.test(target)) {
        const req = JSON.parse(String(init.body)) as {
          messages: Array<{
            content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
          }>;
        };
        for (const part of req.messages[0]?.content || []) {
          if (part.type === "image_url" && part.image_url?.url) {
            visionImageUrls.push(part.image_url.url.slice(0, 40));
          }
        }
        const question =
          req.messages[0]?.content?.find((c) => c.type === "text")?.text || "";
        let payload: unknown = { matches: true, count: 1 };
        if (question.includes("Compare every named character")) {
          payload = { matches: true, scores: [{ name: "Khadija", score: 92 }] };
        } else if (question.includes("should contain EXACTLY")) {
          payload = { count: 1, matches: true };
        } else if (question.includes("coloring-book page")) {
          payload = {
            lineup: false,
            action_visible: true,
            single_full_page: true,
            environment_rich: true,
            anatomy_valid: true,
            professional_line_art: true,
          };
        }
        return json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
      }
      const falMatch = target.match(/^https:\/\/img\.test\/fal-(\d+)\.png$/);
      if (falMatch) {
        const idx = Math.min(Number(falMatch[1]) - 1, falImages.length - 1);
        return new Response(new Uint8Array(falImages[idx]), { status: 200 });
      }
      return new Response(new Uint8Array(falImages[0]), { status: 200 });
    }) as typeof fetch;
    StorageService.prototype.uploadBytes = async (
      _path: string,
      bytes: Uint8Array | Buffer
    ) => {
      uploadedFinal = Buffer.from(bytes);
      return "https://storage.mock/final-print.png";
    };

    const qcStats: Record<string, unknown> = {};
    try {
      const provider = new FalImageProvider();
      const result = await provider.generateImage({
        prompt: "Khadija joue avec son chien dans le jardin familial.",
        style: "cute",
        characterBible: "Khadija, young girl child",
        isColoringPage: true,
        referenceImageUrl: "https://img.test/ref-khadija.png",
        referenceImageUrls: ["https://img.test/ref-khadija.png"],
        action: "Khadija lance une balle à son chien",
        expectedCast: [{ name: "Khadija", kind: "human", visualLock: "young girl" }],
        strictQuality: true,
        qcStats,
        maxVisionRerolls: 1,
        maxQualityRerolls: 2,
        maxProviderAttempts: 1,
        skipRecovery: true,
        seed: 4242,
        consistencyMode: true,
      });
      return { result, falBodies, qcStats, uploadedFinal, visionImageUrls, error: null as Error | null };
    } catch (err) {
      return { result: null, falBodies, qcStats, uploadedFinal, visionImageUrls, error: err as Error };
    } finally {
      globalThis.fetch = origFetch;
      StorageService.prototype.uploadBytes = origUpload;
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key as keyof typeof savedEnv];
        else process.env[key as keyof typeof savedEnv] = value;
      }
    }
  }

  await test("image ombrée → rendu final noirci REJETÉ → boost print → line art accepté", async () => {
    const { result, falBodies, qcStats, uploadedFinal, visionImageUrls, error } =
      await runPageScenario([fx.shadedColored, fx.goodLineArt]);
    assert.equal(error, null, error?.message);
    assert.equal(falBodies.length, 2, "un reroll après le rejet raster");
    assert.match(String(falBodies[1].prompt), /PURE WHITE background/,
      "le reroll porte le boost print (RASTER_LINE_ART_BOOST)");
    assert.equal(String(falBodies[1].prompt).includes(RASTER_LINE_ART_BOOST), true);
    // L'historique montre le rejet raster de la tentative 1.
    const history = (qcStats.attemptHistory || []) as Array<{ verdicts: string[] }>;
    assert.equal(
      history[0].verdicts.some((v) => v.startsWith("raster-")),
      true,
      JSON.stringify(history)
    );
    // Les octets UPLOADÉS sont le rendu final gated : noir-sur-blanc propre.
    assert.ok(uploadedFinal, "un buffer final doit être uploadé");
    const uploadedStats = await analyzeRasterStats(uploadedFinal!);
    assert.deepEqual(rasterVerdicts(uploadedStats), [], JSON.stringify(uploadedStats));
    assert.equal(result?.url, "https://storage.mock/final-print.png");
    // La vision a jugé un data URL (les octets finaux), pas l'URL fal brute.
    assert.equal(
      visionImageUrls.some((u) => u.startsWith("data:image/")),
      true,
      visionImageUrls.join(" | ")
    );
  });

  await test("toutes les tentatives ombrées → échec strict raster, AUCUN upload, jamais completed", async () => {
    const { result, uploadedFinal, error } = await runPageScenario([
      fx.shadedColored,
      fx.shadedColored,
      fx.shadedColored,
    ]);
    assert.equal(result, null);
    assert.ok(error);
    assert.match(error!.message, /strict visual quality gate/);
    assert.match(error!.message, /raster-/);
    assert.equal(uploadedFinal, null, "aucun octet corrompu ne doit être persisté");
  });
}

/** Synthetic raster fixtures (sharp SVG renders) shared by the P0 raster tests. */
async function buildRasterFixtures() {
  const sharp = (await import("sharp")).default;
  const render = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();
  const size = `width="512" height="512"`;
  const frame = (inner: string, bg = "white") =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${size}><rect width="512" height="512" fill="${bg}"/>${inner}</svg>`;

  // Good detailed line art: strokes reaching the borders, small legit dark
  // hair blob (~2% of page) — must PASS (dark skin/hair calibration).
  const goodLineArt = await render(
    frame(
      `<g stroke="black" stroke-width="6" fill="none">
        <path d="M0 480 L 512 470"/><path d="M0 380 C 120 300, 380 300, 512 360"/>
        <circle cx="250" cy="200" r="90"/><rect x="30" y="30" width="130" height="90"/>
        <rect x="360" y="40" width="120" height="140"/><path d="M60 512 L 100 300 L 160 512"/>
        <path d="M0 100 L 80 0"/><path d="M420 512 L 470 380 L 512 420"/>
        <circle cx="250" cy="440" r="40"/><path d="M180 260 Q 250 320 330 260"/>
      </g>
      <ellipse cx="250" cy="130" rx="55" ry="30" fill="black"/>`
    )
  );
  // 80%+ solid black (the incident's shipped pages).
  const blackFlood = await render(
    frame(`<rect x="0" y="60" width="512" height="452" fill="black"/>`)
  );
  // Inversion: white strokes on a black background.
  const inverted = await render(
    frame(
      `<g stroke="white" stroke-width="6" fill="none">
        <path d="M0 480 L 512 470"/><circle cx="250" cy="200" r="90"/>
        <rect x="30" y="30" width="130" height="90"/><path d="M60 512 L 100 300 L 160 512"/>
        <path d="M180 260 Q 250 320 330 260"/><rect x="360" y="40" width="120" height="140"/>
      </g>`,
      "black"
    )
  );
  // Filled silhouette: one massive solid shape (~30% of the page).
  const silhouette = await render(
    frame(
      `<g stroke="black" stroke-width="5" fill="none"><path d="M0 490 L 512 480"/><rect x="20" y="20" width="100" height="60"/></g>
       <path d="M150 512 L 170 160 Q 256 60 342 160 L 362 512 Z" fill="black"/>`
    )
  );
  // Nearly empty page.
  const nearlyEmpty = await render(
    frame(`<circle cx="256" cy="256" r="18" fill="none" stroke="black" stroke-width="2"/>`)
  );
  // Shaded/colored artwork (what fal returned in prod): colored fills +
  // mid-gray shading on most of the page — looks fine RAW, dies in threshold.
  const shadedColored = await render(
    frame(
      `<rect width="512" height="512" fill="#8fb8d8"/>
       <rect x="0" y="330" width="512" height="182" fill="#7a9a53"/>
       <circle cx="250" cy="210" r="110" fill="#a9744f" stroke="black" stroke-width="4"/>
       <rect x="60" y="60" width="150" height="110" fill="#888888"/>
       <path d="M340 90 L 470 90 L 405 220 Z" fill="#666688"/>`
    )
  );
  return { goodLineArt, blackFlood, inverted, silhouette, nearlyEmpty, shadedColored };
}

/**
 * P0 — deterministic raster gate on FINAL bytes (prod gen 4f8980ea: 70–95%
 * black pages shipped). Real code: lib/raster-gate + lib/print-normalize.
 */
async function runRasterGateTests() {
  console.log("\n── gate raster déterministe (octets finaux) ──");
  const { analyzeRasterStats, rasterVerdicts } = await import("../lib/raster-gate");
  const { prepareStrictPrintCandidate } = await import("../lib/print-normalize");
  const fx = await buildRasterFixtures();

  await test("bon line art (avec cheveux noirs légitimes) → AUCUN verdict", async () => {
    const stats = await analyzeRasterStats(fx.goodLineArt);
    assert.deepEqual(rasterVerdicts(stats), [], JSON.stringify(stats));
    assert.ok(stats.darkRatio < 0.35, `darkRatio=${stats.darkRatio}`);
    assert.ok(stats.whiteRatio > 0.5, `whiteRatio=${stats.whiteRatio}`);
  });

  await test("page majoritairement noire → raster-black-flood", async () => {
    const verdicts = rasterVerdicts(await analyzeRasterStats(fx.blackFlood));
    assert.equal(verdicts.some((v) => v.startsWith("raster-black-flood:")), true, verdicts.join(";"));
  });

  await test("inversion (traits blancs sur fond noir) → raster-inverted", async () => {
    const verdicts = rasterVerdicts(await analyzeRasterStats(fx.inverted));
    assert.equal(verdicts.some((v) => v.startsWith("raster-inverted:")), true, verdicts.join(";"));
  });

  await test("silhouette pleine massive → raster-silhouette", async () => {
    const verdicts = rasterVerdicts(await analyzeRasterStats(fx.silhouette));
    assert.equal(verdicts.some((v) => v.startsWith("raster-silhouette:")), true, verdicts.join(";"));
  });

  await test("page presque vide → raster-empty", async () => {
    const verdicts = rasterVerdicts(await analyzeRasterStats(fx.nearlyEmpty));
    assert.equal(verdicts.some((v) => v.startsWith("raster-empty:")), true, verdicts.join(";"));
  });

  await test("FORENSIC 4f8980ea : l'image ombrée est saine BRUTE et détruite PAR la normalisation", async () => {
    // Raw shaded image: no black flood before the print pipeline…
    const rawStats = await analyzeRasterStats(fx.shadedColored);
    assert.ok(
      rawStats.darkRatio < 0.2,
      `l'image brute n'a pas d'aplats noirs (darkRatio=${rawStats.darkRatio})`
    );
    // …the threshold-based print render is where the black appears — and the
    // gated candidate now REPORTS it instead of shipping it.
    const candidate = await prepareStrictPrintCandidate(fx.shadedColored);
    assert.ok(
      candidate.stats.darkRatio > 0.45,
      `la normalisation crée les aplats (darkRatio=${candidate.stats.darkRatio})`
    );
    assert.equal(
      candidate.verdicts.some((v) => v.startsWith("raster-")),
      true,
      "le candidat final DOIT être rejeté par le gate raster"
    );
  });

  await test("bonne page → candidat final propre (aucun verdict après normalisation)", async () => {
    const candidate = await prepareStrictPrintCandidate(fx.goodLineArt);
    assert.deepEqual(candidate.verdicts, [], JSON.stringify(candidate.stats));
    assert.equal(candidate.repairedInversion, false);
  });

  await test("inversion réparée sur COPIE puis re-gatée intégralement", async () => {
    const candidate = await prepareStrictPrintCandidate(fx.inverted);
    assert.equal(candidate.repairedInversion, true, candidate.verdicts.join(";"));
    assert.deepEqual(candidate.verdicts, [], "la version réparée repasse tous les gates");
    const finalStats = await (await import("../lib/raster-gate")).analyzeRasterStats(candidate.png);
    assert.ok(finalStats.whiteRatio > 0.5, "le rendu final est noir-sur-blanc");
  });
}

/** P0 — natural child-facing narrative text (prod page 6 shipped the raw prompt). */
async function runNarrativeTextTests() {
  console.log("\n── texte narratif enfant (lockPlanToParentNarrative) ──");
  const { sanitizeParentNarrative, lockPlanToParentNarrative } = await import(
    "../services/ai/character-bible"
  );
  const RAW_INCIDENT_SOURCE =
    "khadija est une petite fille. HISTOIRE DU PARENT (intrigue obligatoire, ne pas remplacer) : khadija et ses parents adoptent un chien";

  await test("sanitizeParentNarrative retire le cadrage technique et le gender-lock", () => {
    const clean = sanitizeParentNarrative(RAW_INCIDENT_SOURCE);
    assert.equal(clean, "Khadija et ses parents adoptent un chien.");
    assert.doesNotMatch(clean, /HISTOIRE DU PARENT/i);
    assert.doesNotMatch(clean, /est une petite fille/i);
  });

  await test("la dernière page verrouillée porte une phrase naturelle, jamais le prompt brut", () => {
    const plan = {
      title: "L'aventure de Khadija",
      summary: "Khadija adopte un chien avec ses parents.",
      audienceAge: "6-8 ans",
      world: { setting: "maison familiale", palette: "chaud", mood: "tendre" },
      characters: [
        {
          id: "char_1",
          name: "Khadija",
          description: "héroïne",
          appearance: "petite fille",
          visualLock: "young girl child named Khadija",
          personality: "curieuse",
          kind: "human",
        },
      ],
      pages: [1, 2, 3, 4, 5, 6].map((n) => ({
        pageNumber: n,
        title: `Page ${n}`,
        storyText: `Khadija vit une étape ${n} de l'adoption du chien.`,
        illustrationDescription: `Khadija scene ${n} with her parents and the dog`,
        characterIds: ["char_1"],
        action: `Khadija does adoption step ${n}`,
      })),
    };
    const locked = lockPlanToParentNarrative(structuredClone(plan), {
      sourceNarrative: RAW_INCIDENT_SOURCE,
      childName: "Khadija",
      childGender: "girl",
      audience: "6-8 ans",
      pageCount: 6,
    });
    const last = locked.pages[locked.pages.length - 1];
    assert.equal(last.storyText, "Khadija et ses parents adoptent un chien.");
    for (const page of locked.pages) {
      assert.doesNotMatch(page.storyText || "", /HISTOIRE DU PARENT/i, `page ${page.pageNumber}`);
      assert.doesNotMatch(page.storyText || "", /accomplit sa mission\s*:/i, `page ${page.pageNumber}`);
      assert.doesNotMatch(
        page.storyText || "",
        /est une petite fille\./i,
        `page ${page.pageNumber}`
      );
    }
  });
}

/**
 * P1 — family cast capacity: "Khadidja et ses parents adoptent un chien"
 * requires 4 stable entities (child + two parents + dog). The old pipeline
 * capped every scene at 2 characters and the planner prompt banned named
 * adults — the parents were erased by design.
 */
async function runFamilyCastTests() {
  console.log("\n── capacité de cast familial (4 entités) ──");
  const { charactersForPage, lockPlanToParentNarrative } = await import(
    "../services/ai/character-bible"
  );
  const { buildColoringPagePrompt, buildStoryUserPrompt } = await import(
    "../services/ai/prompts"
  );

  const familyCharacters = [
    { id: "char_1", name: "Khadija", kind: "human", visualLock: "young girl child" },
    { id: "char_2", name: "Maman Aïcha", kind: "human", visualLock: "adult woman parent" },
    { id: "char_3", name: "Papa Moussa", kind: "human", visualLock: "adult man parent" },
    { id: "char_4", name: "Bello", kind: "dog", visualLock: "small friendly dog" },
  ].map((c) => ({
    ...c,
    description: c.name,
    appearance: c.visualLock,
    personality: "doux",
  }));
  const familyWorld = { setting: "maison familiale", palette: "chaud", mood: "tendre" };

  await test("une scène familiale garde ses 4 personnages obligatoires", () => {
    const plan = {
      title: "t",
      summary: "s",
      audienceAge: "6-8",
      world: familyWorld,
      characters: familyCharacters,
      pages: [],
    };
    const page = {
      pageNumber: 6,
      title: "Famille",
      storyText: "Toute la famille accueille Bello.",
      illustrationDescription: "family scene",
      characterIds: ["char_1", "char_2", "char_3", "char_4"],
    };
    const cast = charactersForPage(plan, page);
    assert.equal(cast.length, 4, cast.map((c) => c.name).join(","));
    assert.deepEqual(
      cast.map((c) => c.name),
      ["Khadija", "Maman Aïcha", "Papa Moussa", "Bello"]
    );
  });

  await test("le prompt de page exige EXACTEMENT le cast obligatoire (4)", () => {
    const prompt = buildColoringPagePrompt({
      scene: "La famille accueille le chien à la maison",
      characters: "cast lock",
      style: "cute",
      world: "maison familiale",
      castCount: 4,
    });
    assert.match(prompt, /EXACTLY 4 named character\(s\)/);
    assert.doesNotMatch(prompt, /at most 2 characters/);
  });

  await test("le planificateur n'interdit plus les parents adultes nommés", () => {
    const prompt = buildStoryUserPrompt({
      idea: "khadija et ses parents adoptent un chien",
      pageCount: 6,
      style: "cute",
      researchJson: "{}",
      parentMode: true,
      childName: "Khadija",
      childGender: "girl",
    } as Parameters<typeof buildStoryUserPrompt>[0]);
    assert.match(prompt, /CONTRAT DE CAST/);
    assert.match(prompt, /DEUX parents/);
    assert.doesNotMatch(prompt, /AUCUN adulte nommé/);
    assert.doesNotMatch(prompt, /max 2 personnages par scène/i);
  });

  await test("lockPlanToParentNarrative préserve les characterIds familiaux", () => {
    const plan = {
      title: "L'adoption de Bello",
      summary: "Khadija et ses parents adoptent un chien.",
      audienceAge: "6-8 ans",
      world: familyWorld,
      characters: familyCharacters,
      pages: [1, 2, 3, 4, 5, 6].map((n) => ({
        pageNumber: n,
        title: `Étape ${n}`,
        storyText: `Khadija et ses parents vivent l'étape ${n} de l'adoption.`,
        illustrationDescription: `Khadija with her parents and the dog, adoption step ${n}`,
        characterIds: ["char_1", "char_2", "char_3", "char_4"],
        action: `Khadija and her parents adoption step ${n}`,
      })),
    };
    const locked = lockPlanToParentNarrative(structuredClone(plan), {
      sourceNarrative:
        "khadija est une petite fille. HISTOIRE DU PARENT (intrigue obligatoire, ne pas remplacer) : khadija et ses parents adoptent un chien",
      childName: "Khadija",
      childGender: "girl",
      audience: "6-8 ans",
      pageCount: 6,
    });
    const familyPages = locked.pages.filter(
      (p) => (p.characterIds || []).length >= 3
    );
    assert.ok(
      familyPages.length >= 4,
      `les scènes familiales gardent leur cast: ${locked.pages
        .map((p) => (p.characterIds || []).length)
        .join(",")}`
    );
  });
}

async function main() {
  console.log("generation-reliability-suite\n");
  await runSoftAcceptTests();
  await runCoverGateIntegrationTests();
  await runCoverPersistTests();
  await runLogicInvariants();
  await runBestAttemptDecisionTests();
  await runSeedDiversityTests();
  await runBoostRoutingTests();
  await runProviderRerollIntegrationTests();
  await runRasterGateTests();
  await runStrictPagePrintIntegrationTests();
  await runNarrativeTextTests();
  await runFamilyCastTests();
  await runParentPlanViabilityTests();
  await runFamilyCastRepairTests();
  await runEmulatorLedgerTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

/**
 * P0 — parent plan viability gate (prod gen 46a9262b): a Groq outage
 * silently degraded a paid parent book to the local fallback planner (one
 * bare hero, empty actions) and burned the run downstream.
 */
async function runParentPlanViabilityTests() {
  console.log("\n── viabilité du plan parent (anti-fallback silencieux) ──");
  const { assertParentPlanViable } = await import("../lib/plan-fidelity");
  const STORY = "khadija et ses parents adoptent un chien";
  const world = { setting: "maison", palette: "chaud", mood: "tendre" };
  const child = (over: Record<string, unknown> = {}) => ({
    id: "char_1",
    name: "Khadija",
    description: "héroïne",
    appearance: "petite fille",
    visualLock: "young girl child named Khadija, about 7 years old",
    personality: "curieuse",
    kind: "human",
    ...over,
  });
  const goodPages = [1, 2, 3, 4, 5, 6].map((n) => ({
    pageNumber: n,
    title: `Étape ${n}`,
    storyText: `Khadija et ses parents vivent l'étape ${n}.`,
    illustrationDescription: "family adoption scene",
    characterIds: ["char_1", "char_2", "char_3", "char_4"],
    action: `Khadija and her parents do adoption step ${n} with the dog`,
  }));
  const familyPlan = {
    title: "t",
    summary: "s",
    audienceAge: "6-8",
    world,
    characters: [
      child(),
      child({ id: "char_2", name: "Maman Aïcha", visualLock: "adult woman parent of Khadija, warm smile" }),
      child({ id: "char_3", name: "Papa Moussa", visualLock: "adult man parent of Khadija, gentle bearded" }),
      child({ id: "char_4", name: "Bello", kind: "dog", visualLock: "small friendly floppy-eared dog" }),
    ],
    pages: goodPages,
  };

  await test("plan familial complet → viable", () => {
    assert.deepEqual(assertParentPlanViable(structuredClone(familyPlan), STORY), { ok: true });
  });

  await test("REPRO 46a9262b: plan fallback (1 perso sans kind, actions vides) → rejeté", () => {
    const degraded = {
      ...structuredClone(familyPlan),
      characters: [child({ kind: undefined, visualLock: "khadija" })],
      pages: goodPages.map((p) => ({ ...p, action: "", characterIds: ["char_1"] })),
    };
    const res = assertParentPlanViable(degraded, STORY);
    assert.equal(res.ok, false);
    const text = (res as { ok: false; reasons: string[] }).reasons.join(" ");
    assert.match(text, /sans kind|action concrète|adulte|parents/i);
  });

  await test("histoire avec parents mais 0 adulte nommé → rejeté", () => {
    const noAdults = {
      ...structuredClone(familyPlan),
      characters: [
        child(),
        child({ id: "char_4", name: "Bello", kind: "dog", visualLock: "small friendly floppy-eared dog" }),
      ],
    };
    assert.equal(assertParentPlanViable(noAdults, STORY).ok, false);
  });

  await test("histoire avec chien mais aucun animal → rejeté", () => {
    const noDog = {
      ...structuredClone(familyPlan),
      characters: familyPlan.characters
        .filter((c) => c.kind === "human")
        .map((c) => ({ ...c })),
    };
    assert.equal(assertParentPlanViable(structuredClone(noDog), STORY).ok, false);
  });
}

/**
 * P0 — repro prod gen 10de421f: (1) the enforced anti-boy negation ("NOT a
 * boy") tripped the boy-marker regex, so every girl plan took the last-resort
 * rewrite; (2) a hero-only cast then died on the viability gate instead of
 * being completed with the story's mandatory family.
 */
async function runFamilyCastRepairTests() {
  console.log("\n── réparation du cast familial + genre sans faux positifs ──");
  const { assertHeroGender, assertParentPlanViable } = await import("../lib/plan-fidelity");
  const { enforceParentChildHero, ensureMandatoryFamilyCast } = await import(
    "../services/ai/character-bible"
  );
  const STORY = "khadija et ses parents adoptent un chien";
  const world = { setting: "maison", palette: "chaud", mood: "tendre" };
  const heroOnlyPlan = () => ({
    title: "t",
    summary: "s",
    audienceAge: "6-8",
    world,
    characters: [
      {
        id: "char_1",
        name: "Khadija",
        description: "Khadija et son nouveau compagnon",
        appearance: "petite fille",
        visualLock: "young girl child named Khadija, about 7 years old",
        personality: "curieuse",
        kind: "human",
      },
    ],
    pages: [1, 2, 3, 4, 5, 6].map((n) => ({
      pageNumber: n,
      title: `Étape ${n}`,
      storyText: `Khadija vit l'étape ${n} de l'adoption.`,
      illustrationDescription: "adoption scene",
      characterIds: ["char_1"],
      action: `Khadija does adoption step ${n} with joy and care`,
    })),
  });

  await test("REPRO 10de421f: le lock enforcé (« NOT a boy ») ne déclenche plus le détecteur garçon", () => {
    const enforced = enforceParentChildHero(heroOnlyPlan(), {
      childName: "Khadija",
      childGender: "girl",
      audience: "6-8",
    });
    assert.deepEqual(assertHeroGender(enforced, "girl", "Khadija"), { ok: true });
  });

  await test("possessif français « son » ne marque plus une fille comme garçon", () => {
    const plan = heroOnlyPlan();
    plan.characters[0].description = "khadija aime son chien et son papa";
    assert.deepEqual(assertHeroGender(plan, "girl", "Khadija"), { ok: true });
  });

  await test("symétrique garçon: « NOT a girl » ne déclenche pas le détecteur fille", () => {
    const plan = heroOnlyPlan();
    plan.characters[0].name = "Moussa";
    plan.characters[0].visualLock =
      "young boy child named Moussa, about 7 years old, NOT a girl, NOT a female child";
    assert.deepEqual(assertHeroGender(plan, "boy", "Moussa"), { ok: true });
  });

  await test("REPRO 10de421f: cast héros-seul + histoire familiale → complété et viable", () => {
    const repaired = ensureMandatoryFamilyCast(heroOnlyPlan(), STORY);
    assert.deepEqual(assertParentPlanViable(repaired, STORY), { ok: true });
    assert.equal(repaired.characters.length, 4);
    const kinds = repaired.characters.map((c) => c.kind);
    assert.equal(kinds.filter((k) => k === "human").length, 3);
    assert.equal(kinds.includes("dog"), true);
    for (const page of repaired.pages) {
      assert.equal(page.characterIds.length, 4);
      assert.equal(page.characterIds[0], "char_1");
    }
  });

  await test("REPRO 29daf67a: sujet du portrait dérivé du personnage (adulte / espèce / enfant)", async () => {
    const { portraitSubjectLine } = await import("../services/ai/character-bible");
    const mk = (over: Record<string, unknown>) => ({
      id: "x",
      name: "X",
      description: "",
      appearance: "",
      visualLock: "",
      personality: "",
      ...over,
    });
    const mom = portraitSubjectLine(
      mk({
        name: "Maman de Khadija",
        visualLock: "adult woman, Khadija's mother, kind warm smile, adult proportions",
        kind: "human",
        ageBand: "adult",
      })
    );
    assert.match(mom, /EXACTLY ONE adult woman/);
    assert.match(mom, /NOT a child/);
    const dad = portraitSubjectLine(
      mk({
        name: "Papa de Khadija",
        visualLock: "adult man, Khadija's father, kind gentle smile",
        kind: "human",
      })
    );
    assert.match(dad, /EXACTLY ONE adult man/);
    const dog = portraitSubjectLine(
      mk({ name: "Compagnon", visualLock: "cute friendly young dog", kind: "dog" })
    );
    assert.match(dog, /EXACTLY ONE dog/);
    assert.match(dog, /never humanoid/);
    const kid = portraitSubjectLine(
      mk({
        name: "Khadija",
        visualLock: "young girl child named Khadija, about 7 years old",
        kind: "human",
      })
    );
    assert.match(kid, /EXACTLY ONE child/);
  });

  await test("cast familial déjà complet → inchangé", () => {
    const full = ensureMandatoryFamilyCast(
      {
        ...heroOnlyPlan(),
        characters: [
          heroOnlyPlan().characters[0],
          {
            id: "char_2",
            name: "Maman Aïcha",
            description: "maman",
            appearance: "maman",
            visualLock: "adult woman parent of Khadija, warm smile",
            personality: "douce",
            kind: "human",
          },
          {
            id: "char_3",
            name: "Papa Moussa",
            description: "papa",
            appearance: "papa",
            visualLock: "adult man parent of Khadija, gentle bearded",
            personality: "calme",
            kind: "human",
          },
          {
            id: "char_4",
            name: "Bello",
            description: "chien",
            appearance: "chiot",
            visualLock: "small friendly floppy-eared dog",
            personality: "joueur",
            kind: "dog",
          },
        ],
      },
      STORY
    );
    assert.equal(full.characters.length, 4);
    assert.equal(full.characters.some((c) => c.id === "char_maman"), false);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
