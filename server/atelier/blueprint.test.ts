import {it,expect} from 'vitest';
import {mkdir,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AtelierHandlers} from './handlers.js';
import {domain} from './validation.js';
import {parseBlueprint,contrast} from './blueprint.js';
import type {DesignBlueprint} from '../../shared/atelier/blueprint.js';
import {AtelierProposalRuntime} from './proposal-runtime.js';
import type {AtelierClient} from './client.js';
import type {CodexAppServer,JsonObject} from '../codex-app-server.js';
import type {ModelInfo} from '../../shared/protocol.js';
const source={kind:'codex-app-server' as const,model:'synthetic',threadId:'thread-blueprint',turnId:'turn-blueprint'};
const idea='온도와 통신 상태를 확인하는 모니터. 상태 변화와 경고를 먼저 보여 주세요.';
async function setup(){const parent=path.resolve('.cache');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'blueprint-test-'));const service=await AtelierHandlers.open(root);return {root,service,async close(){await service.store.close();expect(path.dirname(await realpath(root))).toBe(await realpath(parent));await rm(root,{recursive:true,force:true});}};}
async function fixture(){return JSON.parse(await readFile('tools/fixtures/design-blueprint.json','utf8')) as DesignBlueprint;}
async function ready(t:Awaited<ReturnType<typeof setup>>,extra:Partial<DesignBlueprint>={}){const p=domain.newProject({name:'품질 테스트',idea});await t.service.store.insert(p);const b={designProjectId:p.id,expectedVersion:p.version,revision:p.revision,purpose:'blueprint',targetIds:[],idempotencyKey:randomUUID()};const q=(await t.service.proposals.prepare(b)).proposal;await t.service.proposals.running(p.id,q.id,source);const plan={...await fixture(),...extra};const r=await t.service.proposals.complete(p.id,q.id,JSON.stringify({candidates:[{targetId:p.id,patch:plan,rationale:'사용 목적에 맞춘 전체 설계',assumptions:'명시한 가정을 검토'}]}));return {p,b,plan,r};}
it('whole design remains a proposal until explicit review; server IDs create a ready project without manual entity forms',async()=>{
 const t=await setup();try{const {p,r}=await ready(t);expect(r.state).toBe('ready');expect((await t.service.store.get(p.id)).screens).toEqual([]);
  const request={designProjectId:p.id,expectedVersion:1,proposalId:r.id,proposalVersion:r.version,candidateIds:[r.candidates[0].id],confirm:true};
  await expect(t.service.proposals.apply(request,p=>t.service.files.validate(p))).rejects.toMatchObject({code:'INVALID_SELECTION'});
  const next=await t.service.proposals.apply({...request,reviewed:true},p=>t.service.files.validate(p));expect(domain.ready(next)).toBe(true);expect(next.screens).toHaveLength(2);expect(next.flows).toHaveLength(1);expect(next.features).toHaveLength(1);expect(next.styles.length).toBeGreaterThan(3);expect(next.screens.every(s=>/^d_/.test(s.id))).toBe(true);expect(next.flows[0].steps).toEqual(next.screens.map(s=>s.id));expect(next.flows[0].graph?.reviewedVersion).toBe(next.flows[0].graph?.version);expect(next.idea).toBe(idea);
  const snapshot=domain.makeSnapshot(next);expect(snapshot.text).toContain('첫 화면에 반드시 보일 내용');expect(snapshot.text).toContain('큰 홍보용 제목');expect(snapshot.criteria.filter(c=>c.id.startsWith('design-quality-'))).toHaveLength(4);expect(snapshot.criteria.filter(c=>c.id.startsWith('design-quality-')).every(c=>c.decisionIds?.length)).toBe(true);
  const result={id:domain.uid('result'),snapshotId:snapshot.id,fileId:null,source:'검증용',environment:'테스트',screen:'상태 요약',execution:'검증용 실행 기록'};next.results.push(result);const review=domain.beginReview(next,result);expect(review.items.find(i=>i.id==='design-quality-0')?.verdict).toBe('unverifiable');
  const stored=await t.service.store.proposal(p.id,r.id);await expect(t.service.proposals.apply({...request,reviewed:true,expectedVersion:next.version,proposalVersion:stored.version},async()=>{})).rejects.toMatchObject({code:'STALE_INPUT'});
 }finally{await t.close();}
});
it('important questions block application and saved answers must be reflected through a fresh proposal',async()=>{
 const t=await setup();try{const {p,r,b}=await ready(t,{questions:[{key:'primary_device',question:'어떤 기기에서 주로 확인하나요?',why:'첫 화면 배치가 달라집니다.',blocking:true,options:['데스크톱','모바일']}]});expect(r.state).toBe('ready');const c=r.candidates[0];
  const apply={designProjectId:p.id,expectedVersion:1,proposalId:r.id,proposalVersion:r.version,candidateIds:[c.id],confirm:true,reviewed:true};await expect(t.service.proposals.apply(apply,async()=>{})).rejects.toMatchObject({code:'INVALID_SELECTION'});
  await expect(t.service.proposals.answer({designProjectId:p.id,proposalId:r.id,proposalVersion:r.version,candidateId:c.id,answers:[{key:'sandbox',value:'full access'}]})).rejects.toThrow();
  const answered=await t.service.proposals.answer({designProjectId:p.id,proposalId:r.id,proposalVersion:r.version,candidateId:c.id,answers:[{key:'primary_device',value:'모바일'}]});expect((await t.service.store.get(p.id)).revision).toBe(1);await expect(t.service.proposals.apply({...apply,proposalVersion:answered.version},async()=>{})).rejects.toMatchObject({code:'INVALID_SELECTION'});
  const refined=await t.service.proposals.prepare({...b,idempotencyKey:randomUUID(),refine:{proposalId:r.id,proposalVersion:answered.version,candidateId:c.id}});expect(JSON.parse(refined.input!).clarifications).toEqual([{question:'어떤 기기에서 주로 확인하나요?',answer:'모바일'}]);expect(refined.proposal.clarifications).toEqual(JSON.parse(refined.input!).clarifications);
  const secondPlan={...await fixture(),questions:[{key:'detail_level',question:'어떤 정보를 더 크게 볼까요?',why:'정보 밀도를 정합니다.',blocking:true,options:['경고','전체 값']}]};await t.service.proposals.running(p.id,refined.proposal.id,source);const second=await t.service.proposals.complete(p.id,refined.proposal.id,JSON.stringify({candidates:[{targetId:p.id,patch:secondPlan,rationale:'답변 반영',assumptions:''}]}));expect(second.state).toBe('ready');const secondAnswered=await t.service.proposals.answer({designProjectId:p.id,proposalId:second.id,proposalVersion:second.version,candidateId:second.candidates[0].id,answers:[{key:'detail_level',value:'경고'}]});const third=await t.service.proposals.prepare({...b,idempotencyKey:randomUUID(),refine:{proposalId:second.id,proposalVersion:secondAnswered.version,candidateId:second.candidates[0].id}});expect(JSON.parse(third.input!).clarifications).toEqual([{question:'어떤 기기에서 주로 확인하나요?',answer:'모바일'},{question:'어떤 정보를 더 크게 볼까요?',answer:'경고'}]);
 }finally{await t.close();}
});
it('rejects authority fields, broken graphs, fabricated input quotes and poor text contrast without mutating the design',async()=>{
 const t=await setup();try{const p=domain.newProject({name:'검증',idea});await t.service.store.insert(p);const base={designProjectId:p.id,expectedVersion:1,revision:1,purpose:'blueprint',targetIds:[],idempotencyKey:randomUUID()};
  const bad:Array<unknown>=[];const authority={...await fixture(),status:'confirmed'};bad.push(authority);const foreign=await fixture();foreign.flows[0].transitions[0].to='d_foreign';bad.push(foreign);const faded=await fixture();faded.visual.colors.text='#EEEEEE';bad.push(faded);const invented=await fixture();invented.requirements[0].quote='사용자가 제공하지 않은 결제';bad.push(invented);const disconnected=await fixture();disconnected.flows[0].transitions=[];bad.push(disconnected);
  for(const patch of bad){const q=(await t.service.proposals.prepare({...base,idempotencyKey:randomUUID()})).proposal;await t.service.proposals.running(p.id,q.id,source);expect((await t.service.proposals.complete(p.id,q.id,JSON.stringify({candidates:[{targetId:p.id,patch,rationale:'test',assumptions:''}]}))).error?.code).toBe('INVALID_OUTPUT');}
  expect((await t.service.store.get(p.id)).version).toBe(1);expect(contrast('#000000','#FFFFFF')).toBeCloseTo(21);expect(()=>parseBlueprint(faded)).toThrow();
 }finally{await t.close();}
});
it('preserves confirmed answers and rejects stale project or cross-project refinement',async()=>{
 const t=await setup();try{const {p,r,b}=await ready(t);const other=domain.newProject({name:'other',idea});await t.service.store.insert(other);await expect(t.service.proposals.prepare({...b,designProjectId:other.id,idempotencyKey:randomUUID(),refine:{proposalId:r.id,proposalVersion:r.version,candidateId:r.candidates[0].id}})).rejects.toMatchObject({code:'PROJECT_MISMATCH'});
  await t.service.store.mutate(p.id,1,p=>{domain.updateDecision(p,p.fields.product,{value:'이미 확정한 다른 내용',status:'confirmed'});});await expect(t.service.proposals.apply({designProjectId:p.id,expectedVersion:2,proposalId:r.id,proposalVersion:r.version,candidateIds:[r.candidates[0].id],confirm:true,reviewed:true},async()=>{})).rejects.toMatchObject({code:'STALE_INPUT'});
  const latest=await t.service.store.get(p.id),q=(await t.service.proposals.prepare({...b,expectedVersion:latest.version,revision:latest.revision,idempotencyKey:randomUUID()})).proposal;await t.service.proposals.running(p.id,q.id,source);expect((await t.service.proposals.complete(p.id,q.id,JSON.stringify({candidates:[{targetId:p.id,patch:await fixture(),rationale:'test',assumptions:''}]}))).error?.code).toBe('INVALID_OUTPUT');expect((await t.service.store.get(p.id)).fields.product.value).toBe('이미 확정한 다른 내용');
 }finally{await t.close();}
});
it('full design uses readOnly/no network and rejects App Server permission requests before any design mutation',async()=>{
 const t=await setup();try{
  const p=domain.newProject({name:'read-only blueprint',idea});await t.service.store.insert(p);const calls:Array<{method:string;params:JsonObject}>=[];let denied=0;let runtime:AtelierProposalRuntime;
  const storage={proposalCall:async(method:string,b:JsonObject)=>method==='prepare'?t.service.proposals.prepare(b):method==='running'?{proposal:await t.service.proposals.running(String(b.designProjectId),String(b.proposalId),b.source as typeof source)}:{proposal:await t.service.proposals.fail(String(b.designProjectId),String(b.proposalId),'POLICY_DENIED')}} as unknown as AtelierClient;
  const server={request:async(method:string,params:JsonObject)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'bp-thread'}};if(method==='turn/start')return {turn:{id:'bp-turn'}};if(method==='turn/interrupt'){runtime.notification({method:'turn/completed',params:{threadId:'bp-thread',turn:{id:'bp-turn',status:'interrupted'}}});return {};}},respondError:()=>{denied++;},stopAndWait:async()=>{}} as unknown as CodexAppServer;
  const model={model:'fixture',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[]} as unknown as ModelInfo;runtime=new AtelierProposalRuntime(server,storage,{cwd:async()=>t.root,ensure:async()=>{},busy:()=>false,models:()=>[model],emit:()=>{}});
  const raw=(targetIds:string[])=>JSON.stringify({type:'atelier.ai.propose',v:1,clientRequestId:randomUUID(),payload:{designProjectId:p.id,expectedVersion:1,revision:1,purpose:'blueprint',targetIds,idempotencyKey:randomUUID()}});
  expect(await runtime.request(raw(['p_foreign']))).toMatchObject({ok:false});expect(calls).toHaveLength(0);expect(await runtime.request(raw([]))).toMatchObject({ok:true,result:{state:'running'}});
  expect(calls.find(c=>c.method==='turn/start')?.params).toMatchObject({sandboxPolicy:{type:'readOnly',networkAccess:false},approvalPolicy:'never'});expect(calls.find(c=>c.method==='turn/start')?.params.input).toEqual(expect.arrayContaining([expect.objectContaining({text:expect.stringContaining('requirements')})]));
  expect(runtime.serverRequest({id:'real-pending-id',method:'item/permissions/requestApproval',params:{threadId:'bp-thread',permissions:{network:{enabled:true}}}})).toBe(true);
  for(let i=0;i<80&&runtime.busy;i++)await new Promise(resolve=>setTimeout(resolve,5));expect(denied).toBe(1);expect((await t.service.store.proposals(p.id))[0].error?.code).toBe('POLICY_DENIED');expect((await t.service.store.get(p.id)).version).toBe(1);
 }finally{await t.close();}
});
