import {useCallback,useEffect,useState} from 'react';
import type {BridgeSnapshot,ExecutionMode,ReasoningEffort} from '../../../shared/protocol';
import type {PromptSnapshot} from '../../../shared/atelier/types';
import type {DesignGeneration,WorkspaceBinding} from '../../../shared/atelier/execution';
import type {AtelierController} from './useAtelier';
import {data,type Data} from './api';
import {Artifacts} from './Artifacts';

export type ProductionSettings={snapshot:BridgeSnapshot;executionMode:ExecutionMode;skillMode:'auto'|'manual';skillPath?:string;model?:string;effort?:ReasoningEffort;onInterrupt:()=>void};
const names={preparing:'입력 준비',dispatching:'실행 전달 중',running:'실제 실행 중',waitingApproval:'실제 승인 대기',completed:'실행 종료 · 산출물 확인 필요',failed:'실행 실패',interrupted:'중단 · 자동 재실행 없음'};
export function Generation({c,snap,settings}:{c:AtelierController;snap:PromptSnapshot;settings:ProductionSettings}){
  const p=c.project!,[binding,setBinding]=useState<WorkspaceBinding|null>(null),[rows,setRows]=useState<Data[]>([]),[selected,setSelected]=useState<DesignGeneration|null>(null);
  const key='atelier.generation-request.'+p.id;
  const [retry,setRetry]=useState<Data|null>(()=>{try{return JSON.parse(localStorage.getItem(key)||'null') as Data|null;}catch{return null;}}),[starting,setStarting]=useState(false);
  const refresh=useCallback(async(id?:string)=>{
    const b=await c.api.request('binding.get',{designProjectId:p.id});setBinding(b.binding as unknown as WorkspaceBinding|null);
    const items=await c.api.pages('generation.list',{designProjectId:p.id}) as Data[];setRows(items);
    const target=id||String(items[0]?.id||'');if(target){const r=await c.api.request('generation.get',{designProjectId:p.id,generationId:target});setSelected(r.generation as unknown as DesignGeneration);}
  },[c.api,p.id]);
  useEffect(()=>{if(!settings.snapshot.connected)return;void refresh().catch(e=>c.setError(String(e)));return c.api.subscribe(e=>{
    if(e.type!=='atelier.generation.state'||e.designProjectId!==p.id)return;
    const payload=data(e.payload),id=String(payload.generationId);
    setRows(rows=>{const row={...payload,id};return rows.some(r=>r.id===id)?rows.map(r=>r.id===id?{...r,...row}:r):[row,...rows];});
    setSelected(current=>current?.id===id?{...current,state:payload.state as DesignGeneration['state'],version:Number(payload.version),runtime:payload.runtime as DesignGeneration['runtime']}:current);
    if(['completed','failed','interrupted'].includes(String(payload.state)))void refresh(id).catch(err=>c.setError(String(err)));
  });},[refresh,c.api,c.setError,p.id,settings.snapshot.connected]);
  const active=rows.some(r=>['preparing','dispatching','running','waitingApproval'].includes(String(r.state)));
  const bound=!!binding&&binding.workspacePath===settings.snapshot.projectPath&&binding.conversationId===settings.snapshot.activeConversationId;
  const run=(payload:Data)=>c.perform(async()=>{setStarting(true);try{setRetry(payload);localStorage.setItem(key,JSON.stringify(payload));const r=await c.api.request('generation.start',payload);await refresh(String(data(r.generation).id));setRetry(null);localStorage.removeItem(key);}finally{setStarting(false);}});
  return <section aria-label="고정 스냅샷 Codex 제작"><h3>이 고정본으로 Codex 제작</h3>
    <p>workspace: {settings.snapshot.projectPath||'폴더 선택 필요'} · 대화: {settings.snapshot.activeConversationId} · {settings.executionMode==='team'?'Team Auto':'Solo'} · 모델: {settings.model||'현재 App Server 기본 모델'} · 스킬: {settings.skillMode==='auto'?'결정적 자동 선택':settings.skillPath||'기본 에이전트'}</p>
    <p>전달 범위 {snap.selection.mode} · 선택 파일 {snap.referenceFileIds.length}개. 기존 실행 설정을 사용합니다. 제작 대상 범위와 파일 sandbox 권한은 별개이며, workspace 쓰기와 네트워크 기본 차단 정책을 적용합니다. 선택 자료는 Codex 모델 경로로 전달될 수 있습니다.</p>
    <details><summary>전달할 파일 ID·스냅샷 확인</summary><pre>{JSON.stringify({snapshotId:snap.id,revision:snap.revision,selection:snap.selection,fileIds:snap.referenceFileIds},null,2)}</pre></details>
    <div className="design-actions"><button disabled={c.busy||active||!settings.snapshot.projectPath||settings.snapshot.projectTrust!=='trusted'} onClick={()=>void c.perform(async()=>{await c.api.request('binding.set',{designProjectId:p.id,expectedVersion:p.version,conversationId:settings.snapshot.activeConversationId});await refresh();})}>현재 workspace·대화 연결</button>
    <button disabled={c.busy||active||snap.draft||!bound||!settings.snapshot.appServerReady} onClick={()=>void run({designProjectId:p.id,expectedVersion:p.version,snapshotId:snap.id,bindingId:binding!.id,purpose:snap.planId?'revise':'create',executionMode:settings.executionMode,skillMode:settings.skillMode,...(settings.skillMode==='manual'&&settings.skillPath?{skillPath:settings.skillPath}:{}),...(settings.model?{model:settings.model}:{}),...(settings.effort?{effort:settings.effort}:{}),idempotencyKey:crypto.randomUUID()})}>이 고정본으로 실제 제작 시작</button>
    {retry&&<button disabled={c.busy} onClick={()=>void run(retry)}>응답 불명 요청을 같은 키로 확인</button>}
    <button disabled={c.busy} onClick={()=>void c.perform(()=>refresh())}>실행 기록 조회</button>
    {active&&<button onClick={()=>{const row=rows.find(r=>['preparing','dispatching','running','waitingApproval'].includes(String(r.state)));if(row)void c.api.request('generation.interrupt',{designProjectId:p.id,generationId:row.id}).catch(e=>c.setError(String(e)));}}>이 제작 중단</button>}
    {starting&&!active&&<button onClick={settings.onInterrupt}>현재 Codex 실행 준비 중단</button>}</div>
    {!bound&&<p>일반 작업의 프로젝트 선택·신뢰 설정에서 폴더를 준비한 뒤 현재 대화에 연결하세요.</p>}
    {rows.length>0&&<label>제작 기록<select value={selected?.id||''} onChange={e=>void c.perform(()=>refresh(e.target.value))}>{rows.map(r=><option key={String(r.id)} value={String(r.id)}>{String(r.snapshotId)} · {names[r.state as keyof typeof names]}</option>)}</select></label>}
    {selected&&<article><p role="status">{names[selected.state]} · 원본 {selected.snapshotId}{selected.snapshotId!==snap.id?' · 현재 선택한 고정본과 다름':''}</p><p>generation {selected.id} · 대화 {selected.conversationId}</p>{selected.error&&<p role="alert">{selected.error.code}: {selected.error.message}</p>}<details><summary>고정 InputManifest와 실제 runtime ID</summary><pre>{JSON.stringify({input:selected.input,runtime:selected.runtime,messageIds:selected.messageIds},null,2)}</pre></details><p>실행 종료는 파일 생성·검사 통과·디자인 검토 완료를 보장하지 않습니다. 승인·토큰·대화 결과·활동 센터는 기존 전역 화면에서 확인합니다. 입력 staging은 실행 후 보존되며 자동 삭제하지 않습니다.</p></article>}
    {selected&&<Artifacts key={selected.id} c={c} generationId={selected.id} active={c.tab==='prompt'}/>}
  </section>;
}
