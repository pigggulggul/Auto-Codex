import { readFile } from 'node:fs/promises';
import { readPng } from './lib/read-png.mjs';
const designs=[['condoLobbyTiles.json','Condominium_Design','Condominium_Designs'],['condoHallTiles.json','Condominium_Design_2','Condominium_Designs'],['gymSmallTiles.json','Gym_2','Gym_Designs'],['iceCreamTiles.json','Ice_Cream_Shop_Design','Ice-Cream_Shop_Designs']];
const cache=new Map();
for(const [file,name,folder] of designs){
 const tiles=JSON.parse(await readFile(`src/world/${file}`,'utf8'));
 const original=await readPng(`public/assets/Home_Designs/${folder}/48x48/${name}_layer_1_48x48.png`);
 for(const t of tiles){let img=cache.get(t.src);if(!img){img=await readPng('public'+t.src);cache.set(t.src,img)}for(let y=0;y<48;y++)for(let x=0;x<48;x++){let actual=img.rgba.readUInt32LE(((t.sy+y)*img.width+t.sx+x)*4);let expected=original.rgba.readUInt32LE(((t.y+y)*original.width+t.x+x)*4);if(actual!==expected)throw Error(`${name} tile differs at ${t.x},${t.y}: ${t.src}`)}}
 console.log(`PASS: ${tiles.length} ${name} tiles match`);
}
