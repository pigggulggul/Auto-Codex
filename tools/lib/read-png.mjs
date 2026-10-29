import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

// Small read-only decoder for generated 8-bit noninterlaced PNG QA. No runtime
// dependency or image rewriting; supports RGB, RGBA and palette exports.
export async function readPng(file) {
  const source = await readFile(file);
  if (!source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Not PNG: ${file}`);
  const width = source.readUInt32BE(16), height = source.readUInt32BE(20), color = source[25];
  if (source[24] !== 8 || source[28] !== 0 || ![2, 3, 6].includes(color)) throw new Error(`Unsupported PNG QA format: ${file}`);
  const channels = color === 6 ? 4 : color === 2 ? 3 : 1;
  const chunks = [];
  let palette, transparency;
  for (let offset = 8; offset < source.length;) {
    const length = source.readUInt32BE(offset), type = source.toString("ascii", offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") chunks.push(data);
    if (type === "PLTE") palette = data;
    if (type === "tRNS") transparency = data;
    offset += length + 12;
  }
  const compressed = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = compressed[y * (stride + 1)];
    if (filter > 4) throw new Error(`Invalid PNG filter: ${file}`);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x, left = x >= channels ? pixels[index - channels] : 0;
      const up = y > 0 ? pixels[index - stride] : 0, corner = y > 0 && x >= channels ? pixels[index - stride - channels] : 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
      pixels[index] = (compressed[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const index = color === 3 ? pixels[i] * 3 : i * channels;
    const rgb = color === 3 ? palette : pixels;
    rgba[i * 4] = rgb[index]; rgba[i * 4 + 1] = rgb[index + 1]; rgba[i * 4 + 2] = rgb[index + 2];
    rgba[i * 4 + 3] = color === 6 ? pixels[index + 3] : color === 3 ? transparency?.[pixels[i]] ?? 255 : 255;
  }
  return { width, height, rgba, alpha: (x, y) => rgba[(y * width + x) * 4 + 3] };
}
