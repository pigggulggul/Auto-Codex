import {detectImage} from './validation-image.mjs';
import {RESOURCE_TYPES as MIME} from '../public/resource-types.js';
export const RESOURCE_EXTENSIONS=Object.keys(MIME);
const textExt=new Set(['.txt','.md','.json','.csv','.tsv','.svg','.xml','.tmx','.tsx','.gltf']);
export function detectResource(buffer,name){
 const image=detectImage(buffer);if(image)return {...image,category:'image'};
 const ext=String(name||'').toLowerCase().match(/\.[a-z0-9]+$/)?.[0];if(!MIME[ext])return null;
 const ascii=buffer.toString('ascii',0,16),magic=buffer.subarray(0,4).toString('hex');
 if(textExt.has(ext)){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{return null;}
  if(text.includes('\u0000'))return null;
  if(ext==='.json'||ext==='.gltf')try{JSON.parse(text);}catch{return null;}
  if(ext==='.svg'&&!/<svg(?:\s|>)/i.test(text))return null;
 }else if(ext==='.pdf'&&!ascii.startsWith('%PDF-'))return null;
 else if(['.zip','.docx','.xlsx','.pptx'].includes(ext)&&!['504b0304','504b0506','504b0708'].includes(magic))return null;
 else if(ext==='.woff'&&!ascii.startsWith('wOFF'))return null;
 else if(ext==='.woff2'&&!ascii.startsWith('wOF2'))return null;
 else if(ext==='.ttf'&&!['00010000','74727565'].includes(magic))return null;
 else if(ext==='.otf'&&!ascii.startsWith('OTTO'))return null;
 else if(ext==='.glb'&&!ascii.startsWith('glTF'))return null;
 else if(ext==='.wav'&&!(ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WAVE'))return null;
 else if(ext==='.mp3'&&!(ascii.startsWith('ID3')||(buffer[0]===255&&(buffer[1]&224)===224)))return null;
 else if(ext==='.ogg'&&!ascii.startsWith('OggS'))return null;
 else if(ext==='.mp4'&&ascii.slice(4,8)!=='ftyp')return null;
 else if(ext==='.webm'&&magic!=='1a45dfa3')return null;
 else if(ext==='.psd'&&!ascii.startsWith('8BPS'))return null;
 return {ext,mime:MIME[ext],category:ext.startsWith('.woff')||['.ttf','.otf'].includes(ext)?'font':textExt.has(ext)?'text':'document'};
}
export function imagePreview(mime){return ['image/png','image/jpeg','image/webp'].includes(mime);}
