import {randomUUID} from 'node:crypto';
import type {Decision,Project} from '../../shared/atelier/types.js';
import type {DesignProposal,ProposalPurpose,ProposalFailure} from '../../shared/atelier/proposals.js';
import {AtelierStore} from './store.js';
import {check,AtelierError} from './errors.js';
import {entityPatch,mutateEntity,graphPatch} from './mutations.js';
import {domain,canonical,validateProject} from './validation.js';
import {sha256} from './resources.js';
import * as s from './schema.js';

export const proposalFields:Record<ProposalPurpose,string[]>={brief:['value','reason','scope'],flow:['value','reason','goal','role','start','branch','recovery','complete'],concept:['value','reason','summary','experience','hero','bg','text','accent','font','shape','typography','material','layout','motion','intensity','resources','reference','assumptions'],style:['value','reason','role','exception']};
export const proposeRule=s.shape({...s.V,revision:s.integer(1),purpose:s.one(Object.keys(proposalFields)),targetIds:s.array(s.id,8),model:s.optional(s.text(120,1)),effort:s.optional(s.one(['none','minimal','low','medium','high','xhigh','max','ultra'])),idempotencyKey:s.uuid,imageFileIds:s.optional(s.array(s.id,8))});
export const proposalRules:Record<string,s.Rule>={
 'ai.interrupt':s.shape({...s.P,proposalId:s.id}),
 'ai.propose':proposeRule,'proposal.list':s.shape({...s.P,cursor:s.optional(s.text(90)),limit:s.optional(s.integer(1,64))}),'proposal.read':s.shape({...s.P,proposalId:s.id}),
 'proposal.edit':s.shape({...s.P,proposalId:s.id,proposalVersion:s.integer(1),candidateId:s.id,patch:s.json}),
 'proposal.exclude':s.shape({...s.P,proposalId:s.id,proposalVersion:s.integer(1),candidateId:s.id}),
 'proposal.apply':s.shape({...s.V,proposalId:s.id,proposalVersion:s.integer(1),candidateIds:s.array(s.id,8)})
};
function targets(p:Project,purpose:ProposalPurpose):Decision[]{return purpose==='brief'?Object.values(p.fields):purpose==='flow'?p.flows:purpose==='concept'?p.concepts:p.styles;}
function patchRule(purpose:ProposalPurpose){return s.shape({...Object.fromEntries(proposalFields[purpose].map(key=>[key,s.optional(s.text(4096))])),...(purpose==='flow'?{steps:s.optional(s.array(s.id,64)),graph:s.optional(graphPatch)}:{})});}
function validatePatch(purpose:ProposalPurpose,patch:unknown){patchRule(purpose)(patch);const value=s.obj(patch);check(Object.keys(value).length>0&&Object.values(value).some(v=>typeof v==='string'&&v.trim()),'빈 제안은 적용할 수 없습니다.');return value;}
export function proposalOutputSchema(purpose:ProposalPurpose,targetIds:string[],screenIds:string[]=[]){
 const screen={type:'string',enum:screenIds};const text={type:'string'};
 const graph={type:'object',additionalProperties:false,required:['entryId','terminalIds','transitions','branchPolicy','recoveryPolicy','branchReason','recoveryReason'],properties:{entryId:screen,terminalIds:{type:'array',items:screen},transitions:{type:'array',maxItems:64,items:{type:'object',additionalProperties:false,required:['from','to','kind','condition','preserve'],properties:{from:screen,to:screen,kind:{type:'string',enum:['next','branch','recovery','loop']},condition:text,preserve:text}}},branchPolicy:{type:'string',enum:['pending','mapped','none']},recoveryPolicy:{type:'string',enum:['pending','mapped','none']},branchReason:text,recoveryReason:text}};
 const properties={...Object.fromEntries(proposalFields[purpose].map(k=>[k,text])),...(purpose==='flow'?{steps:{type:'array',items:screen,maxItems:64},graph}:{})};
 return {type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['targetId','patch','rationale','assumptions'],properties:{targetId:{type:'string',enum:targetIds},patch:{type:'object',additionalProperties:false,required:Object.keys(properties),properties},rationale:text,assumptions:text}}}}};
}
function checkFlow(p:Project,targetId:string,patch:unknown){const copy=structuredClone(p);mutateEntity(copy,{kind:'flows',action:'patch',entityId:targetId,value:entityPatch('flows',structuredClone(patch))});validateProject(copy);}

export class AtelierProposals {
 constructor(private store:AtelierStore){}
 async prepare(b:s.Obj){
  proposeRule(b);const p=await this.store.get(String(b.designProjectId));
  const old=(await this.store.proposals(p.id)).find(r=>r.idempotencyKey===b.idempotencyKey);if(old)return {proposal:old,reused:true};
  check(p.version===b.expectedVersion,'최신 저장본을 확인하세요.','VERSION_CONFLICT');check(p.revision===b.revision,'제안 요청 revision이 지났습니다.','STALE_INPUT');
  const ids=b.targetIds as string[];check(ids.length>0&&new Set(ids).size===ids.length,'대상을 1~8개 선택하세요.');
  const purpose=b.purpose as ProposalPurpose,nodes=targets(p,purpose);const selected=ids.map(id=>{const d=nodes.find(n=>n.id===id);check(d,'이 목적의 프로젝트 대상이 아닙니다.','PROJECT_MISMATCH');return d;});
  if(b.imageFileIds)for(const id of b.imageFileIds as string[])await this.store.file(p.id,id);
  const input={name:p.name,type:p.type,idea:p.idea,fields:p.fields,targets:selected,context:{screens:p.screens.map(({id,value,role})=>({id,value,role})),concepts:p.concepts.map(({id,value,summary})=>({id,value,summary}))}};
  const serialized=canonical(input);check(Buffer.byteLength(serialized)<=96*1024,'선택한 설계 정보가 너무 큽니다. 대상을 줄이세요.','LIMIT_EXCEEDED');
  check((await this.store.proposals(p.id)).length<256,'프로젝트 제안 기록 한도입니다.','LIMIT_EXCEEDED');
  const now=new Date().toISOString();const proposal:DesignProposal={id:'proposal_'+randomUUID(),projectId:p.id,version:1,purpose,state:'preparing',baseRevision:p.revision,applicableRevision:p.revision,targetIds:ids,targetVersions:Object.fromEntries(selected.map(d=>[d.id,d.version])),before:Object.fromEntries(selected.map(d=>[d.id,structuredClone(d) as unknown as s.Obj])),inputHash:sha256(serialized),idempotencyKey:String(b.idempotencyKey),createdAt:now,updatedAt:now,source:{kind:'codex-app-server',model:String(b.model||''),...(b.effort?{effort:String(b.effort)}:{})},candidates:[]};
  if((b.imageFileIds as unknown[]|undefined)?.length){proposal.state='failed';proposal.error={code:'IMAGE_UNSUPPORTED',message:'현재 제안 경로는 설계 텍스트만 전달합니다. 이미지를 분석했다고 간주하지 않습니다.'};}
  if(purpose==='flow')check(p.screens.length>0,'흐름 후보에 연결할 화면을 먼저 추가하세요.','INVALID_SELECTION');
  await this.store.saveProposal(proposal);return {proposal,input:serialized,screenIds:p.screens.map(d=>d.id),reused:false};
 }
 async running(pid:string,id:string,source:DesignProposal['source']){const r=await this.store.proposal(pid,id);check(r.state==='preparing'||r.state==='running');r.state='running';r.source=source;return this.save(r);}
 private save(r:DesignProposal){r.version++;r.updatedAt=new Date().toISOString();return this.store.saveProposal(r);}
 async fail(pid:string,id:string,code:ProposalFailure){const r=await this.store.proposal(pid,id);if(!['preparing','running'].includes(r.state))return r;r.state=code==='INTERRUPTED'?'interrupted':'failed';r.error={code,message:{MODEL_FAILED:'모델 실행이 실패했습니다.',INVALID_OUTPUT:'응답이 구조화된 제안 계약에 맞지 않습니다.',STALE_INPUT:'요청 이후 설계가 변경되었습니다.',IMAGE_UNSUPPORTED:'이미지 입력 미지원입니다.',RUNTIME_UNAVAILABLE:'Codex 실행 계층에 연결하지 못했습니다.',POLICY_DENIED:'제안의 읽기 전용 정책과 충돌하는 도구·권한 요청을 거부했습니다.',INTERRUPTED:'제안 실행을 중단했습니다. 자동 재실행하지 않습니다.'}[code]};return this.save(r);}
 async complete(pid:string,id:string,text:string){
  const r=await this.store.proposal(pid,id);if(r.state!=='running')return r;
  const p=await this.store.get(pid);if(!this.current(p,r)){r.state='stale';r.error={code:'STALE_INPUT',message:'요청 이후 revision 또는 대상이 변경되어 적용할 수 없습니다.'};return this.save(r);}
  try{
   check(Buffer.byteLength(text)<=96*1024);const value:unknown=JSON.parse(text);
   s.shape({candidates:s.array(s.shape({targetId:s.one(r.targetIds),patch:patchRule(r.purpose),rationale:s.text(4096,1),assumptions:s.text(4096)}),8)})(value);
   const rows=s.obj(value).candidates as s.Obj[];check(rows.length>0&&new Set(rows.map(c=>c.targetId)).size===rows.length);
   if(r.purpose==='flow')for(const c of rows)checkFlow(p,String(c.targetId),c.patch);
   r.candidates=rows.map(c=>({id:'candidate_'+randomUUID(),targetId:String(c.targetId),patch:validatePatch(r.purpose,c.patch),originalPatch:structuredClone(s.obj(c.patch)),rationale:String(c.rationale),assumptions:String(c.assumptions),state:'proposed'}));r.state='ready';check(Buffer.byteLength(canonical(r))<=200*1024);return this.save(r);
  }catch{return this.fail(pid,id,'INVALID_OUTPUT');}
 }
 current(p:Project,r:DesignProposal){return p.revision===r.applicableRevision&&r.targetIds.every(id=>{const d=targets(p,r.purpose).find(d=>d.id===id);return !!d&&(r.candidates.some(c=>c.targetId===id&&c.state==='applied')||d.version===r.targetVersions[id]);});}
 async edit(b:s.Obj,exclude=false){const r=await this.store.proposal(String(b.designProjectId),String(b.proposalId));check(r.version===b.proposalVersion,'제안이 다른 창에서 변경되었습니다.','VERSION_CONFLICT');check(r.state==='ready');const c=r.candidates.find(c=>c.id===b.candidateId);check(c&&['proposed','edited'].includes(c.state));if(exclude)c.state='excluded';else{c.patch=validatePatch(r.purpose,b.patch);if(r.purpose==='flow')checkFlow(await this.store.get(r.projectId),c.targetId,c.patch);c.state='edited';}return this.save(r);}
 async apply(b:s.Obj,validate:(p:Project)=>Promise<void>){
  const r=await this.store.proposal(String(b.designProjectId),String(b.proposalId));check(r.version===b.proposalVersion,'제안이 변경되었습니다.','VERSION_CONFLICT');check(r.state==='ready','적용 가능한 제안이 아닙니다.','STALE_INPUT');
  const ids=b.candidateIds as string[];check(ids.length&&new Set(ids).size===ids.length);const selected=ids.map(id=>{const c=r.candidates.find(c=>c.id===id);check(c&&['proposed','edited'].includes(c.state),'적용하거나 제외한 항목입니다.','STALE_INPUT');return c;});
  return this.store.mutate(r.projectId,Number(b.expectedVersion),async p=>{
   check(this.current(p,r),'요청 이후 설계가 바뀌었습니다. 새 제안을 요청하세요.','STALE_INPUT');
   for(const c of selected){const d=targets(p,r.purpose).find(d=>d.id===c.targetId)!;if(r.purpose==='flow')mutateEntity(p,{kind:'flows',action:'patch',entityId:d.id,value:structuredClone(c.patch)});domain.updateDecision(p,d,{...(r.purpose==='flow'?{}:c.patch),source:'external',status:'proposed',reason:String(c.patch.reason||c.rationale)+`\n[Codex 제안 ${r.id} / ${r.source.model} / ${r.source.threadId} / ${r.source.turnId}${c.state==='edited'?' / 사용자 편집':''}]`});c.state='applied';}
   await validate(p);r.applicableRevision=p.revision;r.version++;r.updatedAt=new Date().toISOString();
  },r);
 }
}
