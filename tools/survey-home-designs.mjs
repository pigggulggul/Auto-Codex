import { readdir, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { readPng } from './lib/read-png.mjs';

// Coordinate survey only: connected pixel regions are not semantic objects.
const root = path.resolve('public/assets/Home_Designs');
const output = path.resolve('docs/home-design-coordinate-survey');
async function walk(dir) { const found=[]; for (const item of await readdir(dir,{withFileTypes:true})) { const p=path.join(dir,item.name); if(item.isDirectory()) found.push(...await walk(p)); else found.push(p); } return found; }
function components(image) {
  const {width:w,height:h,rgba}=image, seen=new Uint8Array(w*h), queue=new Int32Array(w*h), boxes=[];
  for(let start=0;start<w*h;start++) {
    if(seen[start] || rgba[start*4+3]===0) continue;
    let head=0,tail=0, minX=w,minY=h,maxX=0,maxY=0,count=0; queue[tail++]=start;seen[start]=1;
    while(head<tail) { const i=queue[head++],x=i%w,y=Math.floor(i/w); count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) { if(!dx&&!dy)continue;let nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;let j=ny*w+nx;if(!seen[j]&&rgba[j*4+3]>0){seen[j]=1;queue[tail++]=j;} }
    }
    if(count>=20) boxes.push({x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1,pixels:count});
  }
  return boxes.sort((a,b)=>a.y-b.y||a.x-b.x);
}
const files=await walk(root), previews=files.filter(f=>/_preview_48x48\.png$/i.test(f)).sort();
await mkdir(output,{recursive:true});const index=[];
for(const preview of previews) {
  const stem=path.basename(preview).replace(/_preview_48x48\.png$/i,'');
  const layers=files.filter(f=>path.dirname(f)===path.dirname(preview)&&new RegExp('^'+stem.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'_layer_\\d+_48x48\\.png$','i').test(path.basename(f))).sort();
  const p=await readPng(preview); const data={name:stem,width:p.width,height:p.height,layers:[]};
  for(const layer of layers) { const img=await readPng(layer);data.layers.push({file:path.relative(process.cwd(),layer).replaceAll('\\','/'),width:img.width,height:img.height,regions:components(img)}); }
  const rel=path.relative(output,preview).replaceAll('\\','/').split('/').map(encodeURIComponent).join('/');
  const grid=[]; for(let x=0;x<=p.width;x+=48)grid.push(`<path d="M${x} 0V${p.height}"/><text x="${x+2}" y="12">${x}</text>`);for(let y=48;y<=p.height;y+=48)grid.push(`<path d="M0 ${y}H${p.width}"/><text x="2" y="${y-3}">${y}</text>`);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}"><image href="${rel}" width="${p.width}" height="${p.height}"/><g fill="none" stroke="#ff2439" stroke-width="1" opacity=".7">${grid.join('').replaceAll(/<text[^>]*>.*?<\/text>/g,'')}</g><g font-size="11" fill="#ff2439" stroke="white" stroke-width="2" paint-order="stroke">${grid.join('').replaceAll(/<path[^>]*\/>/g,'')}</g></svg>`;
  const base=stem.replace(/[^A-Za-z0-9_-]/g,'_'); await writeFile(path.join(output,base+'.svg'),svg);await writeFile(path.join(output,base+'.json'),JSON.stringify(data,null,2)+'\n'); index.push({name:stem,svg:base+'.svg',json:base+'.json',size:`${p.width}×${p.height}`,regions:data.layers.map(l=>l.regions.length)});
}
await writeFile(path.join(output,'README.md'),'# 원본 좌표 조사\n\n48px 격자와 원본 픽셀 좌표를 표시한 도식이다. JSON의 영역은 투명하지 않은 픽셀의 연결 요소로, 사물·벽·문을 구분하거나 가려진 경계를 복원하지 않는다. 작은 20픽셀 미만 영역은 제외된다. 원본 배치의 자동 판정이나 편집 가능 프리셋 완성의 증거가 아니다.\n\n| 디자인 | 크기 | 도식 | 레이어 연결 영역 좌표 |\n|---|---:|---|---|\n'+index.map(x=>`| ${x.name} | ${x.size} | [격자](${x.svg}) | [좌표](${x.json}) (${x.regions.join(', ')}개) |`).join('\n')+'\n');
console.log(`Surveyed ${index.length} designs`);
