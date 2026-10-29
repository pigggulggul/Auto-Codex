import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./lib/read-png.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "public/generated-pixel-assets");
const digest = (data) => createHash("sha256").update(data).digest("hex");
const checked = [];
for (let character = 0; character < 5; character++) {
  const relative = `characters/char_${character}.png`, file = path.join(runtime, relative);
  const image = await readPng(file);
  assert.equal(image.width, 512); assert.equal(image.height, 1024);
  assert.equal(digest(await readFile(file)), digest(await readFile(path.join(root, "tools/generated-inputs", relative))), `${relative}: source/runtime drift`);
  for (let row = 0; row < 4; row++) for (let column = 0; column < 2; column++) {
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      if (x < 12 || x >= 244 || y < 12 || y >= 244) assert.ok(image.alpha(column * 256 + x, row * 256 + y) < 10, `${relative}: unsafe frame gutter at ${column},${row}:${x},${y}`);
    }
  }
  const footCenter = (column) => {
    let sum = 0, count = 0;
    for (let y = 228; y < 242; y++) for (let x = 24; x < 232; x++) if (image.alpha(column * 256 + x, 256 + y) > 128) { sum += x; count++; }
    assert.ok(count > 20, `${relative}: missing planted foot`);
    return sum / count;
  };
  const a = footCenter(0), b = footCenter(1);
  // Asymmetric ponytails shift the centered full-body bounds. Require the
  // planted foot to cross the center and travel at least 20 authored pixels.
  assert.ok(a < 128 && b > 128 && b - a > 20, `${relative}: feet do not alternate (A=${a.toFixed(1)}, B=${b.toFixed(1)})`);
  checked.push(`char_${character}: opposite planted feet A=${a.toFixed(1)}, B=${b.toFixed(1)}`);
}

async function scan(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await scan(file));
    else if (entry.name.endsWith(".png")) files.push(file);
  }
  return files;
}
const furniture = await scan(path.join(runtime, "furniture"));
for (const file of furniture) {
  const image = await readPng(file);
  let opaque = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const alpha = image.alpha(x, y);
    if (alpha > 32) opaque++;
    if (x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) assert.ok(alpha < 10, `${file}: clipped object edge`);
  }
  assert.ok(opaque > 20 && opaque / (image.width * image.height) < .92, `${file}: empty asset or baked rectangular background`);
}
const pc1 = await readFile(path.join(runtime, "furniture/PC/PC_FRONT_ON_1.png"));
const pc2 = await readFile(path.join(runtime, "furniture/PC/PC_FRONT_ON_2.png"));
assert.notEqual(digest(pc1), digest(pc2), "PC active frames must have distinct authored screen content");
console.log(`PASS: ${furniture.length} isolated furniture sprites, transparent edges, distinct PC screens; ${checked.join("; ")}`);
