import {randomUUID} from 'node:crypto';
import type {Decision,Project} from '../../shared/atelier/types.js';
import type {DesignProposal,ProposalPurpose,ProposalFailure} from '../../shared/atelier/proposals.js';
import {AtelierStore} from './store.js';
import {check,AtelierError} from './errors.js';
import {entityPatch,mutateEntity,graphPatch} from './mutations.js';
import {domain,canonical,validateProject} from './validation.js';
import {sha256} from './resources.js';
import * as s from './schema.js';
import {blueprintSchema,parseBlueprint,applyBlueprint,blueprintEligible} from './blueprint.js';

export const proposalFields:Record<ProposalPurpose,string[]>={brief:['value','reason','scope'],flow:['value','reason','goal','role','start','branch','recovery','complete'],concept:['value','reason','summary','experience','hero','bg','text','accent','font','shape','typography','material','layout','motion','intensity','resources','reference','assumptions'],style:['value','reason','role','exception'],blueprint:[]};
export const proposeRule=s.shape({...s.V,revision:s.integer(1),purpose:s.one(Object.keys(proposalFields)),targetIds:s.array(s.id,8),request:s.optional(s.text(4096)),refine:s.optional(s.shape({proposalId:s.id,proposalVersion:s.integer(1),candidateId:s.id})),model:s.optional(s.text(120,1)),effort:s.optional(s.one(['none','minimal','low','medium','high','xhigh','max','ultra'])),idempotencyKey:s.uuid,imageFileIds:s.optional(s.array(s.id,8))});
export const proposalRules:Record<string,s.Rule>={
 'ai.interrupt':s.shape({...s.P,proposalId:s.id}),
 'ai.propose':proposeRule,'proposal.list':s.shape({...s.P,cursor:s.optional(s.text(90)),limit:s.optional(s.integer(1,64))}),'proposal.read':s.shape({...s.P,proposalId:s.id}),
 'proposal.edit':s.shape({...s.P,proposalId:s.id,proposalVersion:s.integer(1),candidateId:s.id,patch:s.json}),
 'proposal.exclude':s.shape({...s.P,proposalId:s.id,proposalVersion:s.integer(1),candidateId:s.id}),
 'proposal.answer':s.shape({...s.P,proposalId:s.id,proposalVersion:s.integer(1),candidateId:s.id,answers:s.array(s.shape({key:s.text(32,1),value:s.text(2048,1)}),4)}),
 'proposal.apply':s.shape({...s.V,proposalId:s.id,proposalVersion:s.integer(1),candidateIds:s.array(s.id,8),confirm:s.optional(s.bool),reviewed:s.optional(s.bool)})
};
function targets(p:Project,purpose:ProposalPurpose):Decision[]{return purpose==='brief'?Object.values(p.fields):purpose==='flow'?p.flows:purpose==='concept'?p.concepts:p.styles;}
function currentDecision({history:_history,...current}:Decision){return current;}
function patchRule(purpose:ProposalPurpose){return s.shape({...Object.fromEntries(proposalFields[purpose].map(key=>[key,s.optional(s.text(4096))])),...(purpose==='flow'?{steps:s.optional(s.array(s.id,64)),graph:s.optional(graphPatch)}:{})});}
function validatePatch(purpose:ProposalPurpose,patch:unknown){if(purpose==='blueprint')return parseBlueprint(patch) as unknown as s.Obj;patchRule(purpose)(patch);const value=s.obj(patch);check(Object.keys(value).length>0&&Object.values(value).some(v=>typeof v==='string'&&v.trim()),'빈 제안은 적용할 수 없습니다.');return value;}
export function proposalOutputSchema(purpose:ProposalPurpose,targetIds:string[],screenIds:string[]=[]){
 if(purpose==='blueprint')return {type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:1,maxItems:1,items:{type:'object',additionalProperties:false,required:['targetId','patch','rationale','assumptions'],properties:{targetId:{type:'string',enum:targetIds},patch:blueprintSchema,rationale:{type:'string',minLength:1,maxLength:768},assumptions:{type:'string',maxLength:768}}}}}};
 const screen={type:'string',enum:screenIds};const text={type:'string',maxLength:1024};
 const graph={type:'object',additionalProperties:false,required:['entryId','terminalIds','transitions','branchPolicy','recoveryPolicy','branchReason','recoveryReason'],properties:{entryId:screen,terminalIds:{type:'array',items:screen},transitions:{type:'array',maxItems:64,items:{type:'object',additionalProperties:false,required:['from','to','kind','condition','preserve'],properties:{from:screen,to:screen,kind:{type:'string',enum:['next','branch','recovery','loop']},condition:text,preserve:text}}},branchPolicy:{type:'string',enum:['pending','mapped','none']},recoveryPolicy:{type:'string',enum:['pending','mapped','none']},branchReason:text,recoveryReason:text}};
 const properties={...Object.fromEntries(proposalFields[purpose].map(k=>[k,text])),...(purpose==='flow'?{steps:{type:'array',items:screen,maxItems:64},graph}:{})};
 return {type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:1,maxItems:targetIds.length,items:{type:'object',additionalProperties:false,required:['targetId','patch','rationale','assumptions'],properties:{targetId:{type:'string',enum:targetIds},patch:{type:'object',additionalProperties:false,required:Object.keys(properties),properties},rationale:{...text,minLength:1},assumptions:text}}}}};
}
function checkFlow(p:Project,targetId:string,patch:unknown){const copy=structuredClone(p);mutateEntity(copy,{kind:'flows',action:'patch',entityId:targetId,value:entityPatch('flows',structuredClone(patch))});validateProject(copy);}

export class AtelierProposals {
 constructor(private store:AtelierStore){}
 async prepare(b:s.Obj){
  proposeRule(b);const p=await this.store.get(String(b.designProjectId));
  const old=(await this.store.proposals(p.id)).find(r=>r.idempotencyKey===b.idempotencyKey);if(old)return {proposal:old,reused:true};
  check(p.version===b.expectedVersion,'최신 저장본을 확인하세요.','VERSION_CONFLICT');check(p.revision===b.revision,'제안 요청 revision이 지났습니다.','STALE_INPUT');
  const purpose=b.purpose as ProposalPurpose;let ids=b.targetIds as string[];
  check(purpose==='blueprint'?ids.length===0:ids.length>0&&new Set(ids).size===ids.length,'대상을 1~8개 선택하세요.');
  if(purpose==='blueprint'){check(blueprintEligible(p),'이미 설계 항목이 있습니다. 전체 초안은 새 프로젝트에서 시작하세요.','INVALID_SELECTION');ids=[p.id];}
  const nodes=targets(p,purpose),selected=purpose==='blueprint'?[]:ids.map(id=>{const d=nodes.find(n=>n.id===id);check(d,'이 목적의 프로젝트 대상이 아닙니다.','PROJECT_MISMATCH');return d;});
  let clarifications:Array<{question:string;answer:string}>=[];
  if(b.refine){check(purpose==='blueprint');const ref=s.obj(b.refine),old=await this.store.proposal(p.id,String(ref.proposalId));check(old.purpose==='blueprint'&&old.version===ref.proposalVersion&&old.state==='ready'&&this.current(p,old),'다듬을 초안이 변경됐습니다.','STALE_INPUT');const candidate=old.candidates.find(c=>c.id===ref.candidateId);check(candidate&&['proposed','edited'].includes(candidate.state));const plan=parseBlueprint(candidate.patch);check(plan.questions.filter(q=>q.blocking).every(q=>candidate.answers?.[q.key]?.trim()),'필수 질문에 답해 주세요.');const answers=plan.questions.filter(q=>candidate.answers?.[q.key]).map(q=>({question:q.question,answer:candidate.answers![q.key]}));check(answers.length>0,'저장한 답변이 없습니다.');clarifications=[...new Map([...(old.clarifications||[]),...answers].map(a=>[a.question,a])).values()];}
  if(b.imageFileIds)for(const id of b.imageFileIds as string[])await this.store.file(p.id,id);
  const input={name:p.name,type:p.type,idea:p.idea,request:b.request||'저장한 아이디어와 답변을 바탕으로 선택한 항목을 구체적으로 정리해 주세요.',clarifications,projectTargetId:p.id,fields:Object.fromEntries(Object.entries(p.fields).map(([key,d])=>[key,currentDecision(d)])),targets:selected.map(currentDecision),references:p.references.map(({name,url,note,role})=>({name,url,note,role})),context:Object.fromEntries((['features','contents','flows','screens','concepts','styles','assets'] as const).map(kind=>[kind,p[kind].map(currentDecision)]))};
  const serialized=canonical(input);check(Buffer.byteLength(serialized)<=96*1024,'선택한 설계 정보가 너무 큽니다. 대상을 줄이세요.','LIMIT_EXCEEDED');
  check((await this.store.proposals(p.id)).length<256,'프로젝트 제안 기록 한도입니다.','LIMIT_EXCEEDED');
  const now=new Date().toISOString();const proposal:DesignProposal={id:'proposal_'+randomUUID(),projectId:p.id,version:1,purpose,state:'preparing',baseRevision:p.revision,applicableRevision:p.revision,targetIds:ids,targetVersions:purpose==='blueprint'?{[p.id]:p.revision}:Object.fromEntries(selected.map(d=>[d.id,d.version])),before:purpose==='blueprint'?{[p.id]:{idea:p.idea,name:p.name}}:Object.fromEntries(selected.map(d=>[d.id,structuredClone(d) as unknown as s.Obj])),inputHash:sha256(serialized),idempotencyKey:String(b.idempotencyKey),createdAt:now,updatedAt:now,source:{kind:'codex-app-server',model:String(b.model||''),...(b.effort?{effort:String(b.effort)}:{})},candidates:[],...(clarifications.length?{clarifications}:{})};
  if((b.imageFileIds as unknown[]|undefined)?.length){proposal.state='failed';proposal.error={code:'IMAGE_UNSUPPORTED',message:'현재 제안 경로는 설계 텍스트만 전달합니다. 이미지를 분석했다고 간주하지 않습니다.'};}
  if(purpose==='flow')check(p.screens.length>0,'흐름 후보에 연결할 화면을 먼저 추가하세요.','INVALID_SELECTION');
  await this.store.saveProposal(proposal);return {proposal,input:serialized,screenIds:p.screens.map(d=>d.id),reused:false};
 }
 async running(pid:string,id:string,source:DesignProposal['source']){const r=await this.store.proposal(pid,id);check(r.state==='preparing'||r.state==='running');r.state='running';r.source=source;return this.save(r);}
 private save(r:DesignProposal){r.version++;r.updatedAt=new Date().toISOString();return this.store.saveProposal(r);}
 async fail(pid:string,id:string,code:ProposalFailure){const r=await this.store.proposal(pid,id);if(!['preparing','running'].includes(r.state))return r;r.state=code==='INTERRUPTED'?'interrupted':'failed';r.error={code,message:{MODEL_FAILED:'AI 응답을 끝까지 받지 못했어요. 연결과 선택한 모델을 확인한 뒤 다시 요청해 주세요.',INVALID_OUTPUT:'AI 답변을 적용 가능한 설계 후보로 정리하지 못했어요. 기존 설계는 변경되지 않았어요. 대상을 하나만 선택해 다시 요청해 주세요.',STALE_INPUT:'요청 이후 설계가 변경되었습니다.',IMAGE_UNSUPPORTED:'이미지 입력 미지원입니다.',RUNTIME_UNAVAILABLE:'Codex 실행 계층에 연결하지 못했습니다.',POLICY_DENIED:'제안의 읽기 전용 정책과 충돌하는 도구·권한 요청을 거부했습니다.',INTERRUPTED:'제안 실행을 중단했습니다. 자동 재실행하지 않습니다.'}[code]};if(r.purpose==='blueprint'&&code==='INVALID_OUTPUT')r.error.message='AI 전체 설계가 원문·화면 연결·색 대비·항목 형식 검증을 통과하지 못했어요. 기존 아이디어와 설계는 유지했어요. 내용을 확인한 뒤 전체 설계를 다시 요청해 주세요.';return this.save(r);}
 async complete(pid:string,id:string,text:string){
  const r=await this.store.proposal(pid,id);if(r.state!=='running')return r;
  const p=await this.store.get(pid);if(!this.current(p,r)){r.state='stale';r.error={code:'STALE_INPUT',message:'요청 이후 revision 또는 대상이 변경되어 적용할 수 없습니다.'};return this.save(r);}
  try{
   check(Buffer.byteLength(text)<=96*1024);
   // Accept a single inert JSON code block, never extract or repair embedded prose/commands.
   const trimmed=text.trim(),fenced=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
   const value:unknown=JSON.parse(fenced?fenced[1]:trimmed);
   s.shape({candidates:s.array(s.shape({targetId:s.one(r.targetIds),patch:r.purpose==='blueprint'?v=>{parseBlueprint(v);}:patchRule(r.purpose),rationale:s.text(4096,1),assumptions:s.text(4096)}),r.purpose==='blueprint'?1:8)})(value);
   const rows=s.obj(value).candidates as s.Obj[];check(rows.length>0&&new Set(rows.map(c=>c.targetId)).size===rows.length);
   if(r.purpose==='flow')for(const c of rows)checkFlow(p,String(c.targetId),c.patch);
   if(r.purpose==='blueprint'){const copy=structuredClone(p);applyBlueprint(copy,parseBlueprint(rows[0].patch),false,'AI 전체 초안 검증');for(const f of copy.flows)check(domain.graphIssues(copy,{...f,graph:{...f.graph!,reviewedVersion:f.graph!.version}}).length===0,'전체 초안의 화면 연결이 불완전합니다.');}
   r.candidates=rows.map(c=>({id:'candidate_'+randomUUID(),targetId:String(c.targetId),patch:validatePatch(r.purpose,c.patch),originalPatch:structuredClone(s.obj(c.patch)),rationale:String(c.rationale),assumptions:String(c.assumptions),state:'proposed'}));r.state='ready';check(Buffer.byteLength(canonical(r))<=200*1024);return this.save(r);
  }catch{return this.fail(pid,id,'INVALID_OUTPUT');}
 }
 current(p:Project,r:DesignProposal){if(r.purpose==='blueprint')return p.revision===r.applicableRevision;return p.revision===r.applicableRevision&&r.targetIds.every(id=>{const d=targets(p,r.purpose).find(d=>d.id===id);return !!d&&(r.candidates.some(c=>c.targetId===id&&c.state==='applied')||d.version===r.targetVersions[id]);});}
 async answer(b:s.Obj){const r=await this.store.proposal(String(b.designProjectId),String(b.proposalId));check(r.purpose==='blueprint'&&r.state==='ready'&&r.version===b.proposalVersion,'답변할 초안이 변경됐습니다.','VERSION_CONFLICT');const c=r.candidates.find(c=>c.id===b.candidateId);check(c&&['proposed','edited'].includes(c.state));const plan=parseBlueprint(c.patch),answers=b.answers as Array<{key:string;value:string}>;check(new Set(answers.map(a=>a.key)).size===answers.length&&answers.every(a=>plan.questions.some(q=>q.key===a.key)),'초안의 질문에만 답할 수 있습니다.');c.answers=Object.fromEntries(answers.map(a=>[a.key,a.value]));c.state='edited';return this.save(r);}
 async edit(b:s.Obj,exclude=false){const r=await this.store.proposal(String(b.designProjectId),String(b.proposalId));check(r.version===b.proposalVersion,'제안이 다른 창에서 변경되었습니다.','VERSION_CONFLICT');check(r.state==='ready');const c=r.candidates.find(c=>c.id===b.candidateId);check(c&&['proposed','edited'].includes(c.state));if(exclude)c.state='excluded';else{c.patch=validatePatch(r.purpose,b.patch);if(r.purpose==='flow')checkFlow(await this.store.get(r.projectId),c.targetId,c.patch);c.state='edited';}return this.save(r);}
 async apply(b:s.Obj,validate:(p:Project)=>Promise<void>){
  const r=await this.store.proposal(String(b.designProjectId),String(b.proposalId));check(r.version===b.proposalVersion,'제안이 변경되었습니다.','VERSION_CONFLICT');check(r.state==='ready','적용 가능한 제안이 아닙니다.','STALE_INPUT');
  const ids=b.candidateIds as string[];check(ids.length&&new Set(ids).size===ids.length);const selected=ids.map(id=>{const c=r.candidates.find(c=>c.id===id);check(c&&['proposed','edited'].includes(c.state),'적용하거나 제외한 항목입니다.','STALE_INPUT');return c;});
  return this.store.mutate(r.projectId,Number(b.expectedVersion),async p=>{
   check(this.current(p,r),'요청 이후 설계가 바뀌었습니다. 새 제안을 요청하세요.','STALE_INPUT');
   if(r.purpose==='blueprint'){
    check(selected.length===1&&b.reviewed===true,'전체 설계와 가정을 먼저 검토해 주세요.','INVALID_SELECTION');const c=selected[0],plan=parseBlueprint(c.patch);check(!plan.questions.some(q=>q.blocking),'중요 질문에 답하고 초안을 다시 다듬어 주세요.','INVALID_SELECTION');check(!Object.keys(c.answers||{}).length,'저장한 답변을 반영해 초안을 먼저 다듬어 주세요.','INVALID_SELECTION');
    applyBlueprint(p,plan,b.confirm===true,`Codex 전체 설계 ${r.id} / ${r.source.model}`);c.state='applied';await validate(p);r.applicableRevision=p.revision;r.version++;r.updatedAt=new Date().toISOString();return;
   }
   check(b.confirm===undefined&&b.reviewed===undefined,'항목별 제안은 기존 명시적 확정 경로를 사용하세요.');
   for(const c of selected){const d=targets(p,r.purpose).find(d=>d.id===c.targetId)!;if(r.purpose==='flow')mutateEntity(p,{kind:'flows',action:'patch',entityId:d.id,value:structuredClone(c.patch)});domain.updateDecision(p,d,{...(r.purpose==='flow'?{}:c.patch),source:'external',status:'proposed',reason:String(c.patch.reason||c.rationale)+`\n[Codex 제안 ${r.id} / ${r.source.model} / ${r.source.threadId} / ${r.source.turnId}${c.state==='edited'?' / 사용자 편집':''}]`});c.state='applied';}
   await validate(p);r.applicableRevision=p.revision;r.version++;r.updatedAt=new Date().toISOString();
  },r);
 }
}
