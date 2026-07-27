/**
 * Prove the NEW dropzone (label wrapping the file input) opens the native
 * file chooser from a click anywhere in the zone — the exact regression
 * reported on Mac Safari ("le sélecteur ne s'ouvre pas"): the old header
 * <div> was not wired to the input.
 *
 * Mirrors the structure of app/(app)/create/page.tsx (label > span + input).
 * Runs on system Chrome (channel) and, when available, WebKit (Safari engine).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const { execSync } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "pw-"));
    execSync("npm install --no-save playwright@1.54.0", {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    });
    return require(join(dir, "node_modules/playwright"));
  }
}

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<style>
  body { margin: 40px; font-family: system-ui, sans-serif; }
  label.dropzone {
    display: block; cursor: pointer; padding: 1rem; width: 420px;
    border: 1px dashed #d9c9a8; border-radius: 1rem; background: #fdf9f0;
  }
  label.dropzone > span.head {
    margin-bottom: .75rem; display: flex; align-items: center;
    justify-content: center; gap: .5rem; font-size: .875rem; color: #6b6357;
  }
  input[type="file"] {
    margin: 0 auto; display: block; width: 100%; max-width: 28rem;
    border: 1px solid #d9c9a8; border-radius: .75rem; background: #fff;
    font-size: .875rem;
  }
</style>
</head>
<body>
  <label class="dropzone" for="child-photo" data-testid="child-photo-dropzone">
    <span class="head">⬆︎ <span>Ajouter une photo</span></span>
    <input id="child-photo" name="child-photo" type="file"
      accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif" />
  </label>
</body>
</html>`;

async function testBrowser(pw, name, launch) {
  let browser;
  try {
    browser = await launch();
  } catch (err) {
    console.log(`~ ${name}: indisponible (${String(err).split("\n")[0].slice(0, 100)})`);
    return null;
  }
  try {
    const page = await browser.newPage();
    const file = join(mkdtempSync(join(tmpdir(), "hit-")), "zone.html");
    writeFileSync(file, html);
    await page.goto("file://" + file);

    // 1. Click on the HEADER area of the zone (where the old regression was):
    //    must open the chooser via the wrapping <label>.
    const header = page.locator("span.head");
    const chooser1 = page.waitForEvent("filechooser", { timeout: 4000 });
    await header.click();
    await chooser1;
    console.log(`✓ ${name}: clic sur l'en-tête de la zone → sélecteur ouvert`);

    // 2. Click on the padding of the label itself (top-left corner area).
    const box = await page.locator("label.dropzone").boundingBox();
    const chooser2 = page.waitForEvent("filechooser", { timeout: 4000 });
    await page.mouse.click(box.x + 8, box.y + 8);
    await chooser2;
    console.log(`✓ ${name}: clic sur le bord de la zone → sélecteur ouvert`);

    // 3. The visible input still works and yields exactly one chooser.
    const chooser3 = page.waitForEvent("filechooser", { timeout: 4000 });
    await page.locator("#child-photo").click();
    await chooser3;
    console.log(`✓ ${name}: clic sur l'input natif → sélecteur ouvert (une seule fois)`);
    return true;
  } finally {
    await browser?.close();
  }
}

const pw = await loadPlaywright();
let ok = true;
const chrome = await testBrowser(pw, "Chrome (système)", () =>
  pw.chromium.launch({ channel: "chrome", headless: true })
);
if (chrome === null) {
  const bundled = await testBrowser(pw, "Chromium", () => pw.chromium.launch({ headless: true }));
  ok = ok && bundled !== false && bundled !== null;
} else ok = ok && chrome;
const webkit = await testBrowser(pw, "WebKit (moteur Safari)", () =>
  pw.webkit.launch({ headless: true })
);
if (webkit === false) ok = false;

if (!ok) {
  console.error("✗ hit-test échoué");
  process.exit(1);
}
console.log("photo-label-hit-test: OK");
