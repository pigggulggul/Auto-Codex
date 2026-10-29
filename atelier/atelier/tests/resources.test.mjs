import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeSample,allDecisions,decision,makeSnapshot} from '../public/domain.js';
import {zip} from '../src/zip.mjs';
import {testServer} from './local-server.mjs';

test('non-image bytes, source filenames, scoped ZIP, backup and restart remain connected',async()=>{
 const server=await testServer(14318),{api,base}=server;
 try{
  let p=makeSample('photo');allDecisions(p).forEach(d=>{d.status='confirmed';d.reviewNeeded=false;});p.concepts[0].selected=true;
  assert.equal((await api('/projects','POST',p)).status,201);
  const font=await readFile(new URL('../public/assets/instrument-serif.woff2',import.meta.url));
  const documents=[['메모.md',Buffer.from('# 실제 메모\n한글 파일 유지')],['고객자료.json',Buffer.from('{"source":"사용자 조사 전 가설"}')],['프레임.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')],['제목.woff2',font],['별도팩.zip',zip([{name:'OTHER_PRIVATE_FILE.txt',data:'UNRELATED-BYTES-MUST-NOT-LEAK'}])]];
  const files=[];
  for(const [name,bytes]of documents){const r=await api(`/projects/${p.id}/files`,'POST',{name,data:bytes.toString('base64'),role:'asset'});assert.equal(r.status,201,JSON.stringify(r.body));files.push(r.body);const downloaded=await fetch(`${base}/api/projects/${p.id}/files/${r.body.id}?download=1`);assert(downloaded.headers.get('content-disposition').includes(encodeURIComponent(name)));assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);}
  for(const [i,f]of files.entries())p.assets.push(decision(documents[i][0],'user','confirmed',{fileId:f.id,availability:'보유',screenIds:[i===4?p.screens[4].id:p.screens[0].id],scopeMode:'targets',purpose:'실제 자료',rules:'원본 유지'}));
  const type=p.styles.find(d=>d.role==='서체');type.fontAssetId=p.assets.find(a=>a.fileId===files[3].id).id;type.screenIds=[p.screens[0].id];type.scopeMode='targets';
  p.output.selection={mode:'screens',ids:[p.screens[0].id]};p.intent={choice:'match',reason:'선택 화면과 실제 파일 확인',revision:p.revision};const snap=makeSnapshot(p);
  assert(!snap.referenceFileIds.includes(files[4].id));assert.equal(snap.referenceFileIds.length,4);
  const saved=await api('/projects/'+p.id,'PUT',p);assert.equal(saved.status,200,JSON.stringify(saved.body));p=saved.body;
  const bundle=await fetch(`${base}/api/projects/${p.id}/bundle?snapshot=${snap.id}`),bytes=Buffer.from(await bundle.arrayBuffer());assert.equal(bundle.status,200);assert(bytes.includes(font));assert(bytes.includes(Buffer.from('handoff.json')));assert(!bytes.includes(Buffer.from('project.atelier.json')));assert(!bytes.includes(Buffer.from('UNRELATED-BYTES-MUST-NOT-LEAK')));assert(!bytes.includes(Buffer.from(files[4].id)));assert(bytes.includes(Buffer.from(encodeURIComponent('메모.md')))||bytes.includes(Buffer.from('메모.md')));
  const backup=(await api(`/projects/${p.id}/backup`)).body;assert.equal(backup.files.length,5);const restored=await api('/restore','POST',backup);assert.equal(restored.status,201,JSON.stringify(restored.body));assert.equal(restored.body.assets.filter(a=>a.fileId).length,5);for(const f of files){const a=await fetch(`${base}/api/projects/${restored.body.id}/files/${f.id}`);assert.equal(a.status,200);}
  const bad=structuredClone(backup);bad.files[0].name='malware.exe';assert.equal((await api('/restore','POST',bad)).status,400);assert.equal((await api('/projects')).body.length,2);
  assert.equal((await api(`/projects/${p.id}/files`,'POST',{name:'wrong.woff2',data:Buffer.from('not a font').toString('base64'),role:'asset'})).status,400);
  assert.equal((await api(`/projects/${p.id}/files`,'POST',{name:'ref.svg',data:documents[2][1].toString('base64'),role:'reference'})).status,400);
  await server.restart();const current=(await api('/projects/'+p.id)).body;assert.equal(current.output.selection.ids[0],p.screens[0].id);assert.equal(current.snapshots[0].referenceFileIds.length,4);assert.equal((await api('/projects/'+p.id+'/files')).body.missing.length,0);
 }finally{await server.stop();}
});
