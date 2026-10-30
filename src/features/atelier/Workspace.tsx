import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Entry,Project,Tab} from '../../../shared/atelier/types';
import {createDomain} from '../../../shared/atelier/domain';
import {ENTRIES,QUESTIONS,TABS,TYPES,EXAMPLES} from '../../../shared/atelier/guide';
import type {AtelierApi,Data} from './api';
import {useAtelier,type AtelierController} from './useAtelier';
import {DraftForm,Inputs,type Field} from './Forms';
import {EntityList,initialFields,options} from './Editors';
import {References,FileAttachment} from './Resources';
import {Reviews} from './Review';
import {Proposals} from './Proposals';
import {Generation,type ProductionSettings} from './Generation';
import {TAB_GUIDANCE,TAB_LABELS} from './guidance';
import {canStartBlueprint} from './Blueprint';
import './workspace.css';

const domain=createDomain({id:()=>{throw new Error('브라우저는 저장 ID를 생성하지 않습니다.');},now:()=>''});
type Props={production?:ProductionSettings;aiReady?:boolean;model?:string;effort?:string;onInterrupt?:()=>void;api:AtelierApi;connected:boolean;hidden?:boolean;entryRequest?:{entry:Entry;nonce:number}|null;tabRequest?:{tab:Tab;nonce:number}|null;onTab?:(tab:Tab)=>void};
export function AtelierWorkspace({api,connected,hidden,entryRequest,tabRequest,onTab,aiReady=false,model,effort,onInterrupt,production}:Props){
 const c=useAtelier(api,connected),dialog=useRef<HTMLDialogElement>(null),[entry,setEntry]=useState<Entry>('idea'),[creating,setCreating]=useState(false),[deleteName,setDeleteName]=useState('');
 const lastEntry=useRef(0),lastTab=useRef(0);
 useEffect(()=>{if(entryRequest&&entryRequest.nonce!==lastEntry.current){lastEntry.current=entryRequest.nonce;setEntry(entryRequest.entry);setCreating(true);}},[entryRequest]);
 useEffect(()=>{if(tabRequest&&tabRequest.nonce!==lastTab.current){lastTab.current=tabRequest.nonce;c.navigate(tabRequest.tab);}},[tabRequest,c.navigate]);
 useEffect(()=>{onTab?.(c.tab);},[c.tab,onTab]);
 useEffect(()=>{const d=dialog.current;if(!d)return;if(creating&&!hidden&&!d.open)d.showModal();if((!creating||hidden)&&d.open)d.close();},[creating,hidden]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{try{if(Object.keys(localStorage).some(k=>k.startsWith('auto-codex.atelier.draft.'))){event.preventDefault();event.returnValue='';}}catch{/* Storage may be unavailable. */}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 useLayoutEffect(()=>{
  if(hidden||!c.project)return;const key='atelier.scroll.'+c.project.id+':'+c.tab;
  try{window.scrollTo({top:Number(localStorage.getItem(key)||0),behavior:'instant'});}catch{/* Position remains usable without browser storage. */}
  const save=()=>{try{localStorage.setItem(key,String(window.scrollY));}catch{/* Keep current position in the open tab. */}};
  window.addEventListener('scroll',save,{passive:true});return()=>window.removeEventListener('scroll',save);
 },[hidden,c.project?.id,c.tab]);
 const start=(next:Entry)=>{setEntry(next);setCreating(true);};
 return <section className="design-workspace" hidden={hidden} aria-label="Atelier 수동 디자인 작업실">
  <div className="design-toolbar"><div><h2>{c.project?.name||'나의 설계 작업실'}</h2><p>아이디어를 저장하고, 설계를 다듬고, 만든 결과를 확인해요.</p></div><label>설계 프로젝트<select value={c.project?.id||''} disabled={c.busy||!c.capabilities} onChange={e=>{if(e.target.value)void c.select(e.target.value);}}><option value="">프로젝트 선택</option>{c.projects.map(p=><option value={String(p.id)} key={String(p.id)}>{String(p.name)}</option>)}</select></label><button disabled={c.busy||!c.capabilities} onClick={()=>start('idea')}>새 설계</button><button disabled={c.busy||!connected} onClick={()=>void c.reload()}>최신본 확인·목록 새로고침</button></div>
  {!c.capabilities&&<p role="status">{connected?'설계 저장소의 지원 여부를 확인하고 있습니다.':'브리지 연결이 끊겼습니다. 편집 입력은 유지되며 저장은 재연결 후 가능합니다.'}</p>}
  {c.error&&<div className="design-error" role="alert"><strong>요청을 완료하지 못했어요.</strong><p>{c.error}</p><p>작성 중인 입력은 유지했어요. 저장 중 연결이 끊겼다면 최신본을 확인한 뒤 다시 시도해 주세요.</p><button onClick={()=>void c.reload()} disabled={c.busy||!connected}>초안을 유지하고 최신본 확인</button></div>}
  {c.remoteVersion>0&&<div className="design-conflict" role="alert">다른 창에서 새 버전 v{c.remoteVersion}을 저장했습니다. 현재 초안은 유지됩니다. <button disabled={c.busy} onClick={()=>void c.reload()}>최신본 불러와 비교</button></div>}
  <p className="design-status" role="status">{c.busy?'실제 저장소 요청 처리 중…':c.project?`서버 저장본 v${c.project.version} · 설계 r${c.project.revision}`:'프로젝트를 만들거나 백업을 가져오세요.'}</p>
  <p hidden={aiReady} className="design-ai-state">AI 설계 제안은 아직 연결되지 않았습니다. 내장 예시·수동 프롬프트 작성과 실제 AI 요청은 다릅니다.</p>
  {!c.project&&<><div className="design-callout"><h2>아이디어 한 문장이면 시작할 수 있어요</h2><p>아이디어 적기 → AI와 함께 정리하기 → 마음에 드는 내용 반영하기. 색·화면·자료는 그다음에 하나씩 정해요.</p></div><div className="design-entry-grid">{ENTRIES.map(([id,title,description])=><button key={id} disabled={c.busy||!c.capabilities} onClick={()=>start(id)}><strong>{title}</strong><span>{description}</span></button>)}</div></>}
  <details className="design-backup"><summary>{c.project?'백업 파일 저장·가져오기 (선택)':'이전에 저장한 백업 가져오기 (선택)'}</summary><p>평소 작업은 이 PC의 작업실에 저장돼요. 백업은 설계와 첨부를 별도의 .atelier.json 파일로 내보내는 복사본이에요. 다른 PC로 옮기거나 새 프로젝트로 다시 가져올 때 사용해요. 편집 중인 초안은 먼저 저장하세요.</p><label className="design-import">이전에 저장한 설계 백업 가져오기<input type="file" accept="application/json,.json" disabled={c.busy||!c.capabilities} onChange={e=>{const file=e.target.files?.[0];if(file)void c.restore(file);e.target.value='';}}/></label>{c.project&&<><button disabled={c.busy||c.project.results.some(r=>r.generationId)} onClick={()=>void c.exportFile('backup.export',{format:'atelier-backup'})}>설계 백업 파일 준비</button><p>준비 후 나타나는 “내 PC에 저장”을 눌러 파일을 받으세요. 원본 프로젝트는 그대로 남아요.</p><p>이 파일에는 AI 제안·제작 연결 기록이 포함되지 않아요. 자동 제작 결과가 있는 프로젝트는 이 형식으로 내보낼 수 없어요.</p><details><summary>제작 기록까지 보관하려면</summary><p>앱의 로컬 브리지를 종료한 뒤 .local-data/atelier 폴더 전체, 대화 기록 .local-data/history.json, 실제 제작 폴더를 함께 복사해 보관해야 해요. 이 백업 버튼은 전체 보관 기능이 아니에요.</p></details></>}</details>
  {c.prepared&&<div className="design-download" role="status"><strong>파일 준비 완료 · 아직 내 PC에 저장하기 전이에요</strong><p>{c.prepared.descriptor.name} · {c.prepared.descriptor.totalBytes.toLocaleString()} bytes</p><button disabled={c.busy} onClick={()=>void c.savePrepared()}>내 PC에 저장</button><button disabled={c.busy} onClick={()=>void c.discardPrepared()}>준비한 파일 닫기</button><p>준비한 파일은 1분간 사용하지 않으면 만료돼요. 만료되면 다시 준비하세요.</p></div>}
  {c.project&&<>
   <div className="design-actions"><span>입력 항목 표시</span><button disabled={c.busy} aria-pressed={c.project.settings.density==='guide'} onClick={()=>void c.action('project.update',{patch:{settings:{density:'guide'}}})}>차근차근 (추천)</button><button disabled={c.busy} aria-pressed={c.project.settings.density==='quick'} onClick={()=>void c.action('project.update',{patch:{settings:{density:'quick'}}})}>전체 항목</button></div>
   <p>차근차근은 기본 질문부터, 전체 항목은 세부 설정까지 펼쳐 보여 줘요. 보기만 달라지며 작성한 내용은 그대로예요.</p>
   <nav className="design-tabs" aria-label="설계의 여덟 작업 탭">{TABS.map(([id])=><button key={id} aria-current={c.tab===id?'page':undefined} onClick={()=>c.navigate(id)}>{TAB_LABELS[id]}</button>)}</nav>
   <section className="design-step-intro" aria-label="현재 단계 안내"><span>{TABS.find(t=>t[0]===c.tab)?.[3]} / 08 · 필요한 단계부터 이동해도 돼요</span><h2>{TAB_GUIDANCE[c.tab].title}</h2><p>{TAB_GUIDANCE[c.tab].description}</p><p className="design-example">{TAB_GUIDANCE[c.tab].example}</p><a href="#atelier-proposals">막막하다면 AI와 함께 정리하기 ↓</a></section>
   {c.tab==='design'&&canStartBlueprint(c.project)?[<Proposals key={c.project.id+':proposals'} c={c} ready={aiReady} model={model} effort={effort} onInterrupt={onInterrupt}/>,<DesignBody key={c.project.id} c={c} production={production}/>]:[<DesignBody key={c.project.id} c={c} production={production}/>,<Proposals key={c.project.id+':proposals'} c={c} ready={aiReady} model={model} effort={effort} onInterrupt={onInterrupt}/>]}
   <div className="design-next"><p>아직 모르는 내용은 나중에 채워도 돼요. 제작 전에는 설계 요약에서 필요한 결정을 확인해요.</p><button disabled={c.busy} onClick={()=>c.navigate(TAB_GUIDANCE[c.tab].next)}>{TAB_GUIDANCE[c.tab].action}</button></div>
   <details className="design-project-settings"><summary>설계 프로젝트 삭제</summary><label>삭제할 설계 이름을 직접 입력 (원본 코드·대화는 삭제 안 함)<input value={deleteName} onChange={e=>setDeleteName(e.target.value)}/></label><button disabled={c.busy||deleteName!==c.project.name} onClick={()=>{if(window.confirm('이 설계 프로젝트와 저장소의 첨부를 삭제합니다. 필요한 설계와 첨부를 보관했는지 확인하세요.'))void c.deleteProject(c.project!.id);}}>이 설계 프로젝트 삭제</button></details>
  </>}
  <dialog ref={dialog} className="design-create-dialog" onCancel={()=>setCreating(false)} onClose={()=>setCreating(false)}>
   {creating&&<CreateForm key={entry} entry={entry} busy={c.busy} error={c.error} onCreate={async(name,idea,type)=>{const id=await c.create(name,idea,entry,type);if(id){localStorage.removeItem('auto-codex.atelier.new.'+entry);setCreating(false);}}} onCancel={()=>setCreating(false)}/ >}
  </dialog>
 </section>;
}
function CreateForm({entry,busy,error,onCreate,onCancel}:{entry:Entry;busy:boolean;error:string;onCreate:(name:string,idea:string,type:Project['type'])=>Promise<void>;onCancel:()=>void}){
 const key='auto-codex.atelier.new.'+entry;const [cached]=useState<Data>(()=>{try{return JSON.parse(localStorage.getItem(key)||'{}') as Data;}catch{return {};}});
 const [name,setName]=useState(String(cached.name||'')),[idea,setIdea]=useState(String(cached.idea||'')),[type,setType]=useState<Project['type']>((cached.type||'아직 미정') as Project['type']);
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify({name,idea,type}));}catch{/* Current form remains editable. */}},[key,name,idea,type]);
 return <form onSubmit={e=>{e.preventDefault();if(name.trim())void onCreate(name,idea,type);}}><h2>{ENTRIES.find(e=>e[0]===entry)?.[1]} · 새 프로젝트</h2><p>한 문장으로 시작해도 괜찮아요. 만든 뒤 AI에게 정리를 부탁하거나 직접 다듬을 수 있어요.</p>{error&&<p role="alert">{error} · 입력은 유지했습니다.</p>}<label>프로젝트 이름<input autoFocus placeholder="예: 나만의 여행 일정" maxLength={120} required value={name} onChange={e=>setName(e.target.value)}/></label><label>어떤 것을 만들고 싶나요?<textarea placeholder="예: 혼자 여행하는 사람이 장소를 모아 하루 일정을 쉽게 만드는 앱" value={idea} onChange={e=>setIdea(e.target.value)}/><small>처음 적은 생각을 보관해요. 모르는 내용은 나중에 채워도 돼요.</small></label><label>가까운 종류 (모르면 미정)<select value={type} onChange={e=>setType(e.target.value as Project['type'])}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label><p>여기서는 아이디어를 저장해요. AI 제안은 다음 화면에서 직접 요청할 수 있어요.</p><div className="design-actions"><button disabled={busy||!name.trim()} className="atelier-primary">{busy?'아이디어 저장 중…':'이 아이디어로 시작하기'}</button><button type="button" onClick={onCancel}>닫기 (초안 유지)</button></div></form>;
}
function ProjectForm({c}:{c:AtelierController}){
 const p=c.project!,fields:Field[]=[{key:'name',label:'설계 이름'},{key:'idea',label:'입력 원문',type:'area'},{key:'type',label:'제품 유형',type:'select',options:[...TYPES,...(p.type==='기타'?['기타']:[])].map(id=>({id,label:id}))}];
 return <DraftForm key={p.id} draftKey={p.id+':project'} title="프로젝트 정보" initial={initialFields(p,fields)} disabled={c.busy} onSave={patch=>c.commit('project.update',{patch})}>{(v,set)=><Inputs fields={fields} values={v} set={set}/>}</DraftForm>;
}
function DesignBody({c,production}:{c:AtelierController;production?:ProductionSettings}){
 const p=c.project!;return <div className="design-editors">
  <div hidden={c.tab!=='design'}><details open={p.settings.density==='quick'}><summary>직접 답변을 정리하거나 고치기 (선택)</summary><details><summary>처음 적은 아이디어·프로젝트 정보 보기</summary><ProjectForm c={c}/></details><Questions c={c}/></details><details open={p.settings.density==='quick'}><summary>필요한 기능과 보여 줄 내용 정리하기 (나중에 해도 돼요)</summary><EntityList c={c} kind="features"/><EntityList c={c} kind="contents" extra={node=><FileAttachment c={c} kind="contents" node={node}/>}/></details></div>
  <div hidden={c.tab!=='flow'}><p>먼저 화면·상태를 추가하고 흐름에 연결하세요. 분기와 복구는 메모뿐 아니라 실제 연결을 확인합니다.</p><EntityList c={c} kind="screens"/><EntityList c={c} kind="flows"/></div>
  <div hidden={c.tab!=='reference'}><References c={c}/></div>
  <div hidden={c.tab!=='concept'}><p>직접 작성한 하나의 컨셉으로 진행할 수 있습니다. 내장 팔레트는 사용자가 고르는 예시이며 AI 응답이 아닙니다.</p><EntityList c={c} kind="concepts"/></div>
  <div hidden={c.tab!=='style'}><EntityList c={c} kind="styles"/><EntityList c={c} kind="assets" extra={node=><FileAttachment c={c} kind="assets" node={node}/>}/></div>
  <div hidden={c.tab!=='brief'}><Brief c={c}/></div>
  <div hidden={c.tab!=='prompt'}><Prompt c={c} production={production}/></div>
  <div hidden={c.tab!=='review'}><Reviews c={c}/></div>
 </div>;
}
function Questions({c}:{c:AtelierController}){
 const p=c.project!,[group,setGroup]=useState(()=>{try{return Number(localStorage.getItem('auto-codex.atelier.group.'+p.id)??p.progress.guideStage)||0;}catch{return 0;}});
 return <section><h2>먼저 세 가지만 생각해 보세요</h2><p>짧게 써도 괜찮아요. 모르는 질문은 비워 두고 아래 AI 제안에서 도움을 받을 수 있어요. AI는 저장한 아이디어와 답변을 함께 참고해요.</p>{p.settings.density==='guide'&&<div className="design-actions">{['1. 아이디어의 기본','2. 누구에게 어떤 도움?','3. 어디서 어디까지?','4. 느낌과 완성 기준'].map((name,i)=><button key={name} aria-pressed={group===i} onClick={()=>{setGroup(i);localStorage.setItem('auto-codex.atelier.group.'+p.id,String(i));}}>{name}</button>)}</div>}
  {QUESTIONS.map(q=>{const d=p.fields[q.key],example=EXAMPLES[p.type][q.key];return <article key={p.id+q.key} hidden={p.settings.density==='guide'&&group!==q.group} className="design-question"><DraftForm draftKey={p.id+':question:'+q.key} title={q.label+(q.optional?' (선택)':'')} initial={{value:d.value,reason:d.reason}} disabled={c.busy} onSave={value=>c.commit('entity.mutate',{kind:'fields',action:'patch',entityId:q.key,value})}>{(v,set)=><><Inputs fields={[{key:'value',label:'나의 답변',type:'area',help:q.why,placeholder:'예: '+example}]} values={v} set={set}/><details><summary>참고 예시와 이유 적기 (선택)</summary><p>예: {example}</p><p>내 아이디어와 맞는 부분만 참고하세요. 예시는 자동으로 입력되지 않아요.</p><Inputs fields={[{key:'reason',label:'이렇게 생각한 이유·아직 확인할 점',type:'area'}]} values={v} set={set}/></details></>}</DraftForm><details><summary>{d.status==='confirmed'?'내가 확인한 답변':'답변 확인·확정하기'}{d.reviewNeeded?' · 다시 확인 필요':''}</summary><p>저장은 작성 내용을 보관하는 것, 확정은 제작 기준으로 써도 좋다고 직접 확인하는 것이에요. 지금 바로 확정할 필요는 없어요.</p><div className="design-actions"><button disabled={c.busy||!d.value.trim()} onClick={()=>void c.action('entity.mutate',{kind:'fields',action:'confirm',entityId:q.key})}>저장한 답변을 제작 기준으로 확정</button><button disabled={c.busy} onClick={()=>void c.action('entity.mutate',{kind:'fields',action:'exclude',entityId:q.key})}>이 질문은 제외</button></div></details></article>;})}
  {p.settings.density==='guide'&&<p>이 질문들이 정리되면 위의 다음 질문 묶음이나 아래 AI 제안으로 이동하세요. 네 묶음을 모두 채워야 이동할 수 있는 것은 아니에요.</p>}
 </section>;
}
function Brief({c}:{c:AtelierController}){
 const p=c.project!,issues=domain.issues(p),[reason,setReason]=useState('');
 return <section><h2>현재 저장본의 디자인 브리프</h2><p>현재 기준 r{p.revision}. 입력이 의도와 맞는지 직접 읽고 확인하세요. 문장 의미나 미관을 자동 판정하지 않습니다.</p><dl>{QUESTIONS.map(q=><div key={q.key}><dt>{q.label}</dt><dd>{p.fields[q.key].value||'아직 미정'}</dd></div>)}</dl><h3>누락·연결·재검토 조건</h3>{issues.length?<ul>{issues.map((issue,i)=><li key={i}><button className="design-issue" onClick={()=>c.navigate(issue.tab)}>{issue.message}</button></li>)}</ul>:<p>구조상 필수 조건을 충족했습니다. 사용자 의도 확인과 실제 결과 검토는 별도입니다.</p>}
 <details open={p.intent?.revision!==p.revision||p.intent?.choice!=='match'}><summary>내 의도와 맞는지 확인·갱신하기</summary><label>요약을 직접 읽고 확인한 이유<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={c.busy||!reason.trim()} onClick={()=>void c.action('intent.confirm',{revision:p.revision,choice:'match',reason})}>이 revision이 내 의도와 맞음을 확인</button><p>{p.intent?.revision===p.revision&&p.intent.choice==='match'?'현재 revision의 사용자 의도 확인 기록이 있습니다.':'현재 revision의 의도 확인이 필요합니다.'}</p></details><button className="atelier-primary" disabled={c.busy||!domain.ready(p)} onClick={()=>void c.action('snapshot.create',{mode:'final'}).then(next=>{if(next)c.navigate('prompt');})}>이 설계를 제작 기준으로 고정하고 다음으로</button><p>확정한 현재 설계를 고정본으로 보관해요. 아직 제작은 실행하지 않아요.</p></section>;
}
function Prompt({c,production}:{c:AtelierController;production?:ProductionSettings}){
 const p=c.project!,[selected,setSelected]=useState(()=>localStorage.getItem('auto-codex.atelier.snapshot.'+p.id)||''),[baseline,setBaseline]=useState('');
 const snap=p.snapshots.find(s=>s.id===selected)||p.snapshots.at(-1);
 const fields:Field[]=[{key:'purpose',label:'출력 목적'},{key:'format',label:'산출 형식'},{key:'scope',label:'범위 설명'},{key:'tech',label:'기술 환경'},{key:'language',label:'언어'},{key:'common',label:'공통 기준',type:'area'},{key:'procedure',label:'작업 절차',type:'area'},{key:'procedureSource',label:'절차 출처'},{key:'extra',label:'사용자 추가 지시 (원문)',type:'area'}];
 return <section><h2>선택 범위와 고정 프롬프트</h2><DraftForm draftKey={p.id+':output'} title="출력 설정" initial={{...initialFields(p.output,fields),selection:p.output.selection}} disabled={c.busy} onSave={output=>c.commit('project.update',{patch:{output}})}>{(v,set)=>{
  const selection=v.selection as {mode:'all'|'flows'|'screens'|'assets';ids:string[]};
  return <><Inputs fields={fields.slice(0,3)} values={v} set={set}/><details open={p.settings.density==='quick'}><summary>제작 환경·추가 요청 정하기 (선택)</summary><p>정해 둔 환경이 없다면 기본 내용을 그대로 두세요.</p><Inputs fields={fields.slice(3)} values={v} set={set}/></details><label>실제 제작 대상<select value={selection.mode} onChange={e=>set('selection',{mode:e.target.value,ids:[]})}><option value="all">서비스 전체</option><option value="flows">선택한 이용 순서</option><option value="screens">선택한 화면</option><option value="assets">선택한 사진·아이콘 등 자료</option></select></label>{selection.mode!=='all'&&<Inputs fields={[{key:'ids',label:'이번에 만들 대상',type:'multi',options:options(p[selection.mode]),help:'체크한 대상만 이번 제작에 포함해요. 연결된 기준 자료는 참고용으로 함께 전달될 수 있어요.'}]} values={{ids:selection.ids}} set={(_key,ids)=>set('selection',{...selection,ids})}/>}<p>지원 서체·확정 근거는 필요할 때 포함되지만 근거의 원래 화면을 제작 대상으로 추가하지 않습니다.</p></>;
 }}</DraftForm>
 <div className="design-actions"><button disabled={c.busy||!domain.ready(p)} onClick={()=>void c.action('snapshot.create',{mode:'final'})}>확정 입력으로 프롬프트 고정</button><button onClick={()=>c.navigate('brief')}>브리프·의도 확인으로 이동</button></div><label>진단용 초안으로 고정할 이유<input value={baseline} onChange={e=>setBaseline(e.target.value)}/></label><button disabled={c.busy||!baseline.trim()} onClick={()=>void c.action('snapshot.create',{mode:'baseline',reason:baseline})}>진단 기준 고정 (확정 제작 아님)</button>
 {snap?<><label>저장된 고정 버전<select value={snap.id} onChange={e=>{setSelected(e.target.value);localStorage.setItem('auto-codex.atelier.snapshot.'+p.id,e.target.value);}}>{p.snapshots.map(s=><option key={s.id} value={s.id}>v{s.number} · r{s.revision} · {s.planId?'수정 프롬프트':s.draft?'진단 초안':'확정 프롬프트'}</option>)}</select></label><p>현재 편집 r{p.revision} / 이 버전의 입력 r{snap.revision}. 이 고정본은 최신 편집 내용으로 교체되지 않습니다.</p><pre className="design-prompt-text">{snap.text}</pre><div className="design-actions"><button onClick={()=>void c.perform(()=>navigator.clipboard.writeText(snap.text))}>이 고정본 복사</button><button disabled={c.busy} onClick={()=>void c.exportFile('snapshot.read',{snapshotId:snap.id})}>고정 JSON 준비</button><button disabled={c.busy} onClick={()=>void c.exportFile('bundle.export',{snapshotId:snap.id})}>실제 선택 파일 ZIP 준비</button><button disabled={c.busy} onClick={()=>void c.action('handoff.mark',{snapshotId:snap.id})}>이 버전을 외부 도구에 직접 전달했다고 기록</button></div><p>첨부 {snap.referenceFileIds.length}개 · 결정 추적 {snap.decisions.length}개. 프롬프트 생성과 수동 전달 기록은 외부 제작 완료가 아닙니다.</p><details><summary>결정·섹션·범위 근거</summary>{snap.sections.map(section=><p key={section.id}>{section.title} · {section.decisionIds.join(', ')||'공통 기준'}</p>)}</details></>:<p>고정한 프롬프트가 없습니다. 구조 조건과 사용자 의도를 확인하거나 이유를 적어 진단 기준을 만드세요.</p>}
 {snap&&production&&<Generation key={p.id+':generation'} c={c} snap={snap} settings={production}/>}
 </section>;
}
