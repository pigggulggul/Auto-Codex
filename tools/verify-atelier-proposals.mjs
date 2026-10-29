// Actual bridge/worker/SQLite with synthetic App Server. Never calls a model.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');await mkdir(path.join(root,'.cache'),{recursive:true});const scratch=await mkdtemp(path.join(root,'.cache','atelier-proposal-ws-'));
await cp(path.join(root,'build-server'),path.join(scratch,'build-server'),{recursive:true});await cp(path.join(root,'tools/fixtures/proposal-app-server.mjs'),path.join(scratch,'app-server'));
const port=4882,requests=path.join(scratch,'requests.jsonl');let child,socket;let messages=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await delay(25);}throw new Error('Timeout '+label);}
let tokens=18,at=Date.now();
async function rpc(type,payload={}){if(!type.startsWith('transfer.')){for(;;){const now=Date.now();tokens=Math.min(18,tokens+(now-at)/1000);at=now;if(tokens>=1)break;await delay(100);}tokens--;}
 const clientRequestId=randomUUID(),start=messages.length;socket.send(JSON.stringify({type:'atelier.'+type,v:1,clientRequestId,payload}));await until(()=>messages.slice(start).some(m=>m.clientRequestId===clientRequestId),type);return messages.slice(start).find(m=>m.clientRequestId===clientRequestId);}
async function ok(type,payload){const r=await rpc(type,payload);assert(r.ok,JSON.stringify(r));return r.result;}
let p;
async function update(type,payload){await ok(type,{designProjectId:p.id,expectedVersion:p.version,...payload});const r=await ok('project.load',{designProjectId:p.id});p=r.project;}
async function request(mode='normal'){if(p.idea!=='synthetic-mode:'+mode)await update('project.update',{patch:{idea:'synthetic-mode:'+mode}});const fields=await ok('entity.list',{designProjectId:p.id,kind:'fields'});const id=fields.items[0].id;const payload={designProjectId:p.id,expectedVersion:p.version,revision:p.revision,purpose:'brief',targetIds:[id],model:'fixture',idempotencyKey:randomUUID()};const r=await ok('ai.propose',payload);return {id:r.proposalId,payload};}
async function completed(id,state){let r;await until(async()=>{const list=await ok('proposal.list',{designProjectId:p.id});r=list.items.find(r=>r.id===id);return r&&r.state===state;},state);return (await ok('proposal.read',{designProjectId:p.id,proposalId:id})).proposal;}
try{
 child=spawn(process.execPath,[path.join(scratch,'build-server/server/index.js')],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTO_CODEX_PORT:String(port),CODEX_BIN:process.execPath,AUTO_CODEX_TEST_REQUESTS:requests}});let listening=false;let errors='';child.stdout.on('data',d=>{if(String(d).includes('Auto Codex bridge'))listening=true;});child.stderr.on('data',d=>errors+=d);await until(()=>listening,'listen');
 socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:`http://127.0.0.1:${port}`});socket.on('message',d=>messages.push(JSON.parse(String(d))));await until(()=>messages.some(m=>m.type==='models.list'&&m.models.length),'fixture model '+errors);
 socket.send(JSON.stringify({type:'workspace.mode',mode:'research'}));await until(()=>messages.findLast(m=>m.type==='bridge.state')?.snapshot.workspaceMode==='research','research');socket.send(JSON.stringify({type:'workspace.network',enabled:true}));await until(()=>messages.findLast(m=>m.type==='bridge.state')?.snapshot.researchNetworkAccess,'network option');
 p=(await ok('project.create',{name:'Synthetic proposal protocol QA',idea:'synthetic-mode:normal',entry:'idea',type:'아직 미정'})).project;
 const originalConversation=messages.findLast(m=>m.type==='conversation.state').state;
 const normal=await request();let r=await completed(normal.id,'ready');assert(r.source.threadId&&r.source.turnId);assert.equal(r.candidates[0].state,'proposed');assert.equal((await ok('project.load',{designProjectId:p.id})).project.version,p.version);
 const duplicate=await ok('ai.propose',normal.payload);assert.equal(duplicate.proposalId,normal.id);assert.equal(duplicate.reused,true);
 const bad=await request('bad');assert.equal((await completed(bad.id,'failed')).error.code,'INVALID_OUTPUT');
 const fail=await request('fail');assert.equal((await completed(fail.id,'failed')).error.code,'MODEL_FAILED');
 const early=await request('early');assert.equal((await completed(early.id,'ready')).state,'ready');
 const permission=await request('permission');assert.equal((await completed(permission.id,'failed')).error.code,'POLICY_DENIED');assert(!messages.some(m=>m.type==='approval.request'));
 const hold=await request('hold');let boundary=messages.length;socket.send(JSON.stringify({type:'turn.start',prompt:'Must be blocked by active proposal',skillMode:'auto',executionMode:'solo'}));await until(()=>messages.slice(boundary).some(m=>m.type==='error'&&m.message.includes('Atelier proposal')),'general lock');
 assert.equal((await rpc('ai.propose',{...hold.payload,idempotencyKey:randomUUID()})).error.code,'BUSY');
 assert.equal((await rpc('project.delete',{designProjectId:p.id,expectedVersion:p.version,confirmation:{projectId:p.id}})).error.code,'BUSY');assert.equal((await rpc('ai.interrupt',{designProjectId:p.id,proposalId:'proposal_foreign'})).error.code,'NOT_FOUND');
 const fields=(await ok('entity.list',{designProjectId:p.id,kind:'fields'})).items;boundary=messages.length;await ok('ai.interrupt',{designProjectId:p.id,proposalId:hold.id});assert.equal((await completed(hold.id,'interrupted')).error.code,'INTERRUPTED');
 const oldReady=await request('normal');r=await completed(oldReady.id,'ready');await update('project.update',{patch:{name:'Changed after response'}});assert.equal((await rpc('proposal.apply',{designProjectId:p.id,expectedVersion:p.version,proposalId:r.id,proposalVersion:r.version,candidateIds:[r.candidates[0].id]})).error.code,'STALE_INPUT');
 assert.equal(messages.filter(m=>m.type==='assistant.text'&&m.text).length,0);assert.deepEqual(messages.findLast(m=>m.type==='conversation.state').state.messages,originalConversation.messages);
 boundary=messages.length;socket.send(JSON.stringify({type:'turn.start',prompt:'Synthetic ordinary turn synthetic-mode:hold',skillMode:'auto',executionMode:'solo'}));const blocked=await rpc('ai.propose',{...oldReady.payload,idempotencyKey:randomUUID()});assert.equal(blocked.error.code,'BUSY');socket.send(JSON.stringify({type:'turn.interrupt'}));await until(()=>messages.slice(boundary).some(m=>m.type==='turn.state'&&m.status==='interrupted'),'general turn restored');
 const rejected=await request('startfail');const rejectedRecord=await completed(rejected.id,'failed');assert.equal(rejectedRecord.error.code,'MODEL_FAILED');assert(rejectedRecord.source.threadId);await until(()=>messages.findLast(m=>m.type==='bridge.state')?.snapshot.appServerReady===false,'stopped child reflected');const recovered=await request('normal');await completed(recovered.id,'ready');assert.equal(messages.findLast(m=>m.type==='bridge.state').snapshot.appServerReady,true);
 const log=(await readFile(requests,'utf8')).trim().split('\n').map(JSON.parse);const turns=log.filter(m=>m.method==='turn/start'&&m.params.outputSchema);assert(turns.length>=7);for(const turn of turns){assert.deepEqual(turn.params.sandboxPolicy,{type:'readOnly',networkAccess:false});assert.equal(turn.params.approvalPolicy,'never');}assert(!log.some(m=>m.method==='thread/shellCommand'));
 const evidence={ok:true,synthetic:true,liveModel:false,sharedAppServer:true,readOnlyNetworkOff:true,earlyCompletion:true,invalidOutput:true,modelFailure:true,policyDenied:true,staleApply:true,interrupt:true,globalLockBothDirections:true,startFailureRecovery:true,activeDeleteDenied:true,interruptCorrelation:true,conversationUnchangedByProposal:true,proposalTurns:turns.length};await writeFile(path.join(root,'docs/atelier/STAGE5_WS_EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{socket?.close();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
