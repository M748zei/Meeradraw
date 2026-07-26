/**
 * Prove file input is topmost hit target via Chrome CDP.
 * Expects `ws` resolvable (e.g. NODE_PATH=/tmp/photo-hit-ws/node_modules).
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8" />
<style>
  body { margin: 40px; font-family: system-ui, sans-serif; }
  .group { position: relative; min-height: 7.5rem; overflow: hidden; border-radius: 1rem; width: 420px; }
  .visual {
    pointer-events: none; position: relative; z-index: 0;
    display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
    border: 2px dashed #ccc; background: #faf7f2; padding: 1.5rem 1rem; color: #666;
  }
  .file-drop-input {
    position: absolute; inset: 0; z-index: 20; display: block;
    width: 100%; height: 100%; margin: 0; cursor: pointer;
    opacity: 0.01; font-size: 100px;
  }
  .file-drop-input::-webkit-file-upload-button,
  .file-drop-input::file-selector-button {
    width: 100%; height: 100%; margin: 0; padding: 0; border: 0; cursor: pointer;
  }
</style></head><body>
  <div class="group" data-testid="child-photo-dropzone" id="fixed">
    <input id="child-photo" type="file" accept="image/jpeg,image/png,image/webp"
      data-testid="child-photo-input" class="file-drop-input" />
    <div class="visual" aria-hidden="true"><span>Ajouter une photo</span></div>
  </div>
</body></html>`;

const work = mkdtempSync(join(tmpdir(), "photo-hit-cdp-"));
const userData = join(work, "chrome-profile");
mkdirSync(userData);
const file = join(work, "hit.html");
writeFileSync(file, html);

const port = 9222 + Math.floor(Math.random() * 1000);
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `file://${file}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

let stderr = "";
chrome.stderr.on("data", (d) => {
  stderr += d.toString();
});

async function waitForDebugger(ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const tabs = await res.json();
        const page = tabs.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`Chrome CDP not ready.\n${stderr.slice(-800)}`);
}

function cdpClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
}

try {
  const tab = await waitForDebugger();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const send = cdpClient(ws);
  await send("Runtime.enable");
  await sleep(300);

  const { result } = await send("Runtime.evaluate", {
    expression: `(() => {
      const zone = document.getElementById('fixed');
      const rect = zone.getBoundingClientRect();
      const points = [
        ['center', 0.5, 0.5],
        ['left-mid', 0.15, 0.5],
        ['right-mid', 0.85, 0.5],
        ['top-mid', 0.5, 0.2],
        ['bottom-mid', 0.5, 0.8],
      ];
      return points.map(([name, xr, yr]) => {
        const x = rect.left + rect.width * xr;
        const y = rect.top + rect.height * yr;
        const el = document.elementFromPoint(x, y);
        return {
          name,
          x, y,
          tag: el?.tagName || null,
          id: el?.id || null,
          type: el?.getAttribute?.('type') || null,
          testId: el?.getAttribute?.('data-testid') || null,
        };
      });
    })()`,
    returnByValue: true,
  });

  const hits = result.value;
  const ok = hits.every((h) => h.id === "child-photo" && h.type === "file");
  console.log(JSON.stringify({ ok, hits }, null, 2));
  if (!ok) {
    console.error("FAIL: file input is not the hit target at all sample points");
    process.exitCode = 1;
  } else {
    console.log("PASS: file input is topmost hit target across the dropzone");
  }
  ws.close();
} finally {
  chrome.kill("SIGKILL");
}
