import {readPng} from './lib/read-png.mjs';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const tile=48;
function digest(image,x,y){const hash=createHash('sha256');for(let row=0;row<tile;row++)hash.update(image.rgba.subarray(((y+row)*image.width+x)*4,((y+row)*image.width+x+tile)*4));return hash.digest('hex')}
const raw=JSON.parse(await readFile('src/world/roomBuilderTiles.json','utf8'));
const byHash=new Map();
for(const [name,entries] of Object.entries(raw)){
 const src='/assets/Interiors/Room_Builder_subfiles_48x48/'+name;
 const image=await readPng('public'+src);
 for(const [x,y,w,h] of entries){if(w!==tile||h!==tile||x+tile>image.width||y+tile>image.height)continue;const key=digest(image,x,y);if(!byHash.has(key))byHash.set(key,[]);byHash.get(key).push({src,x,y});}
}
const dir='docs/home-design-coordinate-survey';
for(const file of (await readdir(dir)).filter(f=>f.endsWith('.json')&&!f.endsWith('.matches.json')&&!f.endsWith('.tiles.json'))){
 const data=JSON.parse(await readFile(`${dir}/${file}`,'utf8')); const layer=data.layers[0]; const image=await readPng(layer.file); const rows=[];
 for(let y=0;y+tile<=image.height;y+=tile)for(let x=0;x+tile<=image.width;x+=tile){
  let visible=0;for(let j=0;j<tile;j++)for(let i=0;i<tile;i++)if(image.rgba[((y+j)*image.width+x+i)*4+3])visible++;
  const matches=visible?byHash.get(digest(image,x,y))??[]:[];
  rows.push({x,y,kind:visible===0?'transparent':matches.length?'exact':'unresolved',matches});
 }
 const result={name:data.name,source:layer.file,tileSize:tile,width:image.width,height:image.height,partialRight:image.width%tile,partialBottom:image.height%tile,tiles:rows};
 await writeFile(`${dir}/${data.name}.tiles.json`,JSON.stringify(result,null,2)+'\n');
 console.log(data.name,rows.filter(r=>r.kind==='exact').length,rows.filter(r=>r.kind==='unresolved').length,rows.filter(r=>r.kind==='transparent').length);
}
