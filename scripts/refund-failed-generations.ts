/**
 * Idempotent credit repair for failed/incomplete book generations.
 *
 * Credits are reserved up-front (`gen:<id>:reserve`). On hard failure the
 * orchestrator / reaper should credit `gen:<id>:refund`. This script finds
 * failed (or stuck) generations that still lack a refund ledger entry and
 * restores the reserved amount.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/refund-failed-generations.ts
 *   npx tsx --env-file=.env.local scripts/refund-failed-generations.ts --user=<uid>
 *   npx tsx --env-file=.env.local scripts/refund-failed-generations.ts --gen=<generationId>
 *   npx tsx --env-file=.env.local scripts/refund-failed-generations.ts --book=<bookId>
 *   npx tsx --env-file=.env.local scripts/refund-failed-generations.ts --email=foo@bar.com
 *   npx tsx --env-file=.env.local scripts/refund-failed-generations.ts --dry-run
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { CreditService } from "@/services/credit-service";
import type { DocumentData, Firestore } from "firebase-admin/firestore";

type Args = {
  userId?: string;
  generationId?: string;
  bookId?: string;
  email?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--user=")) out.userId = a.slice("--user=".length);
    else if (a.startsWith("--gen=")) out.generationId = a.slice("--gen=".length);
    else if (a.startsWith("--book=")) out.bookId = a.slice("--book=".length);
    else if (a.startsWith("--email=")) out.email = a.slice("--email=".length);
  }
  return out;
}

async function resolveUserId(
  db: Firestore,
  args: Args
): Promise<string | undefined> {
  if (args.userId) return args.userId;
  if (args.email) {
    const email = args.email.trim().toLowerCase();
    const snap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (snap.empty) throw new Error(`No user for email=${args.email}`);
    return snap.docs[0]!.id;
  }
  if (args.bookId) {
    const book = await db.collection("books").doc(args.bookId).get();
    if (!book.exists) throw new Error(`book ${args.bookId} not found`);
    return String(book.data()?.user_id || "");
  }
  if (args.generationId) {
    const gen = await db.collection("generations").doc(args.generationId).get();
    if (!gen.exists) throw new Error(`generation ${args.generationId} not found`);
    return String(gen.data()?.user_id || "");
  }
  return undefined;
}

async function hasRefund(
  db: Firestore,
  userId: string,
  generationId: string
): Promise<boolean> {
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("credit_ledger")
    .where("operation", "==", "credit")
    .where("reference_id", "==", `gen:${generationId}:refund`)
    .limit(1)
    .get();
  return !snap.empty;
}

async function reservedAmount(
  db: Firestore,
  userId: string,
  generationId: string,
  fallback: number
): Promise<number> {
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("credit_ledger")
    .where("operation", "==", "debit")
    .where("reference_id", "==", `gen:${generationId}:reserve`)
    .limit(1)
    .get();
  if (snap.empty) return fallback;
  const amount = snap.docs[0]!.data().amount;
  return typeof amount === "number" && amount > 0 ? amount : fallback;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getAdminDb();
  const credits = new CreditService(db);

  let userId = await resolveUserId(db, args);
  // Convenience: if no filter, try common trust-crisis book + gen from the incident.
  const bookId =
    args.bookId ||
    (!args.userId && !args.generationId && !args.email
      ? "8402bbe0-4913-494d-8831-4a151facba79"
      : undefined);
  const generationId = args.generationId;

  if (!userId && bookId) {
    const book = await db.collection("books").doc(bookId).get();
    if (!book.exists) throw new Error(`book ${bookId} not found`);
    userId = String(book.data()?.user_id || "");
  }

  if (!userId) {
    throw new Error("Pass --user, --email, --book, or --gen.");
  }

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw new Error(`user ${userId} not found`);
  const user = userSnap.data()!;
  const balanceBefore = (user.credits as number) ?? 0;
  console.log(
    `User ${userId} email=${user.email || "?"} name=${user.display_name || user.name || "?"} credits=${balanceBefore}`
  );

  const gens: Array<{ id: string; data: DocumentData }> = [];
  if (generationId) {
    const g = await db.collection("generations").doc(generationId).get();
    if (!g.exists) throw new Error(`generation ${generationId} not found`);
    gens.push({ id: g.id, data: g.data()! });
  } else {
    let q = db.collection("generations").where("user_id", "==", userId);
    if (bookId) q = q.where("book_id", "==", bookId);
    const snap = await q.limit(100).get();
    for (const d of snap.docs) gens.push({ id: d.id, data: d.data() });
  }

  console.log(`Scanning ${gens.length} generation(s)…`);

  let refundedTotal = 0;
  let repaired = 0;
  for (const g of gens) {
    const status = String(g.data.status || "");
    const costHint =
      typeof g.data.credits_used === "number" ? g.data.credits_used : 0;
    const amount = await reservedAmount(db, userId, g.id, costHint);
    const already = await hasRefund(db, userId, g.id);
    const needs =
      amount > 0 &&
      !already &&
      (status === "failed" ||
        status === "partial" ||
        // Stuck running with zero delivery — reaper may have missed it
        ((status === "running" || status === "queued") && costHint > 0));

    console.log(
      `  gen=${g.id} status=${status} reserve≈${amount} refunded=${already} action=${needs ? "REFUND" : "skip"}`
    );

    if (!needs) continue;
    if (args.dryRun) {
      console.log(`    [dry-run] would refund ${amount}`);
      continue;
    }
    const after = await credits.refund(
      userId,
      amount,
      `Remboursement — réparation génération échouée (${status})`,
      `gen:${g.id}:refund`
    );
    console.log(`    refunded ${amount} → balance ${after}`);
    refundedTotal += amount;
    repaired += 1;

    // Clear stuck book lock if this gen is still active.
    const bookIdForGen = String(g.data.book_id || "");
    if (bookIdForGen) {
      const bookRef = db.collection("books").doc(bookIdForGen);
      const book = await bookRef.get();
      if (
        book.exists &&
        book.data()?.active_generation_id === g.id &&
        book.data()?.status === "generating"
      ) {
        await bookRef.set(
          {
            status: "failed",
            active_generation_id: null,
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    }
    if (status === "running" || status === "queued") {
      await db.collection("generations").doc(g.id).set(
        {
          status: "failed",
          credits_used: 0,
          error_message:
            "Génération interrompue. Crédits remboursés — vous pouvez réessayer.",
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  }

  const balanceAfter = await credits.getBalance(userId);
  console.log(
    `\nDone. repaired=${repaired} refundedTotal=${refundedTotal} balance ${balanceBefore} → ${balanceAfter}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
