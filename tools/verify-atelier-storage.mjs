// Run after npm run build. Real bridge/worker/WS, isolated data, deliberately absent CLI.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {WebSocket} from 'ws';
import {supportsNode,preflight} from './check-node.mjs';

assert(!supportsNode('20.19.0'));assert(!supportsNode('22.12.0'));assert(supportsNode('22.13.0'));assert(supportsNode('24.0.0'));await preflight();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(root,'.cache'),{recursive:true});const scratch=await mkdtemp(path.join(root,'.cache','atelier-ws-'));
await cp(path.join(root,'build-server'),path.join(scratch,'build-server'),{recursive:true});
await mkdir(path.join(scratch,'atelier','atelier','data'),{recursive:true});const originalDB=path.join(scratch,'atelier','atelier','data','atelier.sqlite');await writeFile(originalDB,'ORIGINAL DB SENTINEL - MUST NOT OPEN');
const port=4876;let child,socket,received=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function until(predicate,label){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,15));}throw Error('Timed out: '+label);}
async function start(){received=[];let listening=false;child=spawn(process.execPath,[path.join(scratch,'build-server','server','index.js')],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTO_CODEX_PORT:String(port),CODEX_BIN:path.join(scratch,'missing-cli')}});child.stdout.on('data',data=>{if(String(data).includes('Auto Codex bridge'))listening=true;});child.stderr.on('data',()=>{});await until(()=>listening,'bridge start');socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:`http://127.0.0.1:${port}`});socket.on('message',data=>received.push(JSON.parse(String(data))));await once(socket,'open');await until(()=>received.some(r=>r.type==='error'),'clear CLI unavailable error');assert(!received.findLast(r=>r.type==='bridge.state').snapshot.appServerReady);}
async function stop(hard=false){socket?.close();if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill(hard?'SIGKILL':'SIGTERM');await exited;}}
async function request(type,payload={},ok=true){const clientRequestId=randomUUID();socket.send(JSON.stringify({type:'atelier.'+type,v:1,clientRequestId,payload}));await until(()=>received.some(r=>r.clientRequestId===clientRequestId),'response '+type);const reply=received.find(r=>r.clientRequestId===clientRequestId);assert.equal(reply.ok,ok,JSON.stringify(reply.error));return ok?reply.result:reply.error;}
async function download(descriptor){const chunks=[];for(let index=0;;index++){const r=await request('transfer.read',{transferId:descriptor.transferId,index});chunks.push(Buffer.from(r.dataBase64,'base64'));if(r.last)break;}const bytes=Buffer.concat(chunks);assert.equal(hash(bytes),descriptor.sha256);return bytes;}
async function upload(bytes,pid,name='backup.json'){const t=await request('transfer.begin',{direction:'upload',purpose:pid?'file':'backup-import',...(pid?{designProjectId:pid,fileRole:'asset'}:{}),name,totalBytes:bytes.length,sha256:hash(bytes)});for(let position=0,index=0;position<bytes.length;position+=256*1024,index++)await request('transfer.chunk',{transferId:t.transfer.transferId,index,dataBase64:bytes.subarray(position,position+256*1024).toString('base64')});return request('transfer.finish',{transferId:t.transfer.transferId});}

try{
 await start();
 const historyPath=path.join(scratch,'.local-data/history.json');await until(async()=>{try{await readFile(historyPath);return true;}catch{return false;}},'initial legacy history save');const historyBefore=await readFile(historyPath);
 assert((await request('capabilities')).operations.includes('atelier.backup.import'));
 const created=await request('project.create',{name:'로컬 설계 WS 검증',idea:'CLI 없이 저장',entry:'idea',type:'제작 도구'}),pid=created.project.id;
 const file=(await upload(Buffer.from('# 실제 업로드 바이트'),pid,'notes.md')).file;
 const read=await request('file.read',{designProjectId:pid,fileId:file.id});assert.equal((await download(read.download)).toString(),'# 실제 업로드 바이트');
 await request('entity.mutate',{designProjectId:pid,expectedVersion:1,kind:'assets',action:'add',value:{value:'실제 메모',fileId:file.id}});
 await request('snapshot.create',{designProjectId:pid,expectedVersion:2,mode:'baseline',reason:'WS 통합의 합성 진단 기준'});
 const backupDescriptor=await request('backup.export',{designProjectId:pid,format:'atelier-backup'}),backup=await download(backupDescriptor.download);
 const saved=JSON.parse(backup.toString());assert(saved.project.snapshots[0].draft);assert.equal(saved.files[0].data,Buffer.from('# 실제 업로드 바이트').toString('base64'));
 const bundle=await request('bundle.export',{designProjectId:pid,snapshotId:saved.project.snapshots[0].id});assert.equal((await download(bundle.download)).readUInt32LE(0),0x04034b50);
 const restore=await upload(backup);const imported=await request('backup.import',{transferId:restore.transferId});assert.notEqual(imported.project.id,pid);
 const loaded=await request('project.load',{designProjectId:pid});assert.equal(loaded.project.version,3);
 assert.equal((await request('project.update',{designProjectId:pid,expectedVersion:3,patch:{command:'forbidden'}},false)).code,'INVALID_MESSAGE');
 assert.equal((await request('generation.start',{},false)).code,'CAPABILITY_UNAVAILABLE');
 // A pending upload does not put approval validation behind the design worker queue.
 const unfinished=await request('transfer.begin',{direction:'upload',purpose:'file',designProjectId:pid,fileRole:'asset',name:'interrupted.md',totalBytes:524288,sha256:hash(Buffer.alloc(524288,65))});
 const chunkId=randomUUID();socket.send(JSON.stringify({type:'atelier.transfer.chunk',v:1,clientRequestId:chunkId,payload:{transferId:unfinished.transfer.transferId,index:0,dataBase64:Buffer.alloc(262144,65).toString('base64')}}));
 const boundary=received.length;socket.send(JSON.stringify({type:'approval.resolve',approvalId:'not-pending',decision:'accept'}));
 await until(()=>received.slice(boundary).some(r=>r.type==='error'),'priority approval validation');assert(!received.slice(boundary).some(r=>r.type==='approval.resolved'));
 await until(()=>received.some(r=>r.clientRequestId===chunkId),'chunk ACK');
 assert.deepEqual(await readFile(historyPath),historyBefore);
 await stop(true);await readFile(path.join(scratch,'.local-data/atelier/owner.lock'));await start();
 const resumed=await request('project.load',{designProjectId:pid});assert.equal(resumed.project.version,3);
 assert.equal((await request('transfer.finish',{transferId:unfinished.transfer.transferId},false)).code,'TRANSFER_EXPIRED');
 const again=await request('file.read',{designProjectId:pid,fileId:file.id});assert.equal((await download(again.download)).toString(),'# 실제 업로드 바이트');
 assert.equal(await readFile(originalDB,'utf8'),'ORIGINAL DB SENTINEL - MUST NOT OPEN');
 assert.deepEqual(await readdir(path.join(scratch,'.local-data','atelier','transfers')),[]);
 // Exact-origin and Host guards apply to the actual upgraded WS.
 for(const options of [{origin:'https://example.invalid'},{origin:`http://127.0.0.1:${port}`,headers:{Host:'example.invalid'}}]){
   const bad=new WebSocket(`ws://127.0.0.1:${port}/ws`,options);const denied=await new Promise((resolve,reject)=>{bad.on('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);});bad.on('error',reject);});assert.equal(denied,403);bad.terminate();
 }
 let throttled=false;for(let i=0;i<24;i++){const requestId=randomUUID();socket.send(JSON.stringify({type:'atelier.capabilities',v:1,clientRequestId:requestId,payload:{}}));await until(()=>received.some(r=>r.clientRequestId===requestId),'rate response');const reply=received.find(r=>r.clientRequestId===requestId);if(!reply.ok&&reply.error.code==='LIMIT_EXCEEDED')throttled=true;}assert(throttled);
 console.log(JSON.stringify({ok:true,cliAbsent:true,worker:true,restart:true,byteRoundTrip:true,backupNewId:true,originalDBPreserved:true,historyUnchangedByDesign:true,interruptedTransferExpired:true,approvalValidationResponsive:true,originRejected:true,hostRejected:true,rateLimited:true,node:process.versions.node,scratch}));
}finally{await stop();}
