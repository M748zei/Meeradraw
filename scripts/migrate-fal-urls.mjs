/**
 * Migration T7 (P0-5) : re-télécharge toutes les images encore hébergées sur
 * fal.media (URLs éphémères) vers Firebase Storage et met à jour Firestore
 * (url signée + path). À lancer UNE FOIS, vite — les URLs fal meurent.
 *
 * Usage :
 *   node --env-file=.env.local scripts/migrate-fal-urls.mjs --dry-run   # inventaire
 *   node --env-file=.env.local scripts/migrate-fal-urls.mjs             # migration
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";

const DRY_RUN = process.argv.includes("--dry-run");
const EPHEMERAL = /(^|\.)fal\.(media|ai)|fal\.run/i;

initializeApp({
  credential: cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
});
const db = getFirestore();
const bucket = getStorage().bucket();

const stats = { scanned: 0, ephemeral: 0, migrated: 0, dead: 0, failed: 0 };

function isPng(b) {
  return b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

async function persist(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const png = isPng(raw) ? raw : await sharp(raw).png().toBuffer();
  const file = bucket.file(path);
  await file.save(png, {
    contentType: "image/png",
    resumable: false,
    metadata: { cacheControl: "private, max-age=3600", metadata: { ownerPath: path } },
  });
  const [signed] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 1000 * 60 * 60 * 24 * 365,
  });
  return signed;
}

/** Migre un champ URL d'un document si encore sur fal. Renvoie true si migré. */
async function migrateField(ref, data, urlField, pathField, storagePath, label) {
  const url = data[urlField];
  if (typeof url !== "string" || !url) return false;
  stats.scanned++;
  if (!EPHEMERAL.test(url)) return false;
  stats.ephemeral++;
  if (DRY_RUN) {
    console.log(`[dry] ${label} → ${storagePath}`);
    return false;
  }
  try {
    const signed = await persist(url, storagePath);
    await ref.update({
      [urlField]: signed,
      [pathField]: storagePath,
      updated_at: new Date().toISOString(),
    });
    stats.migrated++;
    console.log(`✓ ${label}`);
    return true;
  } catch (err) {
    const dead = String(err.message || "").startsWith("HTTP 4");
    if (dead) {
      stats.dead++;
      console.warn(`✗ MORTE (${err.message}) ${label} — image perdue, à régénérer`);
    } else {
      stats.failed++;
      console.warn(`✗ échec (${err.message}) ${label}`);
    }
    return false;
  }
}

// 1. Books: cover + character sheet + pages
const books = await db.collection("books").get();
for (const bookDoc of books.docs) {
  const book = bookDoc.data();
  const bookId = bookDoc.id;
  await migrateField(
    bookDoc.ref, book,
    "cover_image", "cover_image_path",
    `books/${bookId}/cover.png`,
    `book ${bookId} cover`
  );
  await migrateField(
    bookDoc.ref, book,
    "character_sheet_url", "character_sheet_path",
    `universes/${book.universe_id}/model_sheet.png`,
    `book ${bookId} model sheet`
  );
  const pages = await bookDoc.ref.collection("pages").get();
  for (const pageDoc of pages.docs) {
    const page = pageDoc.data();
    await migrateField(
      pageDoc.ref, page,
      "illustration_url", "illustration_path",
      `books/${bookId}/pages/${page.page_number}.png`,
      `book ${bookId} page ${page.page_number}`
    );
  }
}

// 2. Universes: cover + characters image_reference
const universes = await db.collection("universes").get();
for (const uniDoc of universes.docs) {
  const uni = uniDoc.data();
  await migrateField(
    uniDoc.ref, uni,
    "cover_image", "cover_image_path",
    `universes/${uniDoc.id}/cover.png`,
    `universe ${uniDoc.id} cover`
  );
  const chars = await uniDoc.ref.collection("characters").get();
  for (const charDoc of chars.docs) {
    await migrateField(
      charDoc.ref, charDoc.data(),
      "image_reference", "image_reference_path",
      `universes/${uniDoc.id}/model_sheet.png`,
      `universe ${uniDoc.id} character ${charDoc.id}`
    );
  }
}

console.log(
  `\nBilan${DRY_RUN ? " (dry-run)" : ""} : ${stats.scanned} URLs scannées, ${stats.ephemeral} éphémères fal, ${stats.migrated} migrées, ${stats.dead} mortes (perdues), ${stats.failed} échecs réseau`
);
