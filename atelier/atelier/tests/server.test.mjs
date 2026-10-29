import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newProject,makeSample,allDecisions,makeSnapshot} from '../public/domain.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function launch(data,port){const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,ATELIER_DATA:data,PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',c=>log+=c);for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return child;}catch{}if(child.exitCode!==null)throw new Error(log);await delay(30);}throw new Error('test server startup timeout '+log);}
async function stop(child){if(child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
test('SQLite restart, binary backup/restore, stale writes, project isolation and actual ZIP',async()=>{
 await mkdir(path.join(root,'test-results'),{recursive:true});
 const dir=await mkdtemp(path.join(root,'test-results','server-')),port=14317;let server=await launch(dir,port);const base=`http://127.0.0.1:${port}`;
 const api=async(url,method='GET',body)=>{const r=await fetch(base+'/api'+url,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 try{
 let p=makeSample('photo');allDecisions(p).forEach(d=>{d.status='confirmed';d.reviewNeeded=false;});p.concepts[0].selected=true;p.intent={choice:'match',revision:p.revision};let r=await api('/projects','POST',p);assert.equal(r.status,201);
 const f=await api(`/projects/${p.id}/files`,'POST',{name:'원본.png',data:PNG});assert.equal(f.status,201,JSON.stringify(f.body));p.assets[0].fileId=f.body.id;p.assets[0].availability='보유';
 const s=makeSnapshot(p);r=await api('/projects/'+p.id,'PUT',p);assert.equal(r.status,200);p=r.body;
 // Conflicting stale edit must preserve the first writer.
 const stale={...p,version:p.version-1,name:'오래된 덮어쓰기'};assert.equal((await api('/projects/'+p.id,'PUT',stale)).status,409);assert.notEqual((await api('/projects/'+p.id)).body.name,stale.name);
 // Existing snapshots cannot be silently changed through persistence.
 const corrupt=structuredClone(p);corrupt.snapshots[0].text='changed';assert.equal((await api('/projects/'+p.id,'PUT',corrupt)).status,400);
 let b=(await api('/projects/'+p.id+'/backup')).body;assert.equal(b.files[0].data,PNG);assert(b.project.snapshots[0].referenceFileIds.includes(f.body.id));
 const bad={...b,files:[]};assert.equal((await api('/restore','POST',bad)).status,400);assert.equal((await api('/projects')).body.length,1);
 const restored=await api('/restore','POST',b);assert.equal(restored.status,201);assert.notEqual(restored.body.id,p.id);assert.equal(restored.body.assets[0].fileId,f.body.id);
 const image=await fetch(base+`/api/projects/${restored.body.id}/files/${f.body.id}`);assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),PNG);
 const other=newProject({name:'다른 프로젝트'});await api('/projects','POST',other);assert.equal((await api(`/projects/${other.id}/files/${f.body.id}`)).status,400);
 const zip=Buffer.from(await (await fetch(base+`/api/projects/${p.id}/bundle?snapshot=${s.id}`)).arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);assert(zip.includes(Buffer.from(PNG,'base64')));assert(zip.includes(Buffer.from('prompt.md')));assert(zip.includes(Buffer.from(s.text)));
 assert.equal((await api(`/projects/${p.id}/files`,'POST',{name:'bad.svg',data:Buffer.from('<svg/>').toString('base64')})).status,400);
 await stop(server);server=await launch(dir,port);const resumed=(await api('/projects/'+p.id)).body;assert.equal(resumed.snapshots[0].text,s.text);assert.equal(resumed.assets[0].fileId,f.body.id);assert((await api('/projects/'+p.id+'/files')).body.files[0].exists);
 const cross=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'});assert.equal(cross.status,400);
 assert.equal((await api('/projects/'+other.id,'DELETE',{})).status,200);assert.equal((await api('/projects')).body.length,2);
 }finally{await stop(server);await rm(dir,{recursive:true,force:true});}
});
test('runtime assets and modules have no remote dependency',async()=>{const html=await readFile(path.join(root,'public/index.html'),'utf8'),css=await readFile(path.join(root,'public/styles.css'),'utf8');assert(!html.includes('https://'));assert(!css.includes('https://'));for(const file of ['instrument-serif.woff2','instrument-sans.woff2','icons/flow.svg'])assert((await readFile(path.join(root,'public/assets',file))).length>0);});

