// End-to-end local bridge + worker + SQLite + synthetic JSONL child. No live model calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {AtelierHandlers} from '../build-server/server/atelier/handlers.js';
import {domain} from '../build-server/server/atelier/validation.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');await mkdir(path.join(root,'.cache'),{recursive:true});const scratch=await mkdtemp(path.join(root,'.cache','atelier-generation-ws-'));
const ui=process.argv.includes('--ui');
await cp(path.join(root,'build-server'),path.join(scratch,'build-server'),{recursive:true});await cp(path.join(root,'tools/fixtures/generation-app-server.mjs'),path.join(scratch,'app-server'));
if(ui)await cp(path.join(root,'dist'),path.join(scratch,'dist'),{recursive:true});
const workspace=path.join(scratch,'workspace'),codexHome=path.join(scratch,'codex-home');await mkdir(workspace);await mkdir(codexHome);await writeFile(path.join(codexHome,'config.toml'),`[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`);
const seed=await AtelierHandlers.open(scratch);const p=domain.makeSample('photo');for(const d of domain.allDecisions(p)){d.status='confirmed';d.reviewNeeded=false;}p.intent={choice:'match',revision:p.revision};
const snapshots={};for(const mode of ['normal','fail','approval','hold','early','earlywrong','startfail','slow']){p.output.extra='GENMODE='+mode;domain.makeSnapshot(p);snapshots[mode]=p.snapshots.at(-1).id;}await seed.store.insert(p);await seed.store.close();
const port=4883,logfile=path.join(scratch,'requests.jsonl');let child,socket,messages=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await delay(25);}throw new Error('Timeout: '+label);}
let tokens=17,at=Date.now();
async function rpc(type,payload={}){for(;;){const now=Date.now();tokens=Math.min(17,tokens+(now-at)/1000);at=now;if(tokens>=1)break;await delay(50);}tokens--;const id=randomUUID();const start=messages.length;socket.send(JSON.stringify({type:'atelier.'+type,v:1,clientRequestId:id,payload}));await until(()=>messages.slice(start).some(m=>m.clientRequestId===id),type);return messages.slice(start).find(m=>m.clientRequestId===id);}
async function ok(type,payload){const r=await rpc(type,payload);assert(r.ok,JSON.stringify(r));return r.result;}
const last=t=>messages.findLast(m=>m.type===t);
async function connect(){socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:`http://127.0.0.1:${port}`});socket.on('message',d=>messages.push(JSON.parse(String(d))));await once(socket,'open');await until(()=>last('conversation.state'),'conversation sync');}
async function boot(){messages=[];child=spawn(process.execPath,[path.join(scratch,'build-server/server/index.js'),...(ui?['--serve']:[])],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CODEX_HOME:codexHome,AUTO_CODEX_PORT:String(port),CODEX_BIN:process.execPath,AUTO_CODEX_TEST_REQUESTS:logfile}});let listening=false;let errors='';child.stdout.on('data',d=>{if(String(d).includes('Auto Codex bridge'))listening=true;});child.stderr.on('data',d=>errors+=d);await until(()=>listening,'bridge listening '+errors);await connect();await until(()=>last('models.list')?.models.length,'model');}
async function stop(){socket?.terminate();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
let binding;
function request(mode,executionMode='solo'){return {designProjectId:p.id,expectedVersion:p.version,snapshotId:snapshots[mode],bindingId:binding.id,purpose:'create',executionMode,skillMode:'manual',model:'fixture',effort:'low',idempotencyKey:randomUUID()};}
async function state(id,status){let g;await until(async()=>{g=(await ok('generation.get',{designProjectId:p.id,generationId:id})).generation;return g.state===status;},status);await delay(70);return g;}
try{
 await boot();socket.send(JSON.stringify({type:'project.select',path:workspace}));await until(()=>last('bridge.state')?.snapshot.projectPath===workspace,'select workspace');
 binding=(await ok('binding.set',{designProjectId:p.id,expectedVersion:p.version,conversationId:last('bridge.state').snapshot.activeConversationId})).binding;
 if(ui){await writeFile(path.join(root,'.cache/stage6-ui.json'),JSON.stringify({projectId:p.id,snapshots,url:`http://127.0.0.1:${port}`,scratch}));console.log(`Synthetic UI fixture only: http://127.0.0.1:${port}`);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());await once(child,'exit');process.exit(0);}
 const firstRequest=request('normal'),first=(await ok('generation.start',firstRequest)).generation;const done=await state(first.id,'completed');assert(done.runtime.threadId&&done.runtime.turnId);assert(!done.runtime.runId);const artifact=(await ok('artifact.get',{designProjectId:p.id,generationId:first.id})).manifest;assert.equal(artifact.status,'unverifiable');assert.equal(artifact.files.length,0);assert.equal(done.messageIds.length,2);
 const duplicate=await ok('generation.start',firstRequest);assert.equal(duplicate.generation.id,first.id);assert(duplicate.reused);
 assert.equal((await rpc('generation.start',{...firstRequest,executionMode:'team'})).error.code,'IDEMPOTENCY_CONFLICT');
 const failed=(await ok('generation.start',request('fail'))).generation;await state(failed.id,'failed');
 const early=(await ok('generation.start',request('early'))).generation;await state(early.id,'completed');assert.equal(last('bridge.state').snapshot.turnId,null);
 const wrong=(await ok('generation.start',request('earlywrong'))).generation;await state(wrong.id,'completed');assert(!messages.some(m=>m.type==='assistant.text'&&m.text.includes('WRONG_EARLY_MUST_NOT_ATTACH')));
 const approvalStart=messages.length;const approval=(await ok('generation.start',request('approval'))).generation;
 await until(()=>messages.slice(approvalStart).some(m=>m.type==='approval.request'),'pending approval');await state(approval.id,'waitingApproval');
 const approvalId=messages.slice(approvalStart).find(m=>m.type==='approval.request').approval.approvalId;
 socket.send(JSON.stringify({type:'approval.resolve',approvalId,decision:'decline'}));await state(approval.id,'failed');
 let boundary=messages.length;socket.send(JSON.stringify({type:'approval.resolve',approvalId,decision:'accept'}));await until(()=>messages.slice(boundary).some(m=>m.type==='error'),'expired approval denied');
 const heldRequest=request('hold'),held=(await ok('generation.start',heldRequest)).generation;await state(held.id,'running');
 assert.equal((await ok('generation.start',heldRequest)).generation.id,held.id);
 assert.equal((await rpc('generation.start',request('normal'))).error.code,'BUSY');
 assert.equal((await rpc('ai.propose',{designProjectId:p.id,expectedVersion:p.version,revision:p.revision,purpose:'brief',targetIds:[p.fields.product.id],idempotencyKey:randomUUID()})).error.code,'BUSY');
 const observer=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:`http://127.0.0.1:${port}`});await once(observer,'open');const observerReplies=[];observer.on('message',d=>observerReplies.push(JSON.parse(String(d))));const observerId=randomUUID();observer.send(JSON.stringify({type:'atelier.generation.start',v:1,clientRequestId:observerId,payload:heldRequest}));await until(()=>observerReplies.some(r=>r.clientRequestId===observerId),'second window dedup');assert.equal(observerReplies.find(r=>r.clientRequestId===observerId).result.generation.id,held.id);observer.terminate();
 boundary=messages.length;socket.send(JSON.stringify({type:'turn.start',prompt:'must not run',skillMode:'auto',executionMode:'solo'}));await until(()=>messages.slice(boundary).some(m=>m.type==='error'&&m.message.includes('generation')),'global lock');
 assert.equal((await rpc('generation.interrupt',{designProjectId:p.id,generationId:first.id})).error.code,'NOT_FOUND');
 socket.terminate();messages=[];await connect();assert.equal((await ok('generation.get',{designProjectId:p.id,generationId:held.id})).generation.state,'running');
 await ok('generation.interrupt',{designProjectId:p.id,generationId:held.id});await state(held.id,'interrupted');
 boundary=messages.length;socket.send(JSON.stringify({type:'turn.start',prompt:'GENMODE=hold ordinary work',skillMode:'manual',executionMode:'solo'}));await until(()=>messages.slice(boundary).some(m=>m.type==='turn.state'&&m.status==='inProgress'),'ordinary hold');assert.equal((await rpc('generation.start',request('normal'))).error.code,'BUSY');socket.send(JSON.stringify({type:'turn.interrupt'}));await until(()=>messages.slice(boundary).some(m=>m.type==='turn.state'&&m.status==='interrupted'),'ordinary interrupt');
 boundary=messages.length;const slowPromise=rpc('generation.start',request('slow'));await until(()=>messages.slice(boundary).some(m=>m.type==='atelier.generation.state'&&m.payload.state==='preparing'),'preparing event');const slowId=messages.slice(boundary).find(m=>m.type==='atelier.generation.state').payload.generationId;await ok('generation.interrupt',{designProjectId:p.id,generationId:slowId});await slowPromise;await state(slowId,'interrupted');
 const team=(await ok('generation.start',request('normal','team'))).generation;const teamDone=await state(team.id,'completed');assert(teamDone.runtime.runId);assert(teamDone.runtime.tasks.length>=4);assert(teamDone.runtime.tasks.every(t=>t.threadId&&t.turnId));
 const lost=(await ok('generation.start',request('startfail'))).generation;await state(lost.id,'interrupted');
 const recovered=(await ok('generation.start',request('normal'))).generation;await state(recovered.id,'completed');
 const restartRequest=request('hold'),restart=(await ok('generation.start',restartRequest)).generation;await state(restart.id,'running');await stop();await boot();
 const historical=(await ok('generation.get',{designProjectId:p.id,generationId:restart.id})).generation;assert.equal(historical.state,'interrupted');assert.equal(historical.error.code,'RUNTIME_OUTCOME_UNKNOWN');
 assert.equal((await ok('generation.start',restartRequest)).generation.id,restart.id);
 const archive=JSON.parse(await readFile(path.join(scratch,'.local-data/history.json'),'utf8'));const conversation=archive.conversations.find(c=>c.id===done.conversationId);assert(conversation);assert(conversation.messages.some(m=>m.id===done.messageIds[0]));assert(!JSON.stringify(archive).includes('LATE_MUST_NOT_ATTACH'));assert(!JSON.stringify(archive).includes('FOREIGN_MUST_NOT_ATTACH'));
 const log=(await readFile(logfile,'utf8')).trim().split('\n').map(JSON.parse);assert(!log.some(m=>m.method==='thread/shellCommand'));const turns=log.filter(m=>m.method==='turn/start');assert(turns.every(t=>t.params.sandboxPolicy.networkAccess===false));assert(turns.some(t=>t.params.sandboxPolicy.type==='readOnly'));assert(turns.some(t=>t.params.sandboxPolicy.type==='workspaceWrite'));
 const evidence={ok:true,synthetic:true,liveModel:false,solo:true,team:true,inputManifest:true,actualRuntimeIds:true,conversationMessageIds:true,approvalDenied:true,expiredApprovalDenied:true,interrupt:true,preparationInterruptSameSocket:true,multipleWindows:true,proposalLock:true,reconnectNoReplay:true,restartUnknownNoReplay:true,idempotencyConflict:true,globalLockBothDirections:true,lateForeignEventsRejected:true,startFailureRecovery:true,networkDefaultOff:true,turns:turns.length};await writeFile(path.join(root,'docs/atelier/STAGE6_WS_EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await stop();}
