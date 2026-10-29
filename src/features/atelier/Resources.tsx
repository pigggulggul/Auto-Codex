import {useEffect,useRef,useState} from 'react';
import type {Decision,Reference,Rect} from '../../../shared/atelier/types';
import {DraftForm,Inputs} from './Forms';
import {EntityEditor,initialFields,type Kind} from './Editors';
import {data,type Data,type Download} from './api';
import type {AtelierController} from './useAtelier';

export function LocalImage({c,fileId,alt,onLoad,active=true}:{c:AtelierController;fileId:string|null|undefined;alt:string;onLoad?:(image:HTMLImageElement)=>void;active?:boolean}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let alive=true,objectUrl='';setError('');setUrl('');if(!active||!fileId||!c.project)return;void c.api.file(c.project.id,fileId).then(({info,bytes})=>{if(!['image/png','image/jpeg','image/webp'].includes(info.mime))throw new Error('원본·크롭·결과는 PNG/JPEG/WebP만 표시합니다.');if(!alive)return;objectUrl=URL.createObjectURL(new Blob([bytes],{type:info.mime}));setUrl(objectUrl);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'파일 읽기 실패');});return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[c.api,c.project?.id,fileId,active]);
 if(!fileId)return <p>실제 이미지 파일이 없습니다.</p>;
 return <>{error?<p role="alert">{error}</p>:url?<img className="design-local-image" src={url} alt={alt} onLoad={e=>onLoad?.(e.currentTarget)}/>:<p role="status">실제 이미지 읽는 중…</p>}</>;
}
export function FileAttachment({c,kind,node}:{c:AtelierController;kind:'assets'|'contents';node:Decision}){
 const [existing,setExisting]=useState(''),[queued,setQueued]=useState<File|null>(null);
 const bind=(fileId:string)=>c.mutate('entity.mutate',{kind,action:'patch',entityId:node.id,value:{fileId,availability:'보유'}});
 return <div className="design-file-attachment"><p>현재 파일: {c.files.find(f=>f.id===node.fileId)?.name||node.fileId||'미확보'}</p>
  <label>로컬 파일 등록<input type="file" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];if(file){setQueued(file);void c.perform(async()=>{const f=await c.upload(file,file.name,kind==='assets'?'asset':'content');await bind(f.id);setQueued(null);});}e.target.value='';}}/></label>{queued&&<button disabled={c.busy} onClick={()=>void c.perform(async()=>{const f=await c.upload(queued,queued.name,kind==='assets'?'asset':'content');await bind(f.id);setQueued(null);})}>등록·연결 다시 시도: {queued.name}</button>}
  <label>이 프로젝트에 등록된 파일<select value={existing} onChange={e=>setExisting(e.target.value)}><option value="">파일 선택</option>{c.files.map(f=><option key={f.id} value={f.id}>{f.name}{f.exists===false?' · 실파일 확인 필요':''}</option>)}</select></label><button disabled={!existing||c.busy} onClick={()=>void c.perform(()=>bind(existing))}>선택 파일 연결</button>
  {node.fileId&&<button disabled={c.busy} onClick={()=>void c.perform(async()=>{const r=await c.api.request('file.read',{designProjectId:c.project!.id,fileId:node.fileId});await c.api.save(data(r.download) as unknown as Download,'application/octet-stream');})}>실제 파일 내려받기</button>}
  {node.fileId&&c.files.find(f=>f.id===node.fileId)?.mime.startsWith('font/')&&<FontPreview c={c} fileId={node.fileId}/>}
 </div>;
}
function FontPreview({c,fileId}:{c:AtelierController;fileId:string}){
 const [family,setFamily]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true,face:FontFace|undefined;if(c.tab!=='style')return;void c.api.file(c.project!.id,fileId).then(async({info,bytes})=>{if(!info.mime.startsWith('font/'))throw new Error('서체 파일이 아닙니다.');face=new FontFace('Atelier_'+fileId.replaceAll('-','_'),bytes.buffer);await face.load();if(active){document.fonts.add(face);setFamily(face.family);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'서체 읽기 실패');});return()=>{active=false;if(face)document.fonts.delete(face);};},[c.api,c.project?.id,fileId,c.tab]);
 return <div className="design-font-preview">{error?<p role="alert">{error}</p>:<p style={family?{fontFamily:`"${family}", sans-serif`}:undefined}>{family?'이 영역은 실제 등록 서체입니다. 가나다 ABC 123':'실제 서체 로드 중…'}</p>}</div>;
}
export function References({c}:{c:AtelierController}){
 const p=c.project!,[queued,setQueued]=useState<File|null>(null);
 const register=(file:File)=>c.perform(async()=>{const f=await c.upload(file,file.name,'reference');await c.mutate('entity.mutate',{kind:'references',action:'add',value:{name:f.name,fileId:f.id,url:'',note:'',role:'참고'}});setQueued(null);});
 return <section><h2>원본에서 관찰하고 적용하기</h2><p>URL이나 이름을 이미지 분석 결과로 취급하지 않습니다. 원본을 등록하고 관찰·해석·적용 이유를 직접 작성하세요.</p>
  <label>레퍼런스 원본 등록<input type="file" accept="image/png,image/jpeg,image/webp" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];if(file){setQueued(file);void register(file);}e.target.value='';}}/></label>{queued&&<button disabled={c.busy} onClick={()=>void register(queued)}>원본 등록 다시 시도: {queued.name}</button>}
  {p.references.map(ref=><ReferenceCard c={c} reference={ref} key={p.id+ref.id}/>)}</section>;
}
function ReferenceCard({c,reference:r}:{c:AtelierController;reference:Reference}){
 const [replacement,setReplacement]=useState<File|null>(null);
 const replace=(file:File)=>c.perform(async()=>{const f=await c.upload(file,file.name,'reference');await c.mutate('entity.mutate',{kind:'references',action:'patch',entityId:r.id,value:{fileId:f.id}});setReplacement(null);});
 const [rect,setRect]=useState<Rect>({x:0,y:0,w:1,h:1}),image=useRef<HTMLImageElement|null>(null),stage=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{image.current=null;},[r.fileId]);
 const initial={name:r.name,url:r.url||'',note:r.note||'',role:r.role||''};
 const crop=async(rect:Rect,regionId?:string)=>{
   const img=image.current;if(!img?.naturalWidth||!r.fileId)throw new Error('실제 원본이 로드된 후 영역을 선택하세요.');
   if(![rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)||rect.x<0||rect.y<0||rect.w<=0||rect.h<=0||rect.x+rect.w>1.00001||rect.y+rect.h>1.00001)throw new Error('원본 범위 안의 영역을 선택하세요.');
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*rect.w));canvas.height=Math.max(1,Math.round(img.naturalHeight*rect.h));if(canvas.width*canvas.height>16000000){const ratio=Math.sqrt(16000000/(canvas.width*canvas.height));canvas.width=Math.max(1,Math.floor(canvas.width*ratio));canvas.height=Math.max(1,Math.floor(canvas.height*ratio));}
   const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이 브라우저에서 크롭을 만들 수 없습니다.');ctx.drawImage(img,img.naturalWidth*rect.x,img.naturalHeight*rect.y,img.naturalWidth*rect.w,img.naturalHeight*rect.h,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('실제 크롭 생성 실패')),'image/png'));
   const file=await c.upload(blob,r.name.slice(0,160)+'-crop.png','crop');
   await c.mutate('entity.mutate',{kind:'regions',action:regionId?'patch':'add',...(regionId?{entityId:regionId}:{}),value:{...(regionId?{}:{referenceId:r.id,value:'새 영역 관찰',observation:'',interpretation:'',target:'',purpose:'',keep:'',change:'',avoid:'',useMode:'시각 원리 참고'}),fileId:r.fileId,cropId:file.id,rect}});
 };
 const point=(e:React.PointerEvent<HTMLDivElement>)=>{const bounds=stage.current!.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(e.clientY-bounds.top)/bounds.height))};};
 return <article className="design-entity"><DraftForm draftKey={c.project!.id+':reference:'+r.id} initial={initial} title={r.name} disabled={c.busy} onSave={value=>c.commit('entity.mutate',{kind:'references',action:'patch',entityId:r.id,value})}>{(v,set)=><Inputs fields={[{key:'name',label:'원본 이름'},{key:'url',label:'출처 URL (자동 접속 안 함)'},{key:'role',label:'참고 역할'},{key:'note',label:'원본 메모',type:'area'}]} values={v} set={set}/>}</DraftForm>
  <label>원본 교체 (과거 원본·크롭·판정은 보존)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];if(file){setReplacement(file);void replace(file);}e.target.value='';}}/></label>{replacement&&<button disabled={c.busy} onClick={()=>void replace(replacement)}>원본 교체 다시 시도: {replacement.name}</button>}
  <div className="design-crop-stage" ref={stage} onPointerDown={e=>{if(e.button!==0||!image.current)return;drag.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!drag.current)return;const end=point(e),start=drag.current;setRect({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(end.x-start.x),h:Math.abs(end.y-start.y)});}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
   <LocalImage active={c.tab==='reference'} c={c} fileId={r.fileId} alt={r.name+' 원본'} onLoad={img=>{image.current=img;}}/>
   <div className="design-crop-box" style={{left:rect.x*100+'%',top:rect.y*100+'%',width:rect.w*100+'%',height:rect.h*100+'%'}}/>
  </div>
  <p>드래그하거나 아래 좌표로 영역을 지정하세요. 전체 이미지 선택도 가능합니다.</p><div className="design-fields">{(['x','y','w','h'] as const).map(key=><label key={key}>{({x:'왼쪽 위치',y:'위쪽 위치',w:'너비',h:'높이'})[key]} (0~1)<input type="number" min="0" max="1" step="0.01" value={rect[key]} onChange={e=>setRect({...rect,[key]:Number(e.target.value)})}/></label>)}</div><div className="design-actions"><button onClick={()=>setRect({x:0,y:0,w:1,h:1})}>전체 이미지 선택</button><button disabled={c.busy||!r.fileId} onClick={()=>void c.perform(()=>crop(rect))}>실제 크롭 저장·영역 추가</button></div>
  {r.regions.map(region=><EntityEditor key={region.id} c={c} kind="regions" node={region} extra={<><LocalImage active={c.tab==='reference'} c={c} fileId={region.cropId} alt={region.value+' 크롭'}/><button disabled={c.busy} onClick={()=>void c.perform(()=>crop(region.rect||rect,region.id))}>현재 원본으로 이 영역 크롭 갱신</button></>}/>)}
  <button disabled={c.busy} onClick={()=>{if(window.confirm('원본 항목을 제거할까요? 연결된 결정이 있으면 먼저 연결을 해제하세요.'))void c.action('entity.mutate',{kind:'references',action:'remove',entityId:r.id});}}>레퍼런스 항목 제거</button>
 </article>;
}
