// Read image headers only. This catalog describes the local, supplied art at its native size.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const manifest = JSON.parse(readFileSync('src/world/assetManifest.json', 'utf8'));
const root = resolve('public');
const dimensions = {};
for (const url of [...manifest.interiors, ...manifest.animated]) {
  if (!url.startsWith('/assets/') || url.includes('..') || url.includes('\\')) throw new Error(`Invalid asset path: ${url}`);
  const filename = resolve(root, `.${url}`);
  if (!filename.startsWith(root + sep)) throw new Error(`Asset outside public: ${url}`);
  const bytes = readFileSync(filename);
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    dimensions[url] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  } else if (bytes.subarray(0, 3).toString() === 'GIF') {
    dimensions[url] = [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  } else throw new Error(`Unknown image format: ${url}`);
}
writeFileSync('src/world/assetDimensions.json', JSON.stringify(dimensions));
