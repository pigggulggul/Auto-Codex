import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readdir,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AtelierHandlers} from './handlers.js';
import {domain} from './validation.js';
import {AtelierProposalRuntime} from './proposal-runtime.js';
import type {AtelierClient} from './client.js';
import type {CodexAppServer,JsonObject} from '../codex-app-server.js';
import type {ProposalPurpose,DesignProposal} from '../../shared/atelier/proposals.js';
import type {ModelInfo} from '../../shared/protocol.js';

async function setup(){const parent=path.resolve('.cache');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'atelier-proposals-'));const service=await AtelierHandlers.open(root);return {root,service,async close(){await service.store.close();expect(path.dirname(await realpath(root))).toBe(await realpath(parent));await rm(root,{recursive:true,force:true});}};}
const source={kind:'codex-app-server' as const,model:'synthetic-model',threadId:'synthetic-thread',turnId:'synthetic-turn'};
function storageFor(service:AtelierHandlers){return {proposalCall:async(method:string,b:JsonObject)=>method==='prepare'?service.proposals.prepare(b):method==='running'?{proposal:await service.proposals.running(String(b.designProjectId),String(b.proposalId),b.source as DesignProposal['source'])}:method==='complete'?{proposal:await service.proposals.complete(String(b.designProjectId),String(b.proposalId),String(b.text))}:{proposal:await service.proposals.fail(String(b.designProjectId),String(b.proposalId),b.code as 'MODEL_FAILED')}} as unknown as AtelierClient;}
it('separate candidates require explicit application, preserve confirmations and snapshots, edit/exclude per item and propagate impact',async()=>{
 const t=await setup();try{
  const p=domain.makeSample('photo');for(const d of domain.allDecisions(p)){d.status='confirmed';d.reviewNeeded=false;}p.flows[0].dependsOn=[p.fields.product.id];p.concepts[0].selected=true;p.intent={choice:'match',revision:p.revision};domain.makeSnapshot(p);await t.service.store.insert(p);const frozen=JSON.stringify(p.snapshots);
  const selected=[p.fields.product,p.fields.user];const b={designProjectId:p.id,expectedVersion:1,revision:p.revision,purpose:'brief',targetIds:selected.map(d=>d.id),idempotencyKey:randomUUID()};
  const prepared=await t.service.proposals.prepare(b);expect((await t.service.proposals.prepare(b)).proposal.id).toBe(prepared.proposal.id);
  const page=(await t.service.handle('synthetic',JSON.stringify({type:'atelier.proposal.list',v:1,clientRequestId:randomUUID(),payload:{designProjectId:p.id,limit:32}}))).reply;expect(page.ok).toBe(true);
  await t.service.proposals.running(p.id,prepared.proposal.id,source);
  let r=await t.service.proposals.complete(p.id,prepared.proposal.id,JSON.stringify({candidates:selected.map(d=>({targetId:d.id,patch:{value:'synthetic candidate'},rationale:'synthetic rationale',assumptions:'unverified'}))}));
  expect(r.state).toBe('ready');expect((await t.service.store.get(p.id)).fields.product.status).toBe('confirmed');expect((await t.service.store.get(p.id)).version).toBe(1);
  r=await t.service.proposals.edit({designProjectId:p.id,proposalId:r.id,proposalVersion:r.version,candidateId:r.candidates[0].id,patch:{value:'user edited'}});
  expect(r.candidates[0].originalPatch.value).toBe('synthetic candidate');
  const apply={designProjectId:p.id,expectedVersion:1,proposalId:r.id,proposalVersion:r.version,candidateIds:[r.candidates[0].id]};
  const next=await t.service.proposals.apply(apply,p=>t.service.files.validate(p));
  expect(next.fields.product.value).toBe('user edited');expect(next.fields.product.status).toBe('proposed');expect(next.fields.product.history.at(-1)?.status).toBe('confirmed');expect(next.intent).toBeNull();expect(next.flows.some(f=>f.reviewNeeded)).toBe(true);expect(JSON.stringify(next.snapshots)).toBe(frozen);expect(next.fields.user.status).toBe('confirmed');
  r=await t.service.store.proposal(p.id,r.id);r=await t.service.proposals.edit({designProjectId:p.id,proposalId:r.id,proposalVersion:r.version,candidateId:r.candidates[1].id},true);expect(r.candidates[1].state).toBe('excluded');
  await expect(t.service.proposals.apply({...apply,expectedVersion:next.version,proposalVersion:r.version,candidateIds:[r.candidates[1].id]},async()=>{})).rejects.toMatchObject({code:'STALE_INPUT'});
 }finally{await t.close();}
});
it('all four purposes validate owned targets; stale/invalid/image/model failures never overwrite design',async()=>{
 const t=await setup();try{
  const p=domain.makeSample('photo');await t.service.store.insert(p);const other=domain.newProject({name:'other'});await t.service.store.insert(other);
  for(const purpose of ['brief','flow','concept','style'] as ProposalPurpose[]){const target=purpose==='brief'?p.fields.product:purpose==='flow'?p.flows[0]:purpose==='concept'?p.concepts[0]:p.styles[0];const b={designProjectId:p.id,expectedVersion:1,revision:p.revision,purpose,targetIds:[target.id],idempotencyKey:randomUUID()};const q=(await t.service.proposals.prepare(b)).proposal;await t.service.proposals.running(p.id,q.id,source);const ready=await t.service.proposals.complete(p.id,q.id,JSON.stringify({candidates:[{targetId:target.id,patch:{value:'synthetic '+purpose},rationale:'evidence',assumptions:''}]}));expect(ready.state).toBe('ready');}
  const b={designProjectId:p.id,expectedVersion:1,revision:p.revision,purpose:'brief',targetIds:[p.fields.product.id],idempotencyKey:randomUUID()};
  await expect(t.service.proposals.prepare({...b,sandbox:'workspaceWrite'})).rejects.toMatchObject({code:'INVALID_MESSAGE'});
  await expect(t.service.proposals.prepare({...b,targetIds:[other.fields.product.id]})).rejects.toMatchObject({code:'PROJECT_MISMATCH'});
  for(const output of ['not JSON',JSON.stringify({candidates:[]}),JSON.stringify({candidates:[{targetId:p.fields.product.id,patch:{status:'confirmed'},rationale:'x',assumptions:''}]}),JSON.stringify({candidates:[{targetId:other.fields.product.id,patch:{value:'x'},rationale:'x',assumptions:''}]})]){const q=(await t.service.proposals.prepare({...b,idempotencyKey:randomUUID()})).proposal;await t.service.proposals.running(p.id,q.id,source);expect((await t.service.proposals.complete(p.id,q.id,output)).error?.code).toBe('INVALID_OUTPUT');}
  const q=(await t.service.proposals.prepare({...b,idempotencyKey:randomUUID()})).proposal;await t.service.proposals.running(p.id,q.id,source);
  await t.service.store.mutate(p.id,1,p=>domain.touch(p,'synthetic concurrent change'));
  expect((await t.service.proposals.complete(p.id,q.id,'{}')).state).toBe('stale');expect((await t.service.store.get(p.id)).fields.product.value).toBe(p.fields.product.value);
  const file=await t.service.files.add(p.id,'synthetic.txt',Buffer.from('not an image'),'asset');const next=await t.service.store.get(p.id);const image=(await t.service.proposals.prepare({...b,expectedVersion:next.version,revision:next.revision,idempotencyKey:randomUUID(),imageFileIds:[file.id]})).proposal;expect(image.error?.code).toBe('IMAGE_UNSUPPORTED');
 }finally{await t.close();}
});
it('v1 migration backs up existing SQLite; unfinished proposal is durable and interrupted after restart',async()=>{
 const t=await setup();const p=domain.newProject({name:'preserved'});await t.service.store.insert(p);await t.service.store.close();
 const dbpath=path.join(t.root,'.local-data/atelier/atelier.sqlite'),db=new DatabaseSync(dbpath);db.exec('DROP TABLE proposals;PRAGMA user_version=1');db.close();
 let reopened=await AtelierHandlers.open(t.root);try{
  const backups=(await readdir(reopened.store.paths.root)).filter(n=>n.startsWith('atelier-v1-backup-'));expect(backups.length).toBe(1);const backup=new DatabaseSync(path.join(reopened.store.paths.root,backups[0]),{readOnly:true});try{expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1);expect(backup.prepare('SELECT json FROM projects').get()?.json).toBe(JSON.stringify(p));}finally{backup.close();}
  expect(await reopened.store.get(p.id)).toEqual(p);const r=(await reopened.proposals.prepare({designProjectId:p.id,expectedVersion:1,revision:p.revision,purpose:'brief',targetIds:[p.fields.product.id],idempotencyKey:randomUUID()})).proposal;
  await reopened.store.close();reopened=await AtelierHandlers.open(t.root);expect((await reopened.store.proposal(p.id,r.id)).state).toBe('interrupted');expect(await reopened.store.get(p.id)).toEqual(p);
 }finally{await reopened.store.close();expect((await readFile(dbpath)).length).toBeGreaterThan(0);expect(path.dirname(await realpath(t.root))).toBe(await realpath(path.resolve('.cache')));await rm(t.root,{recursive:true,force:true});}
});

it('flow graph proposals validate owned screen/edge IDs and apply through graph version and impact rules',async()=>{
 const t=await setup();try{
  const p=domain.makeSample('photo');await t.service.store.insert(p);const flow=p.flows[0],g=flow.graph!;
  const b={designProjectId:p.id,expectedVersion:1,revision:p.revision,purpose:'flow',targetIds:[flow.id],idempotencyKey:randomUUID()};
  const patch={value:'Synthetic flow candidate',steps:flow.steps,graph:{entryId:g.entryId,terminalIds:g.terminalIds,transitions:g.transitions.map(({id,...e})=>e),branchPolicy:g.branchPolicy,branchReason:g.branchReason,recoveryPolicy:g.recoveryPolicy,recoveryReason:g.recoveryReason}};
  const first=(await t.service.proposals.prepare(b)).proposal;await t.service.proposals.running(p.id,first.id,source);const bad=structuredClone(patch);bad.graph.transitions[0].to='d_foreign';expect((await t.service.proposals.complete(p.id,first.id,JSON.stringify({candidates:[{targetId:flow.id,patch:bad,rationale:'synthetic',assumptions:''}]}))).error?.code).toBe('INVALID_OUTPUT');
  const second=(await t.service.proposals.prepare({...b,idempotencyKey:randomUUID()})).proposal;await t.service.proposals.running(p.id,second.id,source);const ready=await t.service.proposals.complete(p.id,second.id,JSON.stringify({candidates:[{targetId:flow.id,patch,rationale:'synthetic',assumptions:''}]}));expect(ready.state).toBe('ready');
  const next=await t.service.proposals.apply({designProjectId:p.id,expectedVersion:1,proposalId:ready.id,proposalVersion:ready.version,candidateIds:[ready.candidates[0].id]},p=>t.service.files.validate(p));expect(next.flows[0].graph?.version).toBe(g.version+1);expect(next.flows[0].graph?.reviewedVersion).toBe(g.reviewedVersion);expect(next.flows[0].status).toBe('proposed');expect(next.flows[0].graph?.transitions.every(e=>!!e.id)).toBe(true);
 }finally{await t.close();}
});

it('runtime shares admission, forces readOnly/no network, correlates early events and denies permissions without UI approval',async()=>{
 const t=await setup();try{
  const p=domain.newProject({name:'runtime'});await t.service.store.insert(p);const calls:Array<{method:string;params:JsonObject}>=[];let runtime:AtelierProposalRuntime;let generalBusy=false;let stopCount=0;const model={model:'synthetic-model',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[]} as unknown as ModelInfo;
  const storage={proposalCall:async(method:string,b:JsonObject)=>method==='prepare'?t.service.proposals.prepare(b):method==='running'?{proposal:await t.service.proposals.running(String(b.designProjectId),String(b.proposalId),b.source as DesignProposal['source'])}:method==='complete'?{proposal:await t.service.proposals.complete(String(b.designProjectId),String(b.proposalId),String(b.text))}:{proposal:await t.service.proposals.fail(String(b.designProjectId),String(b.proposalId),b.code as 'MODEL_FAILED')}} as unknown as AtelierClient;
  const server={request:async(method:string,params:JsonObject)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'thread-synthetic'}};if(method==='turn/start'){runtime.notification({method:'turn/started',params:{threadId:'thread-synthetic',turn:{id:'turn-synthetic'}}});return {turn:{id:'turn-synthetic'}};}if(method==='turn/interrupt'){runtime.notification({method:'turn/completed',params:{threadId:'thread-synthetic',turn:{id:'turn-synthetic',status:'interrupted'}}});return {};}},respondError:()=>{stopCount++;},stopAndWait:async()=>{}} as unknown as CodexAppServer;
  runtime=new AtelierProposalRuntime(server,storage,{cwd:async()=>t.root,ensure:async()=>{},busy:()=>generalBusy,models:()=>[model],emit:()=>{}});
  const raw=(extra:JsonObject={})=>JSON.stringify({type:'atelier.ai.propose',v:1,clientRequestId:randomUUID(),payload:{designProjectId:p.id,expectedVersion:1,revision:1,purpose:'brief',targetIds:[p.fields.product.id],idempotencyKey:randomUUID(),...extra}});
  expect(runtime.ownsProject(undefined)).toBe(false);generalBusy=true;expect(await runtime.request(raw())).toMatchObject({ok:false,error:{code:'BUSY'}});generalBusy=false;
  expect(await runtime.request(raw({sandboxPolicy:{type:'workspaceWrite'}}))).toMatchObject({ok:false,error:{code:'INVALID_MESSAGE'}});
  expect(await runtime.request(raw())).toMatchObject({ok:true,result:{state:'running'}});expect(runtime.busy).toBe(true);expect(await runtime.request(raw())).toMatchObject({ok:false,error:{code:'BUSY'}});
  expect(calls.find(c=>c.method==='thread/start')?.params).toMatchObject({sandbox:'read-only',approvalPolicy:'never',ephemeral:true});expect(calls.find(c=>c.method==='turn/start')?.params).toMatchObject({sandboxPolicy:{type:'readOnly',networkAccess:false},approvalPolicy:'never',outputSchema:{type:'object'}});
  expect(runtime.notification({method:'item/agentMessage/delta',params:{threadId:'foreign',delta:'foreign'}})).toBe(false);
  expect(runtime.serverRequest({id:'synthetic-permission',method:'item/permissions/requestApproval',params:{threadId:'thread-synthetic',permissions:{network:{enabled:true}}}})).toBe(true);
  for(let i=0;i<40&&runtime.busy;i++)await new Promise(r=>setTimeout(r,5));expect(runtime.busy).toBe(false);expect(stopCount).toBe(1);expect((await t.service.store.proposals(p.id))[0].error?.code).toBe('POLICY_DENIED');expect((await t.service.store.get(p.id)).version).toBe(1);
 }finally{await t.close();}
});

it('model timeout persists failure and holds admission until the exclusively owned child termination is confirmed',async()=>{
 const t=await setup();try{
  const p=domain.newProject({name:'timeout'});await t.service.store.insert(p);let stopping=false,confirmStop:()=>void=()=>{};
  const server={request:async(method:string)=>method==='thread/start'?{thread:{id:'timeout-thread'}}:method==='turn/start'?{turn:{id:'timeout-turn'}}:{},stopAndWait:()=>{stopping=true;return new Promise<void>(resolve=>{confirmStop=resolve;});}} as unknown as CodexAppServer;
  const model={model:'synthetic-model',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[]} as unknown as ModelInfo;
  const runtime=new AtelierProposalRuntime(server,storageFor(t.service),{timeoutMs:15,terminationGraceMs:15,cwd:async()=>t.root,ensure:async()=>{},busy:()=>false,models:()=>[model],emit:()=>{}});
  await runtime.request(JSON.stringify({type:'atelier.ai.propose',v:1,clientRequestId:randomUUID(),payload:{designProjectId:p.id,expectedVersion:1,revision:1,purpose:'brief',targetIds:[p.fields.product.id],idempotencyKey:randomUUID()}}));
  for(let i=0;i<100&&!stopping;i++)await new Promise(r=>setTimeout(r,5));expect(stopping).toBe(true);expect(runtime.busy).toBe(true);expect((await t.service.store.proposals(p.id))[0].error?.code).toBe('MODEL_FAILED');confirmStop();await new Promise(r=>setTimeout(r,5));expect(runtime.busy).toBe(false);
 }finally{await t.close();}
});

it('interrupt while storage preparation is pending never dispatches a model turn',async()=>{
 const t=await setup();try{
  const p=domain.newProject({name:'cancel before model'});await t.service.store.insert(p);let release:()=>void=()=>{},calls=0;const gate=new Promise<void>(resolve=>{release=resolve;});const original=storageFor(t.service);
  const storage={proposalCall:async(method:'prepare'|'running'|'complete'|'fail',b:JsonObject)=>{if(method==='prepare')await gate;return original.proposalCall(method,b);}} as unknown as AtelierClient;
  const server={request:async()=>{calls++;},stopAndWait:async()=>{}} as unknown as CodexAppServer;
  const runtime=new AtelierProposalRuntime(server,storage,{cwd:async()=>t.root,ensure:async()=>{},busy:()=>false,models:()=>[],emit:()=>{}});
  const pending=runtime.request(JSON.stringify({type:'atelier.ai.propose',v:1,clientRequestId:randomUUID(),payload:{designProjectId:p.id,expectedVersion:1,revision:1,purpose:'brief',targetIds:[p.fields.product.id],idempotencyKey:randomUUID()}}));expect(runtime.busy).toBe(true);await runtime.interrupt();release();expect(await pending).toMatchObject({ok:true,result:{state:'interrupted'}});expect(calls).toBe(0);expect(runtime.busy).toBe(false);
 }finally{await t.close();}
});

it('single fenced JSON is validated normally; mixed prose and authority patches still fail closed',async()=>{
 const t=await setup();try{
  const p=domain.newProject({name:'아이디어',idea:'혼자 여행하는 사람의 일정 도구'});await t.service.store.insert(p);
  const b={designProjectId:p.id,expectedVersion:1,revision:1,purpose:'brief',targetIds:[p.fields.product.id],request:'첫 버전 범위를 줄여 주세요.',idempotencyKey:randomUUID()};
  const prepared=await t.service.proposals.prepare(b);expect(JSON.parse(prepared.input!).request).toBe(b.request);expect(JSON.parse(prepared.input!).idea).toBe(p.idea);
  const output=JSON.stringify({candidates:[{targetId:p.fields.product.id,patch:{value:'여행 일정 만들기'},rationale:'아이디어를 구체화',assumptions:'사용자 확인 필요'}]});
  await t.service.proposals.running(p.id,prepared.proposal.id,source);expect((await t.service.proposals.complete(p.id,prepared.proposal.id,'```json\n'+output+'\n```')).state).toBe('ready');
  for(const invalid of ['설명을 붙였습니다.\n'+output,'```json\n'+output+'\n```\n```json\n{}\n```',output.replace('"value":"여행 일정 만들기"','"status":"confirmed"')]){
   const q=(await t.service.proposals.prepare({...b,idempotencyKey:randomUUID()})).proposal;await t.service.proposals.running(p.id,q.id,source);expect((await t.service.proposals.complete(p.id,q.id,invalid)).error?.code).toBe('INVALID_OUTPUT');
  }
  expect((await t.service.store.get(p.id)).version).toBe(1);
 }finally{await t.close();}
});

it('runtime reads final text despite empty content, ignores commentary and keeps final-answer priority',async()=>{
 const t=await setup();try{
  const p=domain.newProject({name:'final output'});await t.service.store.insert(p);
  const output=JSON.stringify({candidates:[{targetId:p.fields.product.id,patch:{value:'올바른 최종 후보'},rationale:'아이디어 근거',assumptions:''}]});
  const server={request:async(method:string)=>method==='thread/start'?{thread:{id:'final-thread'}}:method==='turn/start'?{turn:{id:'final-turn'}}:{},stopAndWait:async()=>{}} as unknown as CodexAppServer;
  const model={model:'synthetic-model',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[]} as unknown as ModelInfo;
  const runtime=new AtelierProposalRuntime(server,storageFor(t.service),{cwd:async()=>t.root,ensure:async()=>{},busy:()=>false,models:()=>[model],emit:()=>{}});
  for(const mode of ['completed','delta-only','legacy-comment']){
   const reply=await runtime.request(JSON.stringify({type:'atelier.ai.propose',v:1,clientRequestId:randomUUID(),payload:{designProjectId:p.id,expectedVersion:1,revision:1,purpose:'brief',targetIds:[p.fields.product.id],idempotencyKey:randomUUID()}}));expect(reply.ok).toBe(true);
   const params={threadId:'final-thread',turnId:'final-turn'};
   runtime.notification({method:'item/agentMessage/delta',params:{...params,itemId:'comment',delta:'설계를 정리하겠습니다.'}});
   runtime.notification({method:'item/completed',params:{...params,item:{type:'agentMessage',id:'comment',...(mode==='legacy-comment'?{}:{phase:'commentary'}),text:'설계를 정리하겠습니다.'}}});
   runtime.notification({method:'item/agentMessage/delta',params:{...params,itemId:'final',delta:output}});
   if(mode==='completed'){
    runtime.notification({method:'item/completed',params:{...params,item:{type:'agentMessage',id:'final',phase:'final_answer',content:[],text:output}}});
    runtime.notification({method:'item/completed',params:{...params,item:{type:'agentMessage',id:'late-comment',phase:'commentary',text:'완료했습니다.'}}});
   }
   runtime.notification({method:'turn/completed',params:{threadId:'final-thread',turn:{id:'final-turn',status:'completed'}}});
   for(let i=0;i<80&&runtime.busy;i++)await new Promise(resolve=>setTimeout(resolve,5));expect(runtime.busy).toBe(false);
  }
  const proposals=await t.service.store.proposals(p.id);expect(proposals).toHaveLength(3);expect(proposals.every(r=>r.state==='ready'&&r.candidates[0].patch.value==='올바른 최종 후보')).toBe(true);expect((await t.service.store.get(p.id)).version).toBe(1);
 }finally{await t.close();}
});
