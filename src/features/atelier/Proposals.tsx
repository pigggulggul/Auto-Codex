import {useCallback,useEffect,useRef,useState} from 'react';
import type {DesignProposal,ProposalPurpose} from '../../../shared/atelier/proposals';
import type {Project,Decision} from '../../../shared/atelier/types';
import type {AtelierController} from './useAtelier';
import {DraftForm,Inputs} from './Forms';
import {record,type Data} from './api';
import {options} from './Editors';
import {QUESTIONS} from '../../../shared/atelier/guide';
import {BlueprintCandidate,canStartBlueprint} from './Blueprint';

export const PROPOSAL_PURPOSES=[
 {id:'blueprint',label:'아이디어로 전체 디자인 설계 만들기',description:'답변·기능·화면·흐름·시각 시스템을 함께 설계하고, 필요한 질문만 확인해요.'},
 {id:'brief',label:'아이디어와 답변 정리',description:'처음 적은 아이디어와 저장한 답변을 바탕으로 프로젝트 설계를 구체화해요.'},
 {id:'flow',label:'사용하는 순서 다듬기',description:'등록한 화면을 어떤 순서로 이용할지, 막히면 어디로 돌아갈지 제안해요.'},
 {id:'concept',label:'전체 분위기 제안',description:'아이디어와 사용자에 어울리는 색·글자·배치의 방향을 제안해요.'},
 {id:'style',label:'색·글자·모양의 규칙 다듬기',description:'등록한 표현 약속을 어느 곳에 어떻게 적용할지 구체화해요.'}
] as const;
const stateNames={preparing:'제안 준비 중',running:'AI가 답변을 만들고 있어요',ready:'후보 도착 · 마음에 드는 내용을 골라 주세요',failed:'제안을 가져오지 못했어요',stale:'이후 설계가 바뀌어 다시 요청해야 해요',interrupted:'요청을 중단했어요'};
const fieldNames:Record<string,string>={value:'내용',reason:'이렇게 제안한 이유',scope:'사용할 곳',goal:'사용자가 얻는 결과',role:'사용자·역할',start:'시작하는 때',branch:'상황에 따라 다른 길',recovery:'실패·취소 후 돌아오는 법',complete:'완료하는 때',summary:'분위기 요약',experience:'원하는 느낌',hero:'가장 눈에 띄는 내용',bg:'배경색',text:'글자색',accent:'강조색',font:'글자 느낌',shape:'모양',typography:'제목과 본문',material:'질감',layout:'배치',motion:'움직임',intensity:'표현 강도',resources:'준비할 자료',reference:'참고한 점',assumptions:'확인할 가정',exception:'적용하지 않을 곳',steps:'화면 순서',graph:'화면 연결'};
export function proposalNodes(p:Project,purpose:ProposalPurpose):Decision[]{return purpose==='blueprint'?[]:purpose==='brief'?QUESTIONS.map(q=>p.fields[q.key]):purpose==='flow'?p.flows:purpose==='concept'?p.concepts:p.styles;}
export function proposalTargetName(p:Project,id:string){return QUESTIONS.find(q=>p.fields[q.key].id===id)?.label||[...p.flows,...p.concepts,...p.styles].find(d=>d.id===id)?.value||'이전 설계 항목';}
export function Proposals({c,ready,model,effort}:{c:AtelierController;ready:boolean;model?:string;effort?:string;onInterrupt?:()=>void}){
 const p=c.project!,[purpose,setPurpose]=useState<ProposalPurpose>('brief'),[ids,setIds]=useState<string[]>([]),[rows,setRows]=useState<Data[]>([]),[proposal,setProposal]=useState<DesignProposal|null>(null),[loading,setLoading]=useState(false),[newName,setNewName]=useState('');
 const [request,setRequest]=useState(()=>{try{return localStorage.getItem('atelier.proposal-help.'+p.id)??'저장한 아이디어를 처음 쓰는 사람도 이해할 수 있도록 구체적으로 정리해 주세요.';}catch{return '';}});
 useEffect(()=>{try{localStorage.setItem('atelier.proposal-help.'+p.id,request);}catch{/* Keep the visible request if browser storage is unavailable. */}},[p.id,request]);
 const selected=useRef(''),refreshTicket=useRef(0),retryKey='atelier.proposal-request.'+p.id;
 const [showResult,setShowResult]=useState(false);
 const [retry,setRetry]=useState<Data|null>(()=>{try{return JSON.parse(localStorage.getItem(retryKey)||'null') as Data|null;}catch{return null;}});
 const refresh=useCallback(async(id?:string)=>{
  if(id)selected.current=id;const ticket=++refreshTicket.current;setLoading(true);
  try{const list=(await c.api.pages('proposal.list',{designProjectId:p.id})).filter(record);if(ticket!==refreshTicket.current)return;setRows(list);const key=id||selected.current||String(list[0]?.id||'');
   if(key){const result=await c.api.request('proposal.read',{designProjectId:p.id,proposalId:key});if(ticket!==refreshTicket.current)return;setProposal(result.proposal as unknown as DesignProposal);selected.current=key;}
  }finally{if(ticket===refreshTicket.current)setLoading(false);}
 },[c.api,p.id]);
 useEffect(()=>{void refresh().catch(e=>c.setError(String(e)));return c.api.subscribe(e=>{if(e.type==='atelier.proposal.changed'&&e.designProjectId===p.id)void refresh().catch(err=>c.setError(String(err)));});},[refresh,c.api,p.id,c.setError]);
 useEffect(()=>{const next=c.tab==='flow'?'flow':c.tab==='concept'?'concept':c.tab==='style'?'style':c.tab==='design'&&canStartBlueprint(c.projectRef.current!)?'blueprint':'brief';setPurpose(next);setIds(proposalNodes(c.projectRef.current!,next).slice(0,next==='brief'?3:1).map(d=>d.id));setNewName('');setShowResult(false);},[c.tab,p.id,c.projectRef]);
 const choose=(next:ProposalPurpose)=>{setPurpose(next);setIds(proposalNodes(p,next).slice(0,next==='brief'?3:1).map(d=>d.id));setNewName('');setShowResult(false);};
 const nodes=proposalNodes(p,purpose),validIds=ids.filter(id=>nodes.some(d=>d.id===id)),active=rows.some(r=>r.state==='preparing'||r.state==='running');
 const run=(payload:Data)=>c.perform(async()=>{setShowResult(true);setRetry(payload);localStorage.setItem(retryKey,JSON.stringify(payload));const result=await c.api.request('ai.propose',payload);await refresh(String(result.proposalId));setRetry(null);localStorage.removeItem(retryKey);});
 const createTarget=async()=>{const kind=purpose==='concept'?'concepts':purpose==='style'?'styles':'flows';const next=await c.action('entity.mutate',{kind,action:'add',value:{value:newName.trim(),...(kind==='flows'?{steps:p.screens.map(d=>d.id)}:{})}});if(next){setIds([next[kind].at(-1)!.id]);setNewName('');}};
 return <section id="atelier-proposals" className="design-proposals" aria-label="읽기 전용 AI 설계 제안">
  <div className="design-proposals-header"><h2>AI와 함께 설계 다듬기</h2><span>저장한 아이디어 → 후보 확인 → 선택해서 반영</span></div>
  <p>빈칸을 혼자 모두 채울 필요는 없어요. 처음 적은 아이디어와 저장한 답변·기능·화면·분위기를 함께 참고해 제안해요. 편집 중인 답변은 먼저 저장해 주세요.</p>
  <ol className="design-proposal-steps"><li>무엇을 도와줄지 선택</li><li>현재 내용과 후보 비교</li><li>마음에 드는 후보만 설계에 반영</li></ol>
  <p role="status">{ready?'AI 연결됨 · '+(model||'기본 모델'):'AI 미연결 · 작업실 설정에서 Codex CLI 설치·로그인과 연결 상태를 확인하세요. 직접 입력과 저장은 계속할 수 있어요.'}</p>
  <label>무엇을 도와드릴까요?<select value={purpose} onChange={e=>choose(e.target.value as ProposalPurpose)}>{PROPOSAL_PURPOSES.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
  <p>{PROPOSAL_PURPOSES.find(o=>o.id===purpose)?.description}</p>
  <label>원하는 도움 (선택)<textarea maxLength={1024} value={request} onChange={e=>setRequest(e.target.value)} placeholder="예: 첫 버전에 꼭 필요한 내용만 남겨 주세요. 모호한 부분을 구체적인 예로 설명해 주세요."/></label>
  {!!nodes.length&&<Inputs fields={[{key:'targets',label:'도움을 받을 항목 (최대 8개)',type:'multi',options:nodes.map(d=>({id:d.id,label:proposalTargetName(p,d.id)})),help:'처음에는 기본 항목을 골라 두었어요. 체크한 항목마다 후보가 나오며, 반영 전까지 원래 내용은 유지돼요.'}]} values={{targets:validIds}} set={(_key,value)=>setIds(value as string[])}/>}
  {purpose==='blueprint'&&<p className="design-callout">{canStartBlueprint(p)?'처음 적은 아이디어로 전체 설계를 만들어요. 기능이나 화면을 먼저 등록할 필요 없어요.':'이미 설계 항목이 있어요. 전체 설계는 새 프로젝트에서 시작하고, 이 프로젝트에서는 항목별 제안으로 다듬을 수 있어요.'}</p>}
  {!nodes.length&&purpose!=='blueprint'&&<div className="design-callout"><h3>아직 다듬을 항목이 없어요</h3><p>AI 제안은 이름을 붙여 저장한 항목에 후보를 만들어요. 먼저 하나를 준비하거나 “아이디어와 답변 정리”로 돌아가 시작할 수 있어요.</p>{purpose==='flow'&&!p.screens.length?<><p>이용 순서를 제안하려면 연결할 화면이 필요해요. 예: 장소 찾기, 담은 장소 보기.</p><button disabled={c.busy} onClick={()=>{c.navigate('flow');requestAnimationFrame(()=>document.getElementById('atelier-screens')?.scrollIntoView({behavior:'instant'}));}}>이용 순서에서 화면 먼저 추가하기</button></>:<><label>새 항목의 이름<input value={newName} onChange={e=>setNewName(e.target.value)} placeholder={purpose==='concept'?'예: 편안한 여행 노트':purpose==='style'?'예: 주요 버튼 색':'예: 첫 일정 만들기'}/></label><button disabled={c.busy||!newName.trim()} onClick={()=>void createTarget()}>이 이름으로 항목 준비하기</button></>}<button onClick={()=>choose('brief')}>아이디어부터 도움받기</button></div>}
  {validIds.length>8&&<p role="alert">한 번에 8개까지 선택해 주세요.</p>}
  <div className="design-actions"><button className="atelier-primary" disabled={!ready||c.busy||active||(purpose==='blueprint'?!canStartBlueprint(p):!validIds.length)||validIds.length>8} onClick={()=>void run({designProjectId:p.id,expectedVersion:p.version,revision:p.revision,purpose,targetIds:validIds,request,...(model?{model}:{}),...(effort?{effort}:{}),idempotencyKey:crypto.randomUUID()})}>{active?'AI 답변을 기다리는 중…':'이 내용으로 AI 제안받기'}</button>
   {retry&&<button disabled={!ready||c.busy} onClick={()=>void run(retry)}>응답이 끊긴 요청의 결과 확인</button>}
   <button disabled={loading||c.busy} onClick={()=>void c.perform(()=>refresh())}>이전 제안 새로고침</button>
   {active&&<button onClick={()=>void c.perform(async()=>{const id=rows.find(r=>r.state==='preparing'||r.state==='running')?.id;if(id)await c.api.request('ai.interrupt',{designProjectId:p.id,proposalId:id});})}>제안 중단</button>}
  </div>
  <p>이 요청은 설계 제안만 받아요. 파일을 만들거나 바꾸지 않아요. 설계 텍스트는 기존 Codex 모델 경로로 전달되며, 이미지와 도구·네트워크 권한은 제공하지 않아요.</p>
  {!!rows.length&&<details open={showResult} onToggle={e=>setShowResult(e.currentTarget.open)}><summary>{active?'현재 AI 제안 진행 상황':'받은 제안과 반영 내역'} · {rows.length}개</summary><label>이전에 받은 제안<select value={proposal?.id||''} onChange={e=>void c.perform(()=>refresh(e.target.value))}>{rows.map(r=><option key={String(r.id)} value={String(r.id)}>{PROPOSAL_PURPOSES.find(o=>o.id===r.purpose)?.label} · {stateNames[r.state as keyof typeof stateNames]}</option>)}</select></label>
  {proposal&&<article className="design-entity"><h3>{stateNames[proposal.state]}</h3>{proposal.error&&<div role="alert"><p>{proposal.error.message}</p>{proposal.error.code==='INVALID_OUTPUT'&&proposal.purpose!=='blueprint'&&<p>한 항목으로 줄여 다시 요청할 수 있어요. 같은 오류가 계속되면 작업실 설정에서 사용 가능한 모델을 확인해 주세요.</p>}</div>}
   {proposal.state==='ready'&&p.revision!==proposal.applicableRevision&&<p className="design-conflict">제안 이후 설계가 변경됐어요. 최신 내용으로 다시 요청해 주세요.</p>}
   {proposal.candidates.map(candidate=>proposal.purpose==='blueprint'?<BlueprintCandidate key={candidate.id} c={c} proposal={proposal} candidate={candidate} onRefresh={()=>refresh(proposal.id)} onRefine={()=>void run({designProjectId:p.id,expectedVersion:p.version,revision:p.revision,purpose:'blueprint',targetIds:[],request,refine:{proposalId:proposal.id,proposalVersion:proposal.version,candidateId:candidate.id},...(model?{model}:{}),...(effort?{effort}:{}),idempotencyKey:crypto.randomUUID()})}/>:<section key={candidate.id} className="design-candidate"><h4>{proposalTargetName(p,candidate.targetId)}</h4><dl className="design-candidate-change"><div><dt>요청할 때의 내용</dt><dd>{String(proposal.before[candidate.targetId]?.value||'아직 비어 있어요')}</dd></div>{Object.entries(candidate.patch).filter(([key,value])=>!['graph','steps'].includes(key)&&typeof value==='string'&&value.trim()).map(([key,value])=><div key={key}><dt>제안 · {fieldNames[key]||key}</dt><dd>{String(value)}</dd></div>)}</dl><p>이유: {candidate.rationale}</p><p>아직 확인할 점: {candidate.assumptions||'별도 가정이 없다는 응답이에요. 실제 상황에 맞는지 확인해 주세요.'}</p>
    <details><summary>후보를 내 말로 고치기 (선택)</summary><p>여기서 고친 내용은 후보에만 저장돼요. 설계에 반영하려면 아래 버튼을 눌러 주세요.</p><DraftForm draftKey={p.id+':candidate:'+candidate.id} title="후보 편집" initial={candidate.patch} disabled={c.busy||!['proposed','edited'].includes(candidate.state)} onSave={patch=>c.commitJob(async()=>{await c.api.request('proposal.edit',{designProjectId:p.id,proposalId:proposal.id,proposalVersion:proposal.version,candidateId:candidate.id,patch});await refresh(proposal.id);})}>{(v,set)=><><Inputs fields={Object.keys(candidate.patch).filter(key=>!['steps','graph'].includes(key)).map(key=>({key,label:fieldNames[key]||key,type:'area'}))} values={v} set={set}/>{proposal.purpose==='flow'&&<><Inputs fields={[{key:'steps',label:'후보에 포함할 화면',type:'multi',options:options(p.screens)}]} values={v} set={set}/>{record(v.graph)&&<CandidateGraph graph={v.graph} screens={options(p.screens.filter(s=>Array.isArray(v.steps)&&v.steps.includes(s.id)))} set={graph=>set('graph',graph)}/>}</>}</>}</DraftForm></details>
    {proposal.purpose==='flow'&&<FlowPreview p={p} patch={candidate.patch}/>}
    <details><summary>변경되는 모든 값 비교</summary><dl>{Object.entries(candidate.patch).map(([key,value])=><div key={key}><dt>{fieldNames[key]||key}</dt><dd>기존: {typeof proposal.before[candidate.targetId]?.[key]==='string'?String(proposal.before[candidate.targetId][key])||'(비어 있음)':JSON.stringify(proposal.before[candidate.targetId]?.[key]??null)}<br/>후보: {typeof value==='string'?value||'(비어 있음)':JSON.stringify(value)}</dd></div>)}</dl></details>
    <div className="design-actions"><button className="atelier-primary" disabled={c.busy||proposal.state!=='ready'||p.revision!==proposal.applicableRevision||!['proposed','edited'].includes(candidate.state)} onClick={()=>void c.perform(async()=>{await c.mutate('proposal.apply',{proposalId:proposal.id,proposalVersion:proposal.version,candidateIds:[candidate.id]});await refresh(proposal.id);})}>{candidate.state==='applied'?'설계에 반영했어요':'이 후보를 설계에 반영'}</button><button disabled={c.busy||!['proposed','edited'].includes(candidate.state)} onClick={()=>void c.perform(async()=>{await c.api.request('proposal.exclude',{designProjectId:p.id,proposalId:proposal.id,proposalVersion:proposal.version,candidateId:candidate.id});await refresh(proposal.id);})}>{candidate.state==='excluded'?'제외한 후보예요':'이 후보는 제외'}</button></div>
    <p>반영한 내용은 “제안” 상태로 저장돼요. 해당 설계 항목에서 읽고 확정할 수 있어요. 편집 중인 초안이 있다면 저장본과 비교해 주세요.</p>
   </section>)}
   <details><summary>문제 확인용 기술 정보</summary><p>요청 설계 r{proposal.baseRevision} · 현재 설계 r{p.revision} · 모델 {proposal.source.model||'실행 전'}</p><pre>{JSON.stringify({state:proposal.state,errorCode:proposal.error?.code,thread:proposal.source.threadId,turn:proposal.source.turnId,targets:proposal.targetVersions,inputHash:proposal.inputHash,createdAt:proposal.createdAt,updatedAt:proposal.updatedAt},null,2)}</pre></details>
  </article>}</details>}
 </section>;
}
function FlowPreview({p,patch}:{p:Project;patch:Data}){
 const name=(id:unknown)=>p.screens.find(s=>s.id===id)?.value||'아직 연결하지 않은 화면';
 const steps=Array.isArray(patch.steps)?patch.steps:[],graph=record(patch.graph)?patch.graph:null;
 const edges=graph&&Array.isArray(graph.transitions)?graph.transitions.filter(record):[];
 return <div className="design-candidate-change"><h4>제안한 이용 순서</h4><p>{steps.map(name).join(' → ')||'기존 순서를 유지해요.'}</p>{edges.map((e,i)=><p key={i}>{name(e.from)} → {name(e.to)} · {({next:'다음으로',branch:'다른 길로',recovery:'실패·취소 후',loop:'다시 반복'} as Record<string,string>)[String(e.kind)]}{e.condition?' · '+String(e.condition):''}{e.preserve?' · 유지: '+String(e.preserve):''}</p>)}</div>;
}
function CandidateGraph({graph:g,screens,set}:{graph:Data;screens:{id:string;label:string}[];set:(g:Data)=>void}){
 const edges=Array.isArray(g.transitions)?g.transitions as Data[]:[];
 return <fieldset><legend>다른 길·실패 후 돌아오기 (본문 반영 전)</legend><Inputs fields={[{key:'entryId',label:'처음 화면',type:'select',options:screens},{key:'terminalIds',label:'완료하는 화면',type:'multi',options:screens},...['branch','recovery'].flatMap(k=>[{key:k+'Policy',label:k==='branch'?'다른 길이 있나요?':'실패 후 돌아갈 길이 있나요?',type:'select' as const,options:[{id:'pending',label:'아직 미정'},{id:'mapped',label:'연결 있음'},{id:'none',label:'해당 없음'}]},{key:k+'Reason',label:'그렇게 정한 이유',type:'area' as const}])]} values={g} set={(k,v)=>set({...g,[k]:v})}/>{edges.map((e,i)=><fieldset key={i}><legend>연결 {i+1}</legend><Inputs fields={[{key:'from',label:'출발 화면',type:'select',options:screens},{key:'to',label:'도착 화면',type:'select',options:screens},{key:'kind',label:'이동하는 경우',type:'select',options:[{id:'next',label:'다음으로'},{id:'branch',label:'조건에 따라'},{id:'recovery',label:'실패·취소 후'},{id:'loop',label:'반복'}]},{key:'condition',label:'이동하는 때',type:'area'},{key:'preserve',label:'유지할 입력·선택',type:'area'}]} values={e} set={(k,v)=>set({...g,transitions:edges.map((edge,n)=>n===i?{...edge,[k]:v}:edge)})}/><button type="button" onClick={()=>set({...g,transitions:edges.filter((_,n)=>n!==i)})}>이 연결 제거</button></fieldset>)}<button type="button" onClick={()=>set({...g,transitions:[...edges,{from:'',to:'',kind:'branch',condition:'',preserve:''}]})}>연결 추가</button></fieldset>;
}
