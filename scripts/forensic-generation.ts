/**
 * Forensic + invalidation of a shipped-but-unusable generation (P0 incident
 * gen 4f8980ea / book 55237586: black-flooded pages marked completed).
 *
 * READ-ONLY by default:
 *   npx tsx scripts/forensic-generation.ts --gen <generationId>
 * prints: generation timeline (steps ledger), per-page qc_stats, persisted
 * asset SHA-256 + deterministic raster stats, credit ledger entries and user
 * balance. Saves the persisted PNGs under .forensic/<genId>/ for visual
 * inspection. No signed URL is ever printed.
 *
 * INVALIDATION (explicit, idempotent):
 *   npx tsx scripts/forensic-generation.ts --gen <id> --invalidate
 * - refunds the full reserved cost with the standard idempotent reference
 *   `gen:<id>:refund:full` (safe if already refunded — no double credit);
 * - flips the book back to `draft` and the generation to `failed` so the
 *   unusable book is never presented as terminé;
 * - touches NOTHING else (pages/assets stay as evidence).
 *
 * Requires Firebase Admin credentials in the environment
 * (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) — e.g.
 * exported from the production env. Never commit those values.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const genIdx = args.indexOf("--gen");
  const generationId = genIdx >= 0 ? args[genIdx + 1] : "";
  const invalidate = args.includes("--invalidate");
  if (!generationId) {
    console.error("usage: tsx scripts/forensic-generation.ts --gen <generationId> [--invalidate]");
    process.exit(1);
  }

  const { getAdminDb } = await import("../lib/firebase/admin");
  const { analyzeRasterStats, rasterVerdicts } = await import("../lib/raster-gate");
  const db = getAdminDb();

  const genSnap = await db.collection("generations").doc(generationId).get();
  if (!genSnap.exists) throw new Error(`generation ${generationId} introuvable`);
  const gen = genSnap.data()!;
  const userId = String(gen.user_id);
  const bookId = String(gen.book_id);
  console.log(`=== GÉNÉRATION ${generationId} ===`);
  console.log({
    status: gen.status,
    progress: gen.progress,
    credits_used: gen.credits_used,
    created_at: gen.created_at,
    updated_at: gen.updated_at,
    duration_ms: gen.duration_ms,
    error_message: gen.error_message,
    provider: gen.provider,
  });

  console.log("\n=== STEPS (durées) ===");
  const steps = await genSnap.ref.collection("steps").get();
  for (const s of steps.docs) {
    const d = s.data();
    console.log(
      `${s.id}: ${d.status} attempt=${d.attempt} duration_ms=${d.duration_ms} started=${d.started_at} finished=${d.finished_at} err=${d.sanitized_error_message || "-"}`
    );
  }

  const bookSnap = await db.collection("books").doc(bookId).get();
  const book = bookSnap.data() || {};
  console.log("\n=== LIVRE ===");
  console.log({
    id: bookId,
    status: book.status,
    page_count: book.page_count,
    type: book.type,
    source: book.source,
    title: book.title,
    active_generation_id: book.active_generation_id,
    free_retry_available: book.free_retry_available,
    has_pdf: Boolean(book.pdf_url),
  });

  console.log("\n=== LEDGER (entrées liées) ===");
  const ledger = await db
    .collection("users")
    .doc(userId)
    .collection("credit_ledger")
    .orderBy("created_at", "desc")
    .limit(40)
    .get();
  let related = 0;
  for (const entry of ledger.docs) {
    const d = entry.data();
    const ref = String(d.reference_id || "");
    if (ref.includes(generationId) || related < 3) {
      console.log(
        `${d.created_at} ${d.operation} amount=${d.amount} balance_after=${d.balance_after ?? "?"} ref=${ref}`
      );
      if (ref.includes(generationId)) related++;
    }
  }
  const userSnap = await db.collection("users").doc(userId).get();
  console.log(`SOLDE ACTUEL: ${userSnap.data()?.credits}`);

  console.log("\n=== ASSETS PERSISTÉS (SHA-256 + raster) ===");
  const outDir = join(".forensic", generationId.slice(0, 8));
  mkdirSync(outDir, { recursive: true });
  const { StorageService } = await import("../services/storage-service");
  const storage = new StorageService();
  const analyzeOne = async (label: string, path: string | null, url: string | null) => {
    try {
      const usable = path ? await storage.signPath(path) : url;
      if (!usable) {
        console.log(`${label}: aucun asset`);
        return;
      }
      const res = await fetch(usable);
      const bytes = Buffer.from(await res.arrayBuffer());
      const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const stats = await analyzeRasterStats(bytes);
      const verdicts = rasterVerdicts(stats);
      writeFileSync(join(outDir, `${label}.png`), bytes);
      console.log(
        `${label}: sha256=${sha}… ${bytes.length}o dark=${(stats.darkRatio * 100).toFixed(1)}% white=${(stats.whiteRatio * 100).toFixed(1)}% blob=${(stats.largestDarkBlobRatio * 100).toFixed(1)}% → ${verdicts.length ? verdicts.join("; ") : "OK"}`
      );
    } catch (err) {
      console.log(`${label}: analyse impossible — ${err instanceof Error ? err.message : err}`);
    }
  };
  await analyzeOne(
    "cover",
    (book.cover_image_path as string) || null,
    (book.cover_image as string) || null
  );
  const pages = await db
    .collection("books")
    .doc(bookId)
    .collection("pages")
    .orderBy("page_number", "asc")
    .get();
  for (const p of pages.docs) {
    const d = p.data();
    console.log(
      `page ${d.page_number}: status=${d.generation_status} qc=${JSON.stringify(d.qc_stats || {}).slice(0, 300)}`
    );
    await analyzeOne(
      `page-${d.page_number}`,
      (d.illustration_path as string) || null,
      (d.illustration_url as string) || null
    );
  }
  console.log(`\nPNG sauvegardés dans ${outDir}/ pour inspection visuelle.`);

  if (!invalidate) {
    console.log("\n(lecture seule — relancer avec --invalidate pour rembourser/invalider)");
    return;
  }

  console.log("\n=== INVALIDATION IDEMPOTENTE ===");
  const { CreditService } = await import("../services/credit-service");
  const credits = new CreditService(db);
  const cost = Number(gen.credits_used) || 18;
  const balance = await credits.refund(
    userId,
    cost,
    "Remboursement — livre invalidé (qualité inacceptable, incident P0)",
    `gen:${generationId}:refund:full`
  );
  console.log(`refund idempotent exécuté — solde: ${balance}`);
  await db.collection("books").doc(bookId).set(
    {
      status: "draft",
      pdf_url: null,
      pdf_path: null,
      active_generation_id: null,
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );
  await genSnap.ref.set(
    {
      status: "failed",
      cancelled: true,
      credits_used: 0,
      error_message:
        "Livre invalidé après contrôle qualité : vos crédits ont été remboursés.",
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log("livre → draft, génération → failed. Assets conservés comme preuves.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
