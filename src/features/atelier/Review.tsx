import {useState} from 'react';
import type {Review,ReviewItem,ManualResult} from '../../../shared/atelier/types';
import {createDomain} from '../../../shared/atelier/domain';
import {DraftForm,Inputs,type Field} from './Forms';
import {initialFields} from './Editors';
import {LocalImage} from './Resources';
import type {AtelierController} from './useAtelier';
import type {Data} from './api';
import {Artifacts} from './Artifacts';

const domain=createDomain({id:()=>{throw new Error('렌더링은 ID를 생성하지 않습니다.');},now:()=>''});
const verdicts=[{id:'unverifiable',label:'확인 불가'},{id:'match',label:'일치'},{id:'partial',label:'부분 일치'},{id:'mismatch',label:'불일치'},{id:'na',label:'해당 없음'}];
const planFields:Field[]=[{key:'problem',label:'문제와 실제 관찰 근거',type:'area'},{key:'cause',label:'원인 가설 (모르면 미확인)',type:'area'},{key:'target',label:'수정 대상',type:'area'},{key:'change',label:'변경 목표',type:'area'},{key:'scope',label:'수정 범위'},{key:'keep',label:'유지할 조건',type:'area'},{key:'materials',label:'필요 자료',type:'area'},{key:'check',label:'같은 기준으로 다시 확인할 방법',type:'area'}];
export function Reviews({c}:{c:AtelierController}){
 const p=c.project!,[selected,setSelected]=useState(()=>localStorage.getItem('atelier.review.'+p.id)||''),[baseline,setBaseline]=useState('');
 const active=p.reviews.find(r=>r.id===selected)||p.reviews.at(-1);
 return <section><h2>실제 결과를 기준과 비교하기</h2><p>프롬프트·실행 종료와 검토 완료를 구분합니다. 직접 관찰하지 않은 항목은 확인 불가로 남깁니다.</p>
  {!p.snapshots.length&&<div className="design-callout"><label>기존 결과를 비교할 현재 기준과 고정 이유<textarea value={baseline} onChange={e=>setBaseline(e.target.value)}/></label><button disabled={c.busy||!baseline.trim()} onClick={()=>void c.action('snapshot.create',{mode:'baseline',reason:baseline})}>진단용 기준 고정 (초안)</button></div>}
  {!!p.snapshots.length&&<RegisterResult c={c}/>}
  <section><h3>등록한 실제 결과</h3>{p.results.map(result=><article className="design-result" key={result.id}><h4>{result.screen} · 기준 v{p.snapshots.find(s=>s.id===result.snapshotId)?.number}</h4><p>출처 {result.source} · 환경 {result.environment}</p>{result.snapshotId!==p.snapshots.at(-1)?.id&&<p>과거 고정본의 결과입니다. 최신 고정본으로 재연결하지 않습니다.</p>}{result.fileId&&<LocalImage active={c.tab==='review'} c={c} fileId={result.fileId} alt={result.screen+' 수동 등록 결과'}/>}<p className="design-prewrap">{result.executionSource==='runtime'?'실제 런타임 기록':'직접 실행 기록'}: {result.execution||'없음 · 동작 검증 근거가 아닙니다.'}</p>{result.executionSource==='runtime'&&<p>사용자 직접 동작 관찰: {result.behaviorEvidence||'미등록 · 명령 종료와 동작 검토를 구분합니다.'}</p>}<p>{result.note}</p>{result.generationId&&<Artifacts c={c} generationId={result.generationId} active={c.tab==='review'}/>}<ResultMetadata c={c} result={result}/><div className="design-actions"><button disabled={c.busy} onClick={()=>void c.action('review.start',{resultId:result.id,scope:'visual'})}>이 결과의 새 시각 검토 시작</button><button disabled={c.busy} onClick={()=>void c.action('review.start',{resultId:result.id,scope:'behavior'})}>이 결과의 새 동작 검토 시작</button></div></article>)}</section>
  {!!p.reviews.length&&<label>검토 회차 선택<select value={active?.id||''} onChange={e=>{setSelected(e.target.value);localStorage.setItem('atelier.review.'+p.id,e.target.value);}}>{p.reviews.map((r,i)=><option value={r.id} key={r.id}>{i+1}회 · {r.screen} · {r.state==='completed'?'검토 완료':r.state==='held'?'보류':r.state==='needs-revision'?'수정 계획 있음':'검토 중'}</option>)}</select></label>}
  {active&&<ReviewEditor key={active.id} c={c} review={active}/>}
  <section><h3>저장한 수정 계획</h3>{p.plans.map(plan=><article className="design-entity" key={plan.id}><p>원본 결과: {p.results.find(r=>r.id===plan.resultId)?.screen} · 원본 기준 v{p.snapshots.find(s=>s.id===plan.snapshotId)?.number} · {plan.confirmed?'사용자 확정':'미확정'}</p>
   <DraftForm draftKey={p.id+':plan:'+plan.id} title="수정 계획 편집" initial={initialFields(plan,planFields)} disabled={c.busy||p.snapshots.some(s=>s.planId===plan.id)} onSave={fields=>c.commit('plan.update',{planId:plan.id,fields})}>{(v,set)=><Inputs fields={planFields} values={v} set={set}/>}</DraftForm>
   <div className="design-actions"><button disabled={c.busy||plan.confirmed} onClick={()=>void c.action('plan.confirm',{planId:plan.id})}>저장한 계획 확인·확정</button><button disabled={c.busy||!plan.confirmed} onClick={()=>void c.action('snapshot.create',{mode:'revision',planId:plan.id}).then(next=>{if(next)c.navigate('prompt');})}>이 계획으로 새 수정 프롬프트 고정</button></div><p>새 결과를 등록하고 같은 기준으로 다시 검토해야 합니다. 프롬프트 생성만으로 해결로 표시하지 않습니다.</p>
  </article>)}</section>
 </section>;
}
function ResultMetadata({c,result}:{c:AtelierController;result:ManualResult}){
 const fields:Field[]=[{key:'screen',label:'화면·상태'},...(result.executionSource==='runtime'?[{key:'behaviorEvidence',label:'사용자가 직접 실행한 조작·환경·관찰 근거',type:'area' as const}]:[{key:'source',label:'출처'},{key:'environment',label:'환경'},{key:'execution',label:'직접 실행 근거',type:'area' as const}]),{key:'note',label:'관찰·한계',type:'area'},{key:'keep',label:'유지할 부분',type:'area'}];
 return <details><summary>결과 설명·직접 실행 근거 보완</summary><p>자동 수집한 출처·실행 기록은 보존합니다. 사용자 관찰은 별도로 기록하며 저장 후 새 검토 회차에서 확인하세요.</p><DraftForm draftKey={c.project!.id+':result:'+result.id} title="결과 메타데이터 보완" initial={initialFields(result,fields)} onSave={patch=>c.commit('result.update',{resultId:result.id,patch})} disabled={c.busy}>{(v,set)=><Inputs fields={fields} values={v} set={set}/>}</DraftForm></details>;
}
function RegisterResult({c}:{c:AtelierController}){
 const p=c.project!,[file,setFile]=useState<File|null>(null);
 const fields:Field[]=[{key:'snapshotId',label:'실제로 사용한 고정 기준',type:'select',options:p.snapshots.map(s=>({id:s.id,label:`v${s.number} · ${s.planId?'수정':s.draft?'진단 초안':'확정'} · r${s.revision}`}))},{key:'screen',label:'화면·상태 이름'},{key:'environment',label:'실제 확인 환경'},{key:'source',label:'실제 출처·도구·작성자'},{key:'execution',label:'직접 실행한 조작·관찰 기록 (스크린샷만 있으면 비움)',type:'area'},{key:'note',label:'보이는 차이·알려진 한계',type:'area'},{key:'keep',label:'유지하고 싶은 요소',type:'area'}];
 return <DraftForm draftKey={p.id+':register-result'} title="외부에서 만든 실제 결과 수동 등록" initial={{snapshotId:'',screen:'',environment:'',source:'',execution:'',note:'',keep:'',fileLabel:''}} disabled={c.busy} onSave={values=>c.commitJob(async()=>{
   // This form uses its own gate because file commit and result registration are separate server operations.
   if(!values.snapshotId||!values.screen||!values.environment||!values.source)throw new Error('사용한 기준·화면·환경·실제 출처를 적어 주세요.');
   let fileIds:string[]=[];
   if(file){const uploaded=await c.upload(file,file.name,'result');fileIds=[uploaded.id];}
   const {fileLabel:_,...metadata}=values;const result=await c.mutate('result.register',{...metadata,...(fileIds.length?{fileIds}:{})});setFile(null);return result;
 })}>{(v,set)=><><Inputs fields={fields} values={v} set={set}/><label>실제 결과 이미지 (선택)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);set('fileLabel',next?.name||'');}}/></label><p>이미지 또는 직접 실행한 기록이 필요합니다. 이미지를 자동으로 만들거나 관찰을 대신 작성하지 않습니다.</p></>}</DraftForm>;
}
function ReviewEditor({c,review:r}:{c:AtelierController;review:Review}){
 const [hold,setHold]=useState('');const p=c.project!;
 const roots:Field[]=[{key:'scope',label:'검토 범위',type:'select',options:[{id:'visual',label:'시각만'},{id:'behavior',label:'직접 실행한 동작 포함'}]},{key:'intent',label:'실제 결과와 의도의 관계',type:'select',options:[{id:'unknown',label:'미확인'},{id:'match',label:'맞음'},{id:'different',label:'다름'}]},{key:'intentReason',label:'실제 결과를 보고 확인한 이유',type:'area'},{key:'learning',label:'이번 결과에서 배운 점',type:'area'},{key:'externalFeedback',label:'사용자가 등록한 AI·외부 의견 (사용자 판정과 별개, 자동 분석 아님)',type:'area'},{key:'feedbackSource',label:'의견 출처·모델·사용자가 가져온 경로'}];
 const initial={...initialFields(r,roots),items:r.items.map(i=>({id:i.id,verdict:i.verdict,observation:i.observation,evidence:i.evidence,target:i.target,keep:i.keep,cause:i.cause,resolution:i.resolution,selected:i.selected}))};
 return <section><h3>해당 회차 기준별 관찰</h3>{r.recheck&&<p className="design-conflict">기준 변경으로 재검토가 필요합니다. 당시 판정은 보존되었습니다. 이유: {r.recheck.reason}</p>}
  <DraftForm draftKey={p.id+':review:'+r.id} title="검토 관찰·근거·판정" initial={initial} disabled={c.busy} onSave={patch=>c.commit('review.update',{reviewId:r.id,patch})}>{(values,set)=><><Inputs fields={roots} values={values} set={set}/>{r.items.map((criterion,index)=>{
   const items=values.items as Data[],item=items[index];
   return <fieldset key={criterion.id}><legend>{criterion.label} · {criterion.scope==='behavior'?'직접 동작 검토':'시각 기준'}{criterion.regression?' · 이전 일치 회귀 확인':''}</legend><p className="design-prewrap">기대: {criterion.expected}</p><Inputs fields={[{key:'verdict',label:'사용자 판정',type:'select',options:verdicts},{key:'observation',label:'실제로 관찰한 내용',type:'area'},{key:'evidence',label:'해당 화면·영역·실행 근거',type:'area'},{key:'target',label:'수정 대상'},{key:'keep',label:'유지할 부분'},{key:'cause',label:'원인 가설'},{key:'resolution',label:'새 결과에서 재검토 판정',type:'select',options:[{id:'unverifiable',label:'확인 불가'},{id:'resolved',label:'해결 확인'},{id:'remaining',label:'남은 문제'},{id:'new-problem',label:'새 문제'}]},{key:'selected',label:'수정 계획에 포함',type:'checkbox'}]} values={item} set={(key,value)=>set('items',items.map((i,n)=>n===index?{...i,[key]:value}:i))}/></fieldset>;
  })}</>}</DraftForm>
  <details><summary>현재 저장본의 검토 완료 조건 확인</summary><ul>{domain.reviewProblems(p,r).map((problem,i)=><li key={i}>{problem}</li>)}</ul></details><div className="design-actions"><button disabled={c.busy} onClick={()=>void c.action('review.finish',{reviewId:r.id})}>저장한 근거로 검토 완료 확인</button><label>보류 이유<input value={hold} onChange={e=>setHold(e.target.value)}/></label><button disabled={c.busy||!hold.trim()} onClick={()=>void c.action('review.hold',{reviewId:r.id,reason:hold})}>이 회차 보류</button></div>
  <DraftForm draftKey={p.id+':new-plan:'+r.id} title="선택한 항목의 수정 계획 작성" initial={{problem:r.items.filter(i=>i.selected).map(i=>i.label+': '+i.observation+' / '+i.evidence).join('\n'),cause:'원인 미확인',target:r.screen,change:'',scope:r.screen,keep:'',materials:'연결한 기준과 실제 결과',check:r.items.filter(i=>i.selected).map(i=>i.label+': '+i.expected).join('\n')}} disabled={c.busy} onSave={fields=>c.commit('plan.create',{reviewId:r.id,fields})}>{(v,set)=><><p>위 검토에서 수정 항목을 선택하고 먼저 저장하세요.</p><Inputs fields={planFields} values={v} set={set}/></>}</DraftForm>
 </section>;
}
