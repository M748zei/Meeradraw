/**
 * Inspect a user's books/pages for empty "completed" deliveries.
 *   npx tsx --env-file=.env.local scripts/inspect-user-books.ts --user=<uid>
 */
import { getAdminDb } from "@/lib/firebase/admin";

async function main() {
  const userArg = process.argv.find((a) => a.startsWith("--user="));
  const userId = userArg?.slice("--user=".length);
  if (!userId) throw new Error("pass --user=");
  const db = getAdminDb();
  const user = (await db.collection("users").doc(userId).get()).data();
  console.log("credits", user?.credits, "email", user?.email);

  const led = await db
    .collection("users")
    .doc(userId)
    .collection("credit_ledger")
    .orderBy("created_at", "desc")
    .limit(30)
    .get();
  console.log("\nLEDGER");
  for (const d of led.docs) {
    const x = d.data();
    console.log(
      x.created_at,
      x.operation,
      x.amount,
      "→",
      x.balance_after,
      String(x.reason || "").slice(0, 70),
      x.reference_id || ""
    );
  }

  const books = await db.collection("books").where("user_id", "==", userId).limit(40).get();
  console.log("\nBOOKS", books.size);
  for (const d of books.docs) {
    const b = d.data();
    const pages = await db.collection("books").doc(d.id).collection("pages").get();
    const ok = pages.docs.filter((p) => p.data().generation_status === "completed" && p.data().illustration_url).length;
    const failed = pages.docs.filter((p) => p.data().generation_status === "failed").length;
    const pending = pages.docs.filter((p) => !p.data().illustration_url).length;
    console.log(
      d.id,
      "status=",
      b.status,
      "title=",
      String(b.title || "").slice(0, 40),
      "planned=",
      b.page_count,
      "pages=",
      pages.size,
      "ok=",
      ok,
      "failed=",
      failed,
      "noUrl=",
      pending,
      "cover=",
      b.cover_image ? "yes" : "NO",
      "src=",
      b.source
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
