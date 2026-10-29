import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
export const FILE_LIMIT = 15 * 1024 * 1024;
export const BACKUP_LIMIT = 90 * 1024 * 1024;
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function crc32(bytes: Buffer, initial = 0) {
  let c = (initial ^ 0xffffffff) >>> 0;
  for (const b of bytes) { c ^= b; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
export const RESOURCE_TYPES: Record<string,string> = {
  '.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown','.json':'application/json','.csv':'text/csv','.tsv':'text/tab-separated-values','.svg':'image/svg+xml','.xml':'application/xml','.tmx':'application/xml','.tsx':'text/plain','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.zip':'application/zip','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.mp4':'video/mp4','.webm':'video/webm','.psd':'image/vnd.adobe.photoshop'
};
export interface Format { ext: string; mime: string }
const dimensions = (w: number, h: number) => w > 0 && h > 0 && w * h <= 64000000;
/** Structural image validation, never script execution or a claim of visual correctness. */
export function detectImage(b: Buffer): Format | null {
  try {
    if (b.length >= 33 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      let offset = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0, ended = false;
      const data: Buffer[] = [];
      while (offset + 12 <= b.length) {
        const size = b.readUInt32BE(offset), end = offset + 12 + size;
        if (end > b.length) return null;
        const kind = b.toString('ascii', offset + 4, offset + 8);
        if (b.readUInt32BE(end - 4) !== crc32(b.subarray(offset + 4, end - 4))) return null;
        if (offset === 8 && (kind !== 'IHDR' || size !== 13)) return null;
        if (kind === 'IHDR') { width = b.readUInt32BE(offset+8); height = b.readUInt32BE(offset+12); depth = b[offset+16]; color = b[offset+17]; interlace = b[offset+20]; if (!dimensions(width,height) || ![1,2,4,8,16].includes(depth) || ![0,2,3,4,6].includes(color) || interlace > 1) return null; }
        if (kind === 'IDAT') data.push(b.subarray(offset+8,end-4));
        if (kind === 'IEND') { ended = size === 0 && end === b.length; break; }
        offset = end;
      }
      if (!ended || !data.length) return null;
      // Decompression is bounded. Interlaced PNGs retain structural validation.
      const channels = ({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];
      const expected = (Math.ceil(width * channels * depth / 8) + 1) * height;
      if(expected>128*1024*1024)return null;
      const inflated = inflateSync(Buffer.concat(data), {maxOutputLength: Math.min(expected * 2 + 1024, 128 * 1024 * 1024)});
      if (!interlace && inflated.length !== expected) return null;
      return {mime:'image/png',ext:'.png'};
    }
    if (b.length > 8 && b[0] === 255 && b[1] === 216 && b.at(-2) === 255 && b.at(-1) === 217) {
      let offset = 2, sized = false;
      while (offset + 4 <= b.length) {
        if (b[offset++] !== 255) return null;
        while (b[offset] === 255) offset++;
        const marker = b[offset++];
        if (marker === 218) return sized ? {mime:'image/jpeg',ext:'.jpg'} : null;
        const length = b.readUInt16BE(offset);
        if (length < 2 || offset + length > b.length) return null;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
          if (length < 8 || !dimensions(b.readUInt16BE(offset+5), b.readUInt16BE(offset+3))) return null;
          sized = true;
        }
        offset += length;
      }
      return null;
    }
    if (b.length >= 20 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length) {
      let offset = 12, image = false;
      while (offset + 8 <= b.length) {
        const kind = b.toString('ascii',offset,offset+4), size = b.readUInt32LE(offset+4);
        if (offset+8+size > b.length) return null;
        if (['VP8 ','VP8L'].includes(kind) && size >= 5) image = true;
        offset += 8 + size + size % 2;
      }
      return image && offset === b.length ? {mime:'image/webp',ext:'.webp'} : null;
    }
  } catch { return null; }
  return null;
}
export function detectResource(buffer: Buffer, name: string): Format | null {
  const image = detectImage(buffer); if (image) return image;
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (!ext || !Object.hasOwn(RESOURCE_TYPES,ext)) return null;
  const ascii = buffer.toString('ascii',0,16), magic = buffer.subarray(0,4).toString('hex');
  if (['.txt','.md','.json','.csv','.tsv','.svg','.xml','.tmx','.tsx','.gltf'].includes(ext)) {
    let text: string; try { text = new TextDecoder('utf-8',{fatal:true}).decode(buffer); } catch { return null; }
    if (text.includes('\u0000')) return null;
    if (['.json','.gltf'].includes(ext)) try { JSON.parse(text); } catch { return null; }
    if (ext === '.svg' && !/<svg(?:\s|>)/i.test(text)) return null;
  } else if (ext === '.pdf' && !ascii.startsWith('%PDF-')) return null;
  else if (['.zip','.docx','.xlsx','.pptx'].includes(ext) && !['504b0304','504b0506','504b0708'].includes(magic)) return null;
  else if (ext === '.woff' && !ascii.startsWith('wOFF')) return null;
  else if (ext === '.woff2' && !ascii.startsWith('wOF2')) return null;
  else if (ext === '.ttf' && !['00010000','74727565'].includes(magic)) return null;
  else if (ext === '.otf' && !ascii.startsWith('OTTO')) return null;
  else if (ext === '.glb' && !ascii.startsWith('glTF')) return null;
  else if (ext === '.wav' && !(ascii.startsWith('RIFF') && ascii.slice(8,12) === 'WAVE')) return null;
  else if (ext === '.mp3' && !(ascii.startsWith('ID3') || buffer[0] === 255 && (buffer[1]&224) === 224)) return null;
  else if (ext === '.ogg' && !ascii.startsWith('OggS')) return null;
  else if (ext === '.mp4' && ascii.slice(4,8) !== 'ftyp') return null;
  else if (ext === '.webm' && magic !== '1a45dfa3') return null;
  else if (ext === '.psd' && !ascii.startsWith('8BPS')) return null;
  return {ext,mime:RESOURCE_TYPES[ext]};
}
