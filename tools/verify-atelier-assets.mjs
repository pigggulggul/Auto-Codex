// Build first. Uses an isolated bridge and synthetic App Server, never live Codex.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, ".cache"), { recursive: true });
const scratch = await mkdtemp(path.join(root, ".cache", "atelier-assets-"));
await cp(path.join(root, "build-server"), path.join(scratch, "build-server"), { recursive: true });
await mkdir(path.join(scratch, "dist"));
await cp(path.join(root, "dist", "atelier-assets"), path.join(scratch, "dist", "atelier-assets"), { recursive: true });
await cp(path.join(root, "tools", "fixtures", "history-app-server.mjs"), path.join(scratch, "app-server"));
const child = spawn(process.execPath, [path.join(scratch, "build-server", "server", "index.js"), "--serve"], {
  cwd: scratch, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, AUTO_CODEX_PORT: "4872", CODEX_BIN: process.execPath, AUTO_CODEX_TEST_REQUESTS: path.join(scratch, "requests.jsonl") },
});
let started = false;
child.stdout.on("data", (data) => { if (String(data).includes("Auto Codex bridge")) started = true; });
child.stderr.resume();
const hash = (data) => createHash("sha256").update(data).digest("hex");
try {
  const deadline = Date.now() + 10_000;
  while (!started && child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(started && child.exitCode === null, "isolated bridge must start on 4872");
  for (const [name, mime] of [["instrument-serif.woff2", "font/woff2"], ["instrument-sans.woff2", "font/woff2"], ["instrumentserif-OFL.txt", "text/plain"], ["instrumentsans-OFL.txt", "text/plain"], ["icons/flow.svg", "image/svg+xml"], ["LICENSES.md", "text/plain"]]) {
    const response = await fetch(`http://127.0.0.1:4872/atelier-assets/${name}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type")?.startsWith(mime), `${name}: correct MIME required`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(bytes), hash(await readFile(path.join(root, "public", "atelier-assets", name))), `${name}: built response must match source bytes`);
  }
  console.log("PASS: production bridge serves local fonts, licenses and icons with correct MIME and original bytes; no live Codex.");
} finally {
  if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
}
