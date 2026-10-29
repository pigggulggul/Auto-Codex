import {expect,it} from 'vitest';
import {mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AtelierHandlers} from './handlers.js';
import {domain} from './validation.js';
import {QUESTIONS} from '../../shared/atelier/guide.js';
import type {Project} from '../../shared/atelier/types.js';

it('four manual starts and complete decision → snapshot → result → review → revision round trip use real SQLite',async()=>{
 const parent=path.resolve('.cache');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'atelier-manual-'));const service=await AtelierHandlers.open(root);
 const call=async(type:string,payload:Record<string,unknown>)=>{const reply=(await service.handle('manual',JSON.stringify({type:'atelier.'+type,v:1,clientRequestId:randomUUID(),payload}))).reply;if(!reply.ok)throw new Error(type+': '+reply.error.code+' '+reply.error.message);return reply.result;};
 try{
  for(const [entry,tab]of [['idea','design'],['image','reference'],['concept','concept'],['improve','review']]){const r=await call('project.create',{name:'합성 '+entry,idea:'원문',entry,type:'제작 도구'});const p=await service.store.get(String((r.project as Record<string,unknown>).id));expect(p.progress.tab).toBe(tab);expect(domain.allDecisions(p).every(d=>d.status==='unknown')).toBe(true);}
  const p=domain.newProject({name:'수동 통합 왕복',type:'제작 도구'});await service.store.insert(p);
  const update=async(type:string,payload:Record<string,unknown>)=>{const current=await service.store.get(p.id);await call(type,{designProjectId:p.id,expectedVersion:current.version,...payload});return service.store.get(p.id);};
  for(const q of QUESTIONS)await update('entity.mutate',{kind:'fields',action:'patch',entityId:q.key,value:{value:'합성 직접 작성 '+q.key}});
  for(const q of QUESTIONS)await update('entity.mutate',{kind:'fields',action:'confirm',entityId:q.key});
  let current=await update('entity.mutate',{kind:'screens',action:'add',value:{value:'대표 상태',role:'합성 작업',entry:'시작',priority:'내용',actions:'선택',response:'반영',next:'완료',exceptions:'재시도',preserve:'입력'}});const screen=current.screens[0];
  await update('entity.mutate',{kind:'screens',action:'confirm',entityId:screen.id});
  current=await update('entity.mutate',{kind:'flows',action:'add',value:{value:'한 화면 흐름',role:'직접 사용자',goal:'작성',start:'시작',complete:'결과 확인',branch:'없음',recovery:'입력 보존',steps:[screen.id],loop:false,graph:{entryId:screen.id,terminalIds:[screen.id],transitions:[],branchPolicy:'none',branchReason:'한 상태',recoveryPolicy:'none',recoveryReason:'동작 없는 설계 기준'}}});const flow=current.flows[0];await update('entity.mutate',{kind:'flows',action:'acknowledgeGraph',entityId:flow.id});
  for(const [kind,value]of [['features',{value:'핵심 작성',priority:'이번 범위',flowIds:[flow.id]}],['styles',{value:'#333333',role:'본문',scope:'본문',exception:'없음'}],['assets',{value:'실제 자료 확보 계획',availability:'제작 필요'}]] as const){current=await update('entity.mutate',{kind,action:'add',value});const node=current[kind as 'features'|'styles'|'assets'][0];await update('entity.mutate',{kind,action:'confirm',entityId:node.id});}
  current=await service.store.get(p.id);expect(domain.issues(current)).toEqual([]);
  await update('intent.confirm',{revision:current.revision,choice:'match',reason:'합성 수동 기준을 읽고 확인'});current=await update('snapshot.create',{mode:'final'});const snapshot=current.snapshots[0],frozen=JSON.stringify(snapshot);
  await update('handoff.mark',{snapshotId:snapshot.id});current=await update('result.register',{snapshotId:snapshot.id,source:'수동 합성 검증',environment:'격리된 테스트',screen:'대표 상태',execution:'테스트용 직접 조작 기록'});const result=current.results[0];
  current=await update('review.start',{resultId:result.id,scope:'visual'});const review=current.reviews[0];expect(review.items.every(i=>i.verdict==='unverifiable')).toBe(true);
  await update('review.update',{reviewId:review.id,patch:{intent:'match',intentReason:'합성 화면 기준 비교',items:review.items.map(i=>({id:i.id,verdict:'match',observation:'합성 관찰',evidence:'합성 위치',selected:i.id==='style'}))}});
  current=await update('review.finish',{reviewId:review.id});expect(current.reviews[0].state).toBe('completed');
  current=await update('plan.create',{reviewId:review.id,fields:{problem:'범위 차이',change:'장식 조정',keep:'본문',check:'같은 기준 비교'}});const plan=current.plans[0];expect(plan.confirmed).toBe(false);await update('plan.confirm',{planId:plan.id});current=await update('snapshot.create',{mode:'revision',planId:plan.id});const revision=current.snapshots[1];expect(JSON.stringify(current.snapshots[0])).toBe(frozen);
  current=await update('result.register',{snapshotId:revision.id,source:'합성 수정 결과',environment:'격리 테스트',screen:'수정 상태',execution:'합성 재검토 관찰'});const second=current.results[1];current=await update('review.start',{resultId:second.id,scope:'visual'});expect(current.reviews[1].parentReviewId).toBe(review.id);expect(current.reviews[1].items.every(i=>i.verdict==='unverifiable')).toBe(true);expect(current.reviews[1].items.some(i=>i.regression)).toBe(true);
  current=await update('result.update',{resultId:result.id,patch:{execution:'추가 직접 확인 근거'}});expect(current.reviews[0].recheck?.criterionIds.length).toBeGreaterThan(0);
 }finally{await service.disconnect('manual');await service.store.close();expect(path.dirname(await realpath(root))).toBe(await realpath(parent));await rm(root,{recursive:true,force:true});}
});
