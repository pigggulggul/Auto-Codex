import { randomUUID } from 'node:crypto';
import type { Project, Output, Decision } from '../../shared/atelier/types.js';
import { QUESTIONS, TYPES } from '../../shared/atelier/guide.js';
import { AtelierStore } from './store.js';
import { AtelierFiles } from './files.js';
import { AtelierTransfers, TRANSFER_LIMITS } from './transfers.js';
import { AtelierBundles } from './bundle.js';
import { check, safeError, AtelierError } from './errors.js';
import { canonical, domain } from './validation.js';
import { editableKinds, mutateEntity, validatePlanFields } from './mutations.js';
import * as s from './schema.js';
import {AtelierProposals,proposalRules} from './proposals.js';
import {AtelierExecution,executionRules,activeGeneration} from './execution.js';

const page = {cursor:s.optional(s.text(90)),limit:s.optional(s.integer(1,64))};
const kinds=[...editableKinds,'results','reviews','plans','snapshots'];
export const requestRules:Record<string,s.Rule> = {
  ...proposalRules,
  ...executionRules,
  'artifact.get':s.shape({...s.P,generationId:s.id}),
  'artifact.read':s.shape({...s.P,generationId:s.id,artifactId:s.id,view:s.one(['preview','download'])}),
  'artifact.attach':s.shape({...s.V,generationId:s.id}),
  'capabilities':s.shape({}), 'project.list':s.shape(page),
  'project.create':s.shape({name:s.label(120,1),idea:s.text(),entry:s.one(['idea','image','concept','improve']),type:s.one(TYPES)}),
  'project.load':s.shape(s.P),'project.read':s.shape(s.P),
  'project.update':s.shape({...s.V,patch:s.shape({name:s.optional(s.label(120,1)),idea:s.optional(s.text()),type:s.optional(s.one([...TYPES,'기타'])),output:s.optional(s.output),settings:s.optional(s.shape({density:s.one(['guide','quick'])})),progress:s.optional(s.progress)})}),
  'entity.list':s.shape({...s.P,kind:s.one(kinds),...page}),
  'entity.mutate':s.shape({...s.V,kind:s.one(editableKinds),action:s.one(['add','patch','remove','reorder','confirm','exclude','acknowledgeGraph','selectConcept','applyPalette']),entityId:s.optional(s.text(90,1)),value:s.optional(s.json),order:s.optional(s.ids)}),
  'intent.confirm':s.shape({...s.V,revision:s.integer(1),choice:s.one(['match']),reason:s.text(32768,1)}),
  'snapshot.create':s.shape({...s.V,mode:s.one(['final','baseline','revision']),reason:s.optional(s.text(32768,1)),planId:s.optional(s.id)}),
  'snapshot.read':s.shape({...s.P,snapshotId:s.id}),
  'handoff.mark':s.shape({...s.V,snapshotId:s.id}),
  'file.list':s.shape({...s.P,...page}),'file.read':s.shape({...s.P,fileId:s.id}),
  'backup.export':s.shape({...s.P,format:s.one(['atelier-backup'])}),'backup.import':s.shape({transferId:s.id}),
  'bundle.export':s.shape({...s.P,snapshotId:s.id}),
  'settings.get':s.shape({}),'settings.update':s.shape({expectedVersion:s.integer(1),patch:s.shape({common:s.optional(s.text()),density:s.optional(s.one(['guide','quick'])),lastProject:s.optional(s.nullable(s.id))})}),
  'transfer.begin':s.shape({direction:s.one(['upload']),purpose:s.one(['file','backup-import']),designProjectId:s.optional(s.id),fileRole:s.optional(s.one(['image','reference','crop','result','asset','content'])),name:s.label(180,1),totalBytes:s.integer(1),sha256:s.hash}),
  'transfer.chunk':s.shape({transferId:s.id,index:s.integer(),dataBase64:s.text(4*Math.ceil(TRANSFER_LIMITS.chunkBytes/3))}),
  'transfer.finish':s.shape({transferId:s.id}),'transfer.read':s.shape({transferId:s.id,index:s.integer()}),'transfer.abort':s.shape({transferId:s.id}),
  'result.register':s.shape({...s.V,snapshotId:s.id,fileIds:s.optional(s.array(s.id,1)),execution:s.optional(s.text()),source:s.text(32768,1),environment:s.text(32768,1),screen:s.text(32768,1),note:s.optional(s.text()),keep:s.optional(s.text())}),
  'result.update':s.shape({...s.V,resultId:s.id,patch:s.shape(Object.fromEntries(['source','environment','screen','execution','note','keep','instruction','behaviorEvidence'].map(k=>[k,s.optional(s.text())])))}),
  'review.start':s.shape({...s.V,resultId:s.id,scope:s.one(['visual','behavior'])}),
  'review.update':s.shape({...s.V,reviewId:s.id,patch:s.shape({scope:s.optional(s.one(['visual','behavior'])),intent:s.optional(s.one(['match','different','unknown'])),intentReason:s.optional(s.text()),holdReason:s.optional(s.text()),learning:s.optional(s.text()),externalFeedback:s.optional(s.text()),feedbackSource:s.optional(s.text()),items:s.optional(s.array(s.shape({id:s.text(90,1),verdict:s.optional(s.one(['match','partial','mismatch','unverifiable','na'])),observation:s.optional(s.text()),evidence:s.optional(s.text()),target:s.optional(s.text()),keep:s.optional(s.text()),cause:s.optional(s.text()),resolution:s.optional(s.one(['resolved','remaining','new-problem','unverifiable'])),selected:s.optional(s.bool)})))})}),
  'review.finish':s.shape({...s.V,reviewId:s.id}),
  'review.hold':s.shape({...s.V,reviewId:s.id,reason:s.text(32768,1)}),
  'plan.create':s.shape({...s.V,reviewId:s.id,fields:s.json}),'plan.update':s.shape({...s.V,planId:s.id,fields:s.json}),'plan.confirm':s.shape({...s.V,planId:s.id}),
  'project.delete':s.shape({...s.V,confirmation:s.shape({projectId:s.id})})
};
export type Reply = {type:'atelier.response';v:1;clientRequestId:string;ok:true;result:Record<string,unknown>;projectVersion?:number} | {type:'atelier.response';v:1;clientRequestId:string;ok:false;error:ReturnType<typeof safeError>};
export type WorkerResult = {reply:Reply;changed?:{id:string;version:number;revision:number}};
function summary(p: Project) { return {id:p.id,name:p.name,idea:p.idea,entry:p.entry,type:p.type,version:p.version,revision:p.revision,createdAt:p.createdAt,updatedAt:p.updatedAt,progress:p.progress,settings:p.settings,output:p.output,intent:p.intent,counts:Object.fromEntries(kinds.filter(k=>k!=='regions'&&k!=='fields').map(k=>[k,(p[k as keyof Project] as unknown[]).length]))}; }

export class AtelierHandlers {
  readonly execution:AtelierExecution;
  readonly proposals:AtelierProposals;
  readonly files:AtelierFiles; readonly transfers:AtelierTransfers; readonly bundles:AtelierBundles;
  private cursors=new Map<string,{owner:string;key:string;offset:number;expires:number}>();
  constructor(public readonly store:AtelierStore) { this.proposals=new AtelierProposals(store);this.files=new AtelierFiles(store);this.execution=new AtelierExecution(store,this.files);this.transfers=new AtelierTransfers(this.files);this.bundles=new AtelierBundles(store,this.files,this.transfers); }
  static async open(root:string) { return new AtelierHandlers(await AtelierStore.open(root)); }
  async disconnect(owner:string) { await this.transfers.disconnect(owner); for(const [id,c]of this.cursors)if(c.owner===owner)this.cursors.delete(id); }
  private async paginate(owner:string,key:string,values:unknown[],payload:s.Obj) {
    const now=Date.now();for(const [id,c]of this.cursors)if(c.expires<now)this.cursors.delete(id);
    let offset=0;
    if(payload.cursor){const c=this.cursors.get(String(payload.cursor));check(c&&c.owner===owner&&c.key===key,'목록이 변경되었거나 cursor가 만료되었습니다.','STALE_INPUT');offset=c.offset;this.cursors.delete(String(payload.cursor));}
    const items:unknown[]=[];let size=0;
    for(const value of values.slice(offset,offset+Number(payload.limit||32))) {const bytes=Buffer.byteLength(JSON.stringify(value));if(size+bytes>200*1024)break;items.push(value);size+=bytes;}
    check(items.length || offset>=values.length,'항목이 제어 메시지보다 큽니다. project.read로 전체 JSON을 내려받으세요.','LIMIT_EXCEEDED');
    let nextCursor:string|null=null;
    if(offset+items.length<values.length){check(this.cursors.size<512,'목록 cursor 한도입니다.','LIMIT_EXCEEDED');nextCursor='cur_'+randomUUID();this.cursors.set(nextCursor,{owner,key,offset:offset+items.length,expires:now+60000});}
    return {kind:'page',items,nextCursor};
  }
  async handle(owner:string,raw:string):Promise<WorkerResult> {
    let clientRequestId='';
    try {
      check(Buffer.byteLength(raw)<=1024*1024,'설계 프레임이 1MiB를 초과합니다.','LIMIT_EXCEEDED');
      let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new AtelierError('INVALID_MESSAGE','JSON 메시지가 아닙니다.');}
      const request=s.obj(parsed);if(typeof request.clientRequestId==='string'&&request.clientRequestId.length<=64)clientRequestId=request.clientRequestId;
      check(request.v===1,'지원하지 않는 설계 프로토콜입니다.','UNSUPPORTED_VERSION');
      s.shape({type:s.text(90,1),v:s.one([1]),clientRequestId:s.uuid,payload:s.json})(request);
      const type=String(request.type).replace(/^atelier\./,'');check(request.type==='atelier.'+type);
      check(Object.hasOwn(requestRules,type),'아직 지원하지 않는 설계 기능입니다.','CAPABILITY_UNAVAILABLE');const rule=requestRules[type];
      check(type==='transfer.chunk'||Buffer.byteLength(raw)<=256*1024,'제어 메시지가 256KiB를 초과합니다.','LIMIT_EXCEEDED');rule(request.payload);
      const payload=s.obj(request.payload),result=await this.execute(owner,type,payload);
      const {changed,...data}=result;
      const reply:Reply={type:'atelier.response',v:1,clientRequestId,ok:true,result:data,...(changed?{projectVersion:changed.version}:{})};
      check(type==='transfer.read'||Buffer.byteLength(JSON.stringify(reply))<=256*1024,'응답이 제어 메시지 한도를 초과합니다. project.read로 내려받으세요.','LIMIT_EXCEEDED');
      return {reply,...(changed?{changed}:{})};
    } catch(error) { return {reply:{type:'atelier.response',v:1,clientRequestId,ok:false,error:safeError(error)}}; }
  }
  private async execute(owner:string,type:string,b:s.Obj):Promise<Record<string,unknown>&{changed?:{id:string;version:number;revision:number}}> {
    const pid=String(b.designProjectId||''),version=Number(b.expectedVersion);
    const changed=(p:Project)=>({kind:'mutation',project:{id:p.id,version:p.version,revision:p.revision},changed:{id:p.id,version:p.version,revision:p.revision}});
    const mutate=async(fn:(p:Project)=>void|Promise<void>)=>changed(await this.store.mutate(pid,version,async p=>{await fn(p);await this.files.validate(p);}));
    switch(type){
      case 'artifact.get':{const g=await this.store.generation(pid,String(b.generationId));return {kind:'artifactManifest',executionState:g.state,manifest:await this.store.manifest(pid,String(b.generationId))};}
      case 'artifact.read':{const r=await this.execution.artifacts.read(pid,String(b.generationId),String(b.artifactId),b.view==='preview');return {kind:'download',file:r.file,mime:r.mime,truncated:r.truncated,download:await this.transfers.download(owner,pid,r.file.id+(r.file.kind==='image'?'.'+r.mime.split('/')[1]:r.file.kind==='binary'?'.bin':'.txt'),h=>h.writeFile(r.bytes),r.bytes.length)};}
      case 'artifact.attach':{const result=await this.execution.artifacts.attach(pid,String(b.generationId),version);return {kind:'artifactAttached',...result,...(result.project?{changed:result.project}:{})};}
      case 'binding.set':case 'generation.start':case 'generation.interrupt':throw new AtelierError('CAPABILITY_UNAVAILABLE','제작 연결은 bridge 실행 경계에서만 호출합니다.');
      case 'binding.get':return {kind:'binding',binding:await this.store.binding(pid)};
      case 'generation.get':return {kind:'generation',generation:await this.store.generation(pid,String(b.generationId))};
      case 'generation.list':{const rows=(await this.store.generations(pid)).map(({input,...g})=>({...g,inputHash:input.snapshotHash}));return this.paginate(owner,pid+':generations:'+canonical(rows.map(r=>[r.id,r.version])),rows,b);}
      case 'ai.propose':throw new AtelierError('CAPABILITY_UNAVAILABLE','제안 실행기는 bridge에서만 호출합니다.');
      case 'proposal.list':{const rows=(await this.store.proposals(pid)).map(({before,candidates,...r})=>({...r,candidateCount:candidates.length}));return this.paginate(owner,pid+':proposals:'+canonical(rows.map(r=>[r.id,r.version])),rows,b);}
      case 'proposal.read':return {kind:'proposal',proposal:await this.store.proposal(pid,String(b.proposalId))};
      case 'proposal.edit':return {kind:'proposal',proposal:await this.proposals.edit(b)};
      case 'proposal.answer':return {kind:'proposal',proposal:await this.proposals.answer(b)};
      case 'proposal.exclude':return {kind:'proposal',proposal:await this.proposals.edit(b,true)};
      case 'proposal.apply':return changed(await this.proposals.apply(b,p=>this.files.validate(p)));
      case 'capabilities':return {kind:'capabilities',contractVersion:1,operations:Object.keys(requestRules).map(k=>'atelier.'+k),limits:TRANSFER_LIMITS,ai:false,execution:false,storage:'SQLite + project files'};
      case 'project.list':{const list=await this.store.list();return this.paginate(owner,'projects:'+canonical(list.map(p=>[p.id,p.version])),list,b);}
      case 'project.create':{const p=domain.newProject(b as unknown as Parameters<typeof domain.newProject>[0]);await this.store.insert(p);return {...changed(p),project:summary(p)};}
      case 'project.load':return {kind:'project',project:summary(await this.store.get(pid))};
      case 'project.read':return {kind:'download',...await this.bundles.projectRead(owner,pid)};
      case 'project.update':return mutate(p=>{
        const patch=s.obj(b.patch),out=patch.output?s.obj(patch.output):null;
        if(typeof patch.name==='string')p.name=patch.name;if(typeof patch.idea==='string')p.idea=patch.idea;
        if(patch.type!==undefined)p.type=patch.type as Project['type'];
        if(out){const commonVersion=p.output.commonVersion+(out.common!==undefined&&out.common!==p.output.common?1:0);if(out.commonVersion!==undefined)check(out.commonVersion===commonVersion,'공통 기준 버전이 현재 편집과 다릅니다.','VERSION_CONFLICT');Object.assign(p.output,out,{commonVersion,version:p.output.version+1});}
        if(patch.settings)Object.assign(p.settings,patch.settings);if(patch.progress)Object.assign(p.progress,patch.progress);
        if(patch.name!==undefined||patch.idea!==undefined||patch.type!==undefined||out)domain.touch(p,'프로젝트 설계 정보 변경');
      });
      case 'entity.list':{
        const p=await this.store.get(pid),kind=String(b.kind);const items=kind==='fields'?QUESTIONS.map(q=>({key:q.key,...p.fields[q.key]})):kind==='regions'?p.references.flatMap(r=>r.regions.map(a=>({referenceId:r.id,...a}))):kind==='snapshots'?p.snapshots.map(s=>({id:s.id,number:s.number,revision:s.revision,createdAt:s.createdAt,draft:s.draft,planId:s.planId,selection:s.selection})):p[kind as keyof Project] as unknown[];
        return this.paginate(owner,`${pid}:${p.version}:${kind}`,items,b);
      }
      case 'entity.mutate':return mutate(p=>mutateEntity(p,b));
      case 'intent.confirm':return mutate(p=>{check(p.revision===b.revision,'현재 설계 revision을 다시 확인하세요.','STALE_INPUT');p.intent={choice:'match',reason:String(b.reason),revision:p.revision};});
      case 'snapshot.create':return mutate(p=>{
        if(b.mode==='baseline'){check(b.reason&&!b.planId,'진단 기준 사유가 필요합니다.');domain.baseline(p,String(b.reason));}
        else if(b.mode==='revision'){check(b.planId&&!b.reason,'수정 계획 ID가 필요합니다.');const plan=p.plans.find(plan=>plan.id===b.planId);check(plan,'수정 계획이 없습니다.','NOT_FOUND');check(plan.confirmed,'수정 계획을 확정하세요.');check(domain.selectionIssues({...p,output:{...p.output,selection:plan.selection||p.output.selection}}).length===0,'수정 계획의 출력 대상을 다시 확인하세요.','INVALID_SELECTION');domain.makeSnapshot(p,{plan});}
        else {check(!b.planId&&!b.reason);check(domain.ready(p),'필수 결정·흐름·의도를 확인하세요.','INVALID_SELECTION');domain.makeSnapshot(p);}
      });
      case 'snapshot.read':return {kind:'download',...await this.bundles.projectRead(owner,pid,String(b.snapshotId))};
      case 'handoff.mark':return mutate(p=>{const snap=p.snapshots.find(s=>s.id===b.snapshotId);check(snap,'수동 전달 기준이 없습니다.','NOT_FOUND');p.handoff={snapshotId:snap.id,waiting:true,revision:!!snap.planId,at:new Date().toISOString()};});
      case 'file.list':{
        const rows=await this.store.files(pid),items=[];for(const file of rows){let exists=true;try{await this.files.read(pid,file.id);}catch{exists=false;}items.push({...file,exists});}return this.paginate(owner,pid+':files:'+canonical(rows),items,b);
      }
      case 'file.read':{const {bytes,record}=await this.files.read(pid,String(b.fileId));return {kind:'download',download:await this.transfers.download(owner,pid,record.name,h=>h.writeFile(bytes),bytes.length),file:record};}
      case 'backup.export':return {kind:'download',download:await this.bundles.backup(owner,pid)};
      case 'backup.import':{const project=await this.bundles.import(owner,String(b.transferId));return {kind:'mutation',project,changed:project};}
      case 'bundle.export':return {kind:'download',download:await this.bundles.bundle(owner,pid,String(b.snapshotId))};
      case 'settings.get':return {kind:'settings',...await this.store.settings()};
      case 'settings.update':{const patch=s.obj(b.patch);if(patch.lastProject)await this.store.get(String(patch.lastProject));return {kind:'settings',...await this.store.updateSettings(version,patch)};}
      case 'transfer.begin':return {kind:'transfer',transfer:await this.transfers.begin(owner,b as unknown as Parameters<AtelierTransfers['begin']>[1])};
      case 'transfer.chunk':return {kind:'transfer',transfer:await this.transfers.chunk(owner,String(b.transferId),Number(b.index),String(b.dataBase64))};
      case 'transfer.finish':return this.transfers.finish(owner,String(b.transferId));
      case 'transfer.read':return {kind:'chunk',...await this.transfers.read(owner,String(b.transferId),Number(b.index))};
      case 'transfer.abort':return {kind:'aborted',...await this.transfers.abort(owner,String(b.transferId))};
      case 'result.register':return mutate(p=>{
        check(p.snapshots.some(snap=>snap.id===b.snapshotId),'기준 스냅샷이 없습니다.','NOT_FOUND');const ids=(b.fileIds||[]) as string[];check(ids.length||String(b.execution||'').trim(),'실제 결과 이미지나 실행 기록이 필요합니다.');
        p.results.push({id:domain.uid('result'),number:p.results.length+1,snapshotId:String(b.snapshotId),fileId:ids[0]||null,source:String(b.source),screen:String(b.screen),environment:String(b.environment),execution:String(b.execution||''),note:String(b.note||''),keep:String(b.keep||'')});
      });
      case 'result.update':return mutate(p=>{const result=p.results.find(r=>r.id===b.resultId);check(result,'결과가 없습니다.','NOT_FOUND');const patch=s.obj(b.patch);if(result.executionSource==='runtime')check(!['source','environment','execution'].some(k=>Object.hasOwn(patch,k)),'자동 실행 근거·출처는 수정할 수 없습니다. 사용자 관찰은 별도 필드에 기록하세요.');Object.assign(result,patch);for(const review of p.reviews.filter(r=>r.resultId===result.id)){review.recheck={decisionIds:[],criterionIds:review.items.map(i=>i.id),reason:'결과 설명·실행 근거 변경. 새 검토 회차에서 다시 확인하세요.',at:new Date().toISOString()};}});
      case 'review.start':return mutate(p=>{const result=p.results.find(r=>r.id===b.resultId);check(result,'결과가 없습니다.','NOT_FOUND');const review=domain.beginReview(p,result);review.scope=b.scope as 'visual'|'behavior';});
      case 'review.update':return mutate(p=>{const review=p.reviews.find(r=>r.id===b.reviewId);check(review,'검토 회차가 없습니다.','NOT_FOUND');const {items,...patch}=s.obj(b.patch);Object.assign(review,patch);if(items)for(const value of items as s.Obj[]){const item=review.items.find(i=>i.id===value.id);check(item,'검토 기준이 없습니다.','NOT_FOUND');Object.assign(item,value);}review.state='reviewing';});
      case 'review.finish':return mutate(p=>{const review=p.reviews.find(r=>r.id===b.reviewId);check(review,'검토 회차가 없습니다.','NOT_FOUND');check(domain.reviewProblems(p,review).length===0,'관찰·근거·판정·실행 기록을 확인하세요.');domain.finishReview(p,review);});
      case 'review.hold':return mutate(p=>{const review=p.reviews.find(r=>r.id===b.reviewId);check(review,'검토 회차가 없습니다.','NOT_FOUND');review.state='held';review.holdReason=String(b.reason);});
      case 'plan.create':return mutate(p=>{const review=p.reviews.find(r=>r.id===b.reviewId);check(review,'검토 회차가 없습니다.','NOT_FOUND');domain.createPlan(p,review,validatePlanFields(b.fields));});
      case 'plan.update':return mutate(p=>{const plan=p.plans.find(plan=>plan.id===b.planId);check(plan,'수정 계획이 없습니다.','NOT_FOUND');check(!p.snapshots.some(s=>s.planId===plan.id),'사용한 계획 대신 새 계획을 만드세요.','IMMUTABLE_SNAPSHOT');Object.assign(plan,validatePlanFields(b.fields),{confirmed:false});});
      case 'plan.confirm':return mutate(p=>{const plan=p.plans.find(plan=>plan.id===b.planId);check(plan,'수정 계획이 없습니다.','NOT_FOUND');validatePlanFields(Object.fromEntries(['problem','cause','target','change','scope','keep','materials','check'].filter(k=>Object.hasOwn(plan,k)).map(k=>[k,(plan as unknown as s.Obj)[k]])));plan.confirmed=true;});
      case 'project.delete':{check(!(await this.store.generations(pid)).some(activeGeneration),'제작 중에는 삭제할 수 없습니다.','BUSY');check(!(await this.store.proposals(pid)).some(r=>r.state==='preparing'||r.state==='running'),'Active proposal. Interrupt it first.','BUSY');check(s.obj(b.confirmation).projectId===pid,'삭제 확인 대상이 다릅니다.','PROJECT_MISMATCH');check(!this.transfers.hasProject(pid),'전송 중인 프로젝트는 삭제할 수 없습니다.','BUSY');await this.store.delete(pid,version);return {kind:'deleted',id:pid};}
      default:throw new AtelierError('CAPABILITY_UNAVAILABLE','지원하지 않는 설계 기능입니다.');
    }
  }
}
