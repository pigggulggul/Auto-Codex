import { readPng } from './lib/read-png.mjs';
import { readFile } from 'node:fs/promises';
const manifest=JSON.parse(await readFile('src/world/assetManifest.json','utf8'));
const reference=await readPng('public/assets/Home_Designs/Condominium_Designs/48x48/Condominium_Design_2_layer_2_48x48.png');
const examples=[[26,85,80,0,96,.98],[26,85,224,0,96,1],[26,86,368,0,96,.99],[26,86,512,0,96,.94],[2,17,144,32,112,1],[2,17,480,32,112,1],[26,91,288,32,112,1],[2,16,48,192,48,1],[2,16,576,192,48,1],[26,87,48,48,48,1],[26,87,192,48,48,1],[26,87,423,48,48,1],[26,87,567,48,48,1],[26,90,96,240,48,1],[26,90,480,240,48,1]];
const assets=[...manifest.interiors,...[87,90,91].map(n=>`/assets/Interiors/Theme_Sorter_Singles_48x48/26_Condominium_Singles_48x48/Condominium_Singles_48x48_${n}.png`)];
for(const [theme,number,ox,oy,height,minimum] of examples){const asset=assets.find(p=>p.split('/').at(-2)?.startsWith(`${theme}_`)&&p.endsWith(`_${number}.png`));if(!asset)throw Error(`Missing ${theme}/${number}`);const image=await readPng('public'+asset);let total=0,equal=0;for(let y=0;y<height;y++)for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4,j=((oy+y)*reference.width+ox+x)*4;if(image.rgba[i+3]!==255)continue;total++;if(image.rgba.readUInt32LE(i)===reference.rgba.readUInt32LE(j))equal++}if(!total||equal/total<minimum)throw Error(`${theme}/${number} at ${ox},${oy}: ${equal}/${total}`)}
console.log(`PASS: ${examples.length} hallway object references checked`);
