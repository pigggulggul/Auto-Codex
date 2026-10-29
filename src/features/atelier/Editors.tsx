import {useState} from 'react';
import type {Decision,Flow,Project} from '../../../shared/atelier/types';
import {PALETTES} from '../../../shared/atelier/guide';
import {DraftForm,Inputs,type Field,type Choice} from './Forms';
import {data,type Data} from './api';
import type {AtelierController} from './useAtelier';

export type Kind='features'|'contents'|'flows'|'screens'|'concepts'|'styles'|'assets'|'regions';
const area=(key:string,label:string):Field=>({key,label,type:'area'});
const choice=(key:string,label:string,options:Choice[]):Field=>({key,label,type:'select',options});
const labels:Record<Kind,string>={features:'핵심 기능',contents:'콘텐츠',flows:'흐름',screens:'화면·상태',concepts:'컨셉',styles:'스타일 규칙',assets:'리소스',regions:'영역 관찰'};
export const options=(items:Array<{id:string;value?:string;name?:string}>):Choice[]=>items.map(x=>({id:x.id,label:x.value||x.name||'이름 미정'}));
const words=(values:string[])=>values.map(id=>({id,label:id}));
export function editable(values:Data){const result={...values};for(const key of ['conceptId','fontAssetId','fileId','cropId'])if(key in result&&result[key]==='')result[key]=null;if(!result.scopeMode)delete result.scopeMode;return result;}
export function initialFields(node:unknown,fields:Field[]):Data {const d=data(node);return Object.fromEntries(fields.map(f=>[f.key,d[f.key]??(f.type==='multi'?[]:f.type==='checkbox'?false:'')]));}
export function fieldsFor(kind:Kind,p:Project):Field[]{
 const specific:Record<Kind,Field[]>={
  features:[choice('priority','제작 범위',words(['이번 범위','후속 범위','제외 검토'])),area('purpose','이 기능의 목적'),area('action','사용자가 할 행동'),area('info','필요한 정보'),{key:'flowIds',label:'연결 흐름',type:'multi',options:options(p.flows)}],
  contents:[{key:'kind',label:'자료 종류'},area('purpose','용도'),choice('availability','확보 상태',words(['제작 필요','보유','확보 필요'])),area('content','실제 내용'),area('conditions','사용 조건'),{key:'materialType',label:'실제 자료·샘플·제안 구분'}],
  flows:[area('goal','흐름의 목표'),{key:'role',label:'사용자 역할'},{key:'start',label:'시작 조건'},area('branch','분기 메모'),area('recovery','실패·취소 복구와 보존 데이터'),area('complete','완료 기준'),{key:'loop',label:'반복 흐름',type:'checkbox'},{key:'steps',label:'연결 화면·상태 (아래에서 순서 조정)',type:'multi',options:options(p.screens)}],
  screens:[{key:'kind',label:'페이지·패널·게임 상태'},{key:'role',label:'이 화면의 역할'},{key:'entry',label:'진입 조건'},area('priority','정보 위계'),area('actions','가능한 행동'),area('response','행동 후 반응'),{key:'next',label:'다음 행동'},area('exceptions','예외·실패'),area('preserve','유지할 입력·선택')],
  concepts:[area('summary','방향 요약'),area('experience','만들고 싶은 경험'),{key:'hero',label:'주인공이 되는 내용'},{key:'bg',label:'배경 색'},{key:'text',label:'본문 색'},{key:'accent',label:'강조 색'},{key:'font',label:'서체 분류'},{key:'shape',label:'형태'},area('typography','제목·본문 관계'),area('layout','구성·배치'),area('material','재질'),area('motion','움직임'),area('intensity','적용 강도'),area('resources','필요 리소스·부담'),area('reference','원본과의 관계'),area('assumptions','확인할 가정')],
  styles:[{key:'role',label:'역할 (배경·본문·강조·서체·형태 등)'},area('exception','예외·적용하지 않을 곳'),choice('conceptId','기준 컨셉',options(p.concepts)),choice('fontAssetId','로컬 서체 리소스',options(p.assets.filter(a=>a.fileId)))],
  assets:[{key:'kind',label:'자료 종류'},area('purpose','용도'),{key:'method',label:'제작·확보 방식'},choice('availability','확보 상태',words(['제작 필요','보유','확보 필요'])),area('rules','크기·표현 규칙'),{key:'sourceUrl',label:'출처 URL (자동 접속하지 않음)'},area('usage','사용 조건·라이선스'),area('review','결과에서 확인할 것')],
  regions:[area('observation','직접 관찰한 특징'),area('interpretation','사용자 해석'),{key:'dimension',label:'관찰 기준 (색·배치·재질 등)'},area('target','적용 대상'),area('purpose','적용 목적'),area('keep','유지할 특징'),area('change','조정할 특징'),area('avoid','제외할 특징'),{key:'useMode',label:'참고 방식'}, {key:'appliesTo',label:'실제 적용 결정',type:'multi',options:options([...p.features,...p.screens,...p.styles,...p.assets])}]
 };
 return [{key:'value',label:kind==='regions'?'관찰 이름':`${labels[kind]} 이름·값`},...specific[kind],area('scope','적용 범위'),area('reason','이유')];
}
export function EntityEditor({c,kind,node,extra}:{c:AtelierController;kind:Kind;node:Decision;extra?:React.ReactNode}){
 const p=c.project!;
 const base=fieldsFor(kind,p),advanced:Field[]=[choice('scopeMode','범위 적용 방식',[{id:'global',label:'전체'},{id:'targets',label:'연결한 대상만'}]),{key:'screenIds',label:'적용 화면',type:'multi',options:options(p.screens)},{key:'assetIds',label:'적용 리소스',type:'multi',options:options(p.assets)},{key:'referenceIds',label:'근거 레퍼런스',type:'multi',options:options(p.references)},{key:'regionIds',label:'근거 영역',type:'multi',options:options(p.references.flatMap(r=>r.regions))},{key:'dependsOn',label:'영향을 받는 근거 결정',type:'multi',options:options([...Object.values(p.fields),...p.features,...p.screens,...p.flows,...p.contents,...p.styles,...p.assets,...p.concepts,...p.references.flatMap(r=>r.regions)].filter(d=>d.id!==node.id))}];
 const all=[...base,...advanced];
 return <article className="design-entity" data-entity={node.id}>
  <div className="design-entity-state"><strong>{({unknown:'미정',proposed:'제안',confirmed:'확정',excluded:'제외'})[node.status]}</strong><span>출처: {({user:'사용자',example:'내장 예시',observation:'사용자 관찰',external:'외부 제안'})[node.source]} · v{node.version}</span>{node.reviewNeeded&&<strong>원본 변경 · 재검토 필요</strong>}</div>
  <DraftForm key={p.id+node.id} draftKey={p.id+':'+node.id} title={node.value||labels[kind]} initial={initialFields(node,all)} disabled={c.busy} onSave={v=>c.commit('entity.mutate',{kind,action:'patch',entityId:node.id,value:editable(v)})}>
   {(values,set)=><><Inputs fields={base} values={values} set={set}/>{kind==='flows'&&Array.isArray(values.steps)&&<ol className="design-sequence">{(values.steps as string[]).map((id,index)=><li key={id}>{p.screens.find(s=>s.id===id)?.value||'이름 미정'} <button type="button" disabled={!index} onClick={()=>{const ids=[...(values.steps as string[])];[ids[index-1],ids[index]]=[ids[index],ids[index-1]];set('steps',ids);}}>위로</button><button type="button" disabled={index===(values.steps as string[]).length-1} onClick={()=>{const ids=[...(values.steps as string[])];[ids[index+1],ids[index]]=[ids[index],ids[index+1]];set('steps',ids);}}>아래로</button></li>)}</ol>}<details open={p.settings.density==='quick'}><summary>상세 적용 범위와 영향 연결</summary><Inputs fields={advanced} values={values} set={set}/></details></>}
  </DraftForm>
  {extra}
  <div className="design-actions"><button disabled={c.busy} onClick={()=>void c.action('entity.mutate',{kind,action:'confirm',entityId:node.id})}>저장본 확인·확정</button><button disabled={c.busy} onClick={()=>void c.action('entity.mutate',{kind,action:'exclude',entityId:node.id})}>저장본 제외</button>{kind==='concepts'&&<button disabled={c.busy} onClick={()=>void c.action('entity.mutate',{kind,action:'selectConcept',entityId:node.id})}>이 방향 선택·확정</button>}</div>
  {kind==='concepts'&&node.selected&&<label>내장 팔레트로 표현 규칙 제안 추가<select defaultValue="" disabled={c.busy} onChange={e=>{if(e.target.value!=='')void c.action('entity.mutate',{kind,action:'applyPalette',entityId:node.id,value:{paletteIndex:Number(e.target.value)}});e.target.value='';}}><option value="">직접 선택하세요</option>{PALETTES.map((v,i)=><option key={v.name} value={i}>{v.label} · 내장 예시</option>)}</select></label>}
  {kind==='flows'&&<GraphEditor c={c} flow={node as Flow}/>}
  <details><summary>결정 이력 {node.history.length}개</summary>{node.history.map((h,i)=><p key={i}>v{h.version} · {h.value} · {h.status} · {h.at}</p>)}<button disabled={c.busy} onClick={()=>{if(window.confirm('이 항목을 제거할까요? 연결된 항목이 있으면 먼저 연결을 해제해야 합니다.'))void c.action('entity.mutate',{kind,action:'remove',entityId:node.id});}}>항목 제거</button></details>
 </article>;
}
export function GraphEditor({c,flow}:{c:AtelierController;flow:Flow}){
 const g=flow.graph;if(!g)return null;
 const graph={entryId:g.entryId,terminalIds:g.terminalIds,transitions:g.transitions,branchPolicy:g.branchPolicy,branchReason:g.branchReason,recoveryPolicy:g.recoveryPolicy,recoveryReason:g.recoveryReason};
 const screens=options(c.project!.screens.filter(s=>flow.steps.includes(s.id)));
 return <section className="design-graph"><h4>연결·분기·실패 복구 · 확인 {g.reviewedVersion}/{g.version}</h4><DraftForm draftKey={c.project!.id+':graph:'+flow.id} title="흐름 연결 편집" initial={graph} disabled={c.busy} onSave={v=>c.commit('entity.mutate',{kind:'flows',action:'patch',entityId:flow.id,value:{graph:v}})}>{(v,set)=>{
  const edges=Array.isArray(v.transitions)?v.transitions as Data[]:[];
  return <><Inputs fields={[choice('entryId','시작 화면',screens),{key:'terminalIds',label:'완료·반복 확인 지점',type:'multi',options:screens},...['branch','recovery'].flatMap(key=>[choice(key+'Policy',key==='branch'?'분기 정책':'복구 정책',[{id:'pending',label:'미정'},{id:'mapped',label:'실제 연결 있음'},{id:'none',label:'해당 없음'}]),area(key+'Reason','해당 없음 또는 정책의 이유')])]} values={v} set={set}/>{edges.map((edge,index)=><fieldset key={String(edge.id||index)}><legend>연결 {index+1}</legend><Inputs fields={[choice('from','출발',screens),choice('to','도착',screens),choice('kind','연결 종류',[{id:'next',label:'기본 진행'},{id:'branch',label:'조건 분기'},{id:'recovery',label:'실패·취소 복구'},{id:'loop',label:'반복'}]),area('condition','발생 조건'),area('preserve','복구 시 유지할 데이터')]} values={edge} set={(k,value)=>set('transitions',edges.map((e,i)=>i===index?{...e,[k]:value}:e))}/><button type="button" onClick={()=>set('transitions',edges.filter((_,i)=>i!==index))}>이 연결 제거</button></fieldset>)}<button type="button" onClick={()=>set('transitions',[...edges,{from:flow.steps[0]||'',to:'',kind:'branch',condition:'',preserve:''}])}>연결 추가</button></>;
 }}</DraftForm><button disabled={c.busy} onClick={()=>void c.action('entity.mutate',{kind:'flows',action:'acknowledgeGraph',entityId:flow.id})}>저장한 연결·분기·복구 기준 확인</button></section>;
}
export function EntityList({c,kind,title,extra}:{c:AtelierController;kind:Exclude<Kind,'regions'>;title?:string;extra?:(d:Decision)=>React.ReactNode}){
 const p=c.project!;const list=p[kind];
 return <section><div className="design-section-title"><h2>{title||labels[kind]}</h2><button disabled={c.busy} onClick={()=>void c.action('entity.mutate',{kind,action:'add',value:{value:'새 '+labels[kind]}})}>직접 추가</button></div>{!list.length&&<p>등록한 {labels[kind]}이 없습니다. 직접 작성하거나 실제 자료를 연결하세요.</p>}{list.map(d=><EntityEditor key={p.id+d.id} c={c} kind={kind} node={d} extra={extra?.(d)}/>)}</section>;
}
