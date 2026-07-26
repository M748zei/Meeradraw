/**
 * Prove the file input is the topmost hit target at the dropzone center.
 * Uses system Google Chrome via Playwright channel (no browser download).
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // npx cache path from prior attempt
  }
  const candidates = [
    "/private/var/folders/r6/7j9pbn2x0q9ggm9nbp667sq40000gn/T/cursor-sandbox-cache/dcde1af49e93a18a9c770e3786265798/npm/_npx/bf080ee0960e194d/node_modules/playwright/index.js",
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* continue */
    }
  }
  // Install playwright package only (no browser) into a temp dir
  const { execSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "pw-"));
  execSync("npm pack playwright@1.54.0", { cwd: dir, stdio: "pipe" });
  execSync("npm install --no-save ./playwright-1.54.0.tgz", {
    cwd: dir,
    stdio: "pipe",
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
  return require(join(dir, "node_modules/playwright"));
}

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<style>
  body { margin: 40px; font-family: system-ui, sans-serif; }
  .group { position: relative; min-height: 7.5rem; overflow: hidden; border-radius: 1rem; width: 420px; }
  .visual {
    pointer-events: none;
    position: relative;
    z-index: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    border: 2px dashed #ccc;
    background: #faf7f2;
    padding: 1.5rem 1rem;
    color: #666;
  }
  .file-drop-input {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
    opacity: 0.01;
    font-size: 100px;
  }
  .file-drop-input::-webkit-file-upload-button {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    cursor: pointer;
  }
  .file-drop-input::file-selector-button {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    cursor: pointer;
  }
  .broken { position: relative; width: 420px; margin-top: 2rem; min-height: 7.5rem; }
  .broken .visual2 {
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    border: 2px dashed #ccc;
    padding: 1.5rem 1rem;
    min-height: 7.5rem;
    box-sizing: border-box;
  }
  .broken input {
    position: absolute;
    inset: 0;
    z-index: 10;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
</style>
</head>
<body>
  <h1>Photo hit-test</h1>
  <div class="group" data-testid="child-photo-dropzone" id="fixed">
    <input id="child-photo" type="file" accept="image/jpeg,image/png,image/webp"
      data-testid="child-photo-input" class="file-drop-input" />
    <div class="visual" aria-hidden="true">
      <span>Ajouter une photo</span>
    </div>
  </div>
  <div class="broken" id="broken">
    <div class="visual2" aria-hidden="true"><span>Broken opacity-0 only</span></div>
    <input id="broken-input" type="file" />
  </div>
</body>
</html>`;

const { chromium } = await loadPlaywright();
const dir = mkdtempSync(join(tmpdir(), "photo-hit-"));
const file = join(dir, "hit.html");
writeFileSync(file, html);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
const page = await browser.newPage();
await page.goto(`file://${file}`);

async function hitAt(selector, xRatio = 0.5, yRatio = 0.5) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  const x = box.x + box.width * xRatio;
  const y = box.y + box.height * yRatio;
  const info = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { tag: null };
      return {
        tag: el.tagName,
        id: el.id || null,
        testId: el.getAttribute("data-testid"),
        className: typeof el.className === "string" ? el.className : "",
        type: el.getAttribute("type"),
      };
    },
    { x, y }
  );
  return { x, y, box, info };
}

const points = [
  ["center", 0.5, 0.5],
  ["left-mid", 0.15, 0.5],
  ["right-mid", 0.85, 0.5],
  ["top-mid", 0.5, 0.2],
  ["bottom-mid", 0.5, 0.8],
];

const fixedResults = [];
for (const [name, xr, yr] of points) {
  fixedResults.push({ name, ...(await hitAt("#fixed", xr, yr)) });
}
const brokenResults = [];
for (const [name, xr, yr] of points) {
  brokenResults.push({ name, ...(await hitAt("#broken", xr, yr)) });
}

const fixedOk = fixedResults.every(
  (r) => r.info.id === "child-photo" && r.info.type === "file"
);
const brokenHits = brokenResults.map((r) => ({
  name: r.name,
  id: r.info.id,
  tag: r.info.tag,
}));

console.log(
  JSON.stringify(
    {
      fixedOk,
      fixedHits: fixedResults.map((r) => ({ name: r.name, id: r.info.id, type: r.info.type })),
      brokenHits,
    },
    null,
    2
  )
);

if (!fixedOk) {
  console.error("FAIL: fixed dropzone did not hit #child-photo at all sample points");
  process.exitCode = 1;
} else {
  console.log("PASS: file input is topmost hit target across the dropzone");
}

await browser.close();
