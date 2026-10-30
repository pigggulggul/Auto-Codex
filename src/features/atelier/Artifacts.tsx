import {useCallback,useEffect,useRef,useState} from 'react';
import type {ArtifactManifest} from '../../../shared/atelier/artifacts';
import type {AtelierController} from './useAtelier';
import {data,type Download} from './api';

const artifactNames={pending:'수집 대기',verified:'실제 파일 확인',partial:'부분 결과',missing:'기록된 파일 누락',unverifiable:'확인 불가'};
const checkNames={notRun:'관측된 검사 없음',passed:'관측된 검사 통과',failed:'검사 실패',unverifiable:'현재 파일과의 연결 확인 불가'};
export function Artifacts({c,generationId,active}:{c:AtelierController;generationId:string;active:boolean}){
  const p=c.project!,[manifest,setManifest]=useState<ArtifactManifest|null>(null),[state,setState]=useState(''),[loaded,setLoaded]=useState(false);
  const [preview,setPreview]=useState<{name:string;text?:string;image?:string;truncated:boolean}|null>(null),url=useRef('');
  const refresh=useCallback(async()=>{const result=await c.api.request('artifact.get',{designProjectId:p.id,generationId});setManifest(result.manifest as unknown as ArtifactManifest|null);setState(String(result.executionState));setLoaded(true);},[c.api,p.id,generationId]);
  useEffect(()=>{if(!active)return;let alive=true;void refresh().catch(e=>{if(alive)c.setError(String(e));});const unsubscribe=c.api.subscribe(e=>{if(e.type==='atelier.artifact.state'&&e.designProjectId===p.id&&data(e.payload).generationId===generationId)void refresh().catch(err=>{if(alive)c.setError(String(err));});});return()=>{alive=false;unsubscribe();};},[active,refresh,c.api,c.setError,p.id,generationId]);
  useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current);},[]);
  const open=(artifactId:string,download=false)=>c.perform(async()=>{
    const result=await c.api.request('artifact.read',{designProjectId:p.id,generationId,artifactId,view:download?'download':'preview'}),descriptor=data(result.download) as unknown as Download;
    if(download){await c.api.save(descriptor,'application/octet-stream');return;}
    const file=data(result.file),bytes=await c.api.bytes(descriptor,file.kind==='image'?15*1024*1024:256*1024);
    if(url.current){URL.revokeObjectURL(url.current);url.current='';}
    if(file.kind==='image'&&['image/png','image/jpeg','image/webp'].includes(String(result.mime))){url.current=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:String(result.mime)}));setPreview({name:String(file.relativePath),image:url.current,truncated:false});}
    else setPreview({name:String(file.relativePath),text:new TextDecoder().decode(bytes),truncated:result.truncated===true});
  });
  const resultId=manifest?.resultId,reviews=p.reviews.filter(r=>r.resultId===resultId);
  return <section className="artifact-panel" aria-label="실제 파일과 실행 근거"><h3>실제 파일과 실행 근거</h3>
    <div className="design-fields" role="status"><p>실행: {state==='completed'?'실행 종료':state==='failed'?'실패':state==='interrupted'?'중단':state||'조회 중'}</p><p>산출물: {manifest?artifactNames[manifest.status]:loaded?'기록 없음':'조회 중'}</p><p>검사: {manifest?checkNames[manifest.checkStatus]:'미확인'}</p><p>사용자 검토: 시각 {reviews.some(r=>r.scope==='visual'&&r.state==='completed'&&!r.recheck)?'완료':'미완료'} · 동작 {reviews.some(r=>r.scope==='behavior'&&r.state==='completed'&&!r.recheck)?'완료':'미완료'}</p></div>
    {!manifest&&loaded&&<p>이전 실행에는 자동 산출물 수집 기록이 없습니다. 모델의 본문이나 현재 파일을 과거 실행의 결과로 임의 연결하지 않습니다.</p>}
    {manifest&&<><p>원본 스냅샷 {manifest.snapshotId} · 수집 {manifest.phase} · {manifest.capturedAt||'종료 후 수집 예정'}</p>
    <div className="design-actions"><button disabled={c.busy} onClick={()=>void c.perform(refresh)}>산출물 기록 조회</button>{manifest.resultId?<button disabled={c.busy} onClick={()=>void c.reload().then(()=>c.navigate('review'))}>연결 결과를 불러와 검토</button>:manifest.phase==='ready'&&(manifest.files.length>0||!!manifest.deleted?.length||manifest.commands.some(command=>command.status!=='inProgress'))?<button disabled={c.busy} onClick={()=>void c.action('artifact.attach',{generationId}).then(()=>refresh())}>보관한 근거로 결과 연결 재시도</button>:null}</div>
    <p>파일 확인·검사 종료 코드·사용자 판정은 별개입니다. 검사는 관측된 명령에 한정됩니다. AI/외부 의견은 검토 편집의 별도 의견란에 기록합니다.</p>
    <ul>{manifest.limitations.map(text=><li key={text}>{text}</li>)}</ul>
    <h4>확인한 파일 {manifest.files.length}개</h4>{manifest.deleted?.length?<p>실제 부재를 확인한 삭제 경로: {manifest.deleted.join(', ')}</p>:null}{manifest.files.map(file=><article className="design-entity" key={file.id}><strong>{file.relativePath}</strong><p>{file.kind==='image'?'실제 이미지':file.kind==='code'?'텍스트·코드':'바이너리'} · {file.size.toLocaleString()} bytes · 런타임 보고 {file.reportedChange}</p><p className="design-prewrap">SHA-256 {file.hash}</p><div className="design-actions">{file.kind!=='binary'&&<button disabled={c.busy} onClick={()=>void open(file.id)}>{file.kind==='image'?'보관 이미지 보기':'코드를 텍스트로 보기'}</button>}<button disabled={c.busy} onClick={()=>void open(file.id,true)}>보관 파일 내려받기</button></div></article>)}
    {preview&&<section><h4>{preview.name}</h4>{preview.image?<img className="design-local-image" src={preview.image} alt={'실제 보관 이미지 '+preview.name}/>:<pre className="design-prompt-text">{preview.text||'(빈 파일)'}</pre>}{preview.truncated&&<p>미리보기는 처음 256KiB입니다. 전체 파일은 별도로 내려받을 수 있습니다.</p>}<p>HTML·SVG·스크립트는 실행하지 않습니다. 이미지 보기만으로 동작 검토가 완료되지 않습니다.</p></section>}
    <details><summary>실제 명령 기록 {manifest.commands.length}개</summary>{manifest.commands.map(command=><article key={command.threadId+command.turnId+command.itemId}><p>{command.label} · 상태 {command.status} · 종료 코드 {command.exitCode??'미관측'}{command.checkKind?' · 검사 '+command.checkKind:''}</p><p>thread {command.threadId} / turn {command.turnId} / item {command.itemId}</p><p>산출물 해시 연결: {command.bindingValid?'수집 시점 기록 있음':'미확인'} · 원문·출력은 보관하지 않음</p></article>)}</details></>}
  </section>;
}
