import {useCallback,useEffect,useRef,useState} from 'react';
import type {Entry,Project,Tab} from '../../../shared/atelier/types';
import {AtelierApi,AtelierFailure,data,record,type Data,type Download,type FileInfo} from './api';

export function useAtelier(api:AtelierApi,connected:boolean) {
  const [project,setProject]=useState<Project|null>(null),ref=useRef<Project|null>(null);
  const [projects,setProjects]=useState<Data[]>([]),[files,setFiles]=useState<FileInfo[]>([]);
  const [capabilities,setCapabilities]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[remoteVersion,setRemoteVersion]=useState(0);
  const [tab,setTab]=useState<Tab>('design'),[prepared,setPrepared]=useState<{descriptor:Download;mime:string}|null>(null);
  const gate=useRef(false),selection=useRef(0);
  const accept=useCallback((p:Project)=>{ref.current=p;setProject(p);setRemoteVersion(v=>v<=p.version?0:v);},[]);
  const perform=useCallback(async<T,>(job:()=>Promise<T>):Promise<T|undefined>=>{
    if(gate.current){setError('진행 중인 설계 요청을 기다려 주세요. 현재 입력은 유지됩니다.');return;}
    gate.current=true;setBusy(true);setError('');
    try{return await job();}catch(e){setError(e instanceof Error?e.message:'요청을 확인할 수 없습니다.');return;}finally{gate.current=false;setBusy(false);}
  },[]);
  const list=useCallback(async()=>{setProjects((await api.pages('project.list')).filter(record));},[api]);
  const load=useCallback(async(id:string,restorePosition=true)=>{
    const ticket=++selection.current;const p=await api.project(id);const fileRows=await api.pages('file.list',{designProjectId:id});
    if(ticket!==selection.current)return;
    accept(p);setFiles(fileRows as FileInfo[]);localStorage.setItem('auto-codex.atelier.project',id);
    if(restorePosition){const saved=localStorage.getItem('auto-codex.atelier.tab.'+id);setTab((['design','flow','reference','concept','style','brief','prompt','review'].includes(saved||'')?saved:p.progress.tab) as Tab);}
  },[api,accept]);
  useEffect(()=>{
    if(!connected){setCapabilities(null);return;}
    let active=true;
    void perform(async()=>{const cap=await api.request('capabilities');if(!active)return;setCapabilities(cap);await list();const id=localStorage.getItem('auto-codex.atelier.project');if(id&&!ref.current)try{await load(id);}catch(e){if(e instanceof AtelierFailure&&e.code==='NOT_FOUND')localStorage.removeItem('auto-codex.atelier.project');else throw e;}});
    return()=>{active=false;};
  },[connected,api,list,load,perform]);
  useEffect(()=>api.subscribe(event=>{
    const current=ref.current;if(current&&event.type==='atelier.project.changed'&&event.designProjectId===current.id&&record(event.payload)&&typeof event.payload.version==='number'&&event.payload.version>current.version)setRemoteVersion(v=>Math.max(v,Number(data(event.payload).version)));
  }),[api]);
  const mutate=useCallback(async(type:string,payload:Data={})=>{
    const p=ref.current;if(!p)throw new Error('설계 프로젝트를 먼저 여세요.');
    const id=p.id;await api.request(type,{designProjectId:id,expectedVersion:p.version,...payload});
    const next=await api.project(id);if(ref.current?.id===id)accept(next);return next;
  },[api,accept]);
  const action=useCallback((type:string,payload:Data={})=>perform(()=>mutate(type,payload)),[perform,mutate]);
  const commitJob=useCallback(async<T,>(job:()=>Promise<T>)=>{
    if(gate.current)throw new Error('진행 중인 설계 요청의 응답을 기다려 주세요.');gate.current=true;setBusy(true);setError('');
    try{return await job();}catch(e){setError(e instanceof Error?e.message:'저장 실패 · 입력 유지');throw e;}finally{gate.current=false;setBusy(false);}
  },[]);
  const commit=useCallback((type:string,payload:Data={})=>commitJob(()=>mutate(type,payload)),[commitJob,mutate]);
  const navigate=useCallback((next:Tab)=>{setTab(next);const p=ref.current;if(p){localStorage.setItem('auto-codex.atelier.tab.'+p.id,next);void perform(()=>mutate('project.update',{patch:{progress:{tab:next}}}));}},[perform,mutate]);
  const create=(name:string,idea:string,entry:Entry,type:Project['type'])=>perform(async()=>{const result=await api.request('project.create',{name,idea,entry,type});const id=String(data(result.project).id);await load(id);await list();return id;});
  const select=(id:string)=>perform(()=>load(id));
  const reload=()=>perform(async()=>{if(ref.current)await load(ref.current.id,false);await list();});
  const upload=async(file:File|Blob,name:string,role:string)=>{const p=ref.current;if(!p)throw new Error('설계 프로젝트가 없습니다.');const r=await api.upload(file,name,p.id,role);const f=data(r.file) as unknown as FileInfo;setFiles(current=>[...current.filter(x=>x.id!==f.id),f]);return f;};
  const exportFile=(type:'backup.export'|'bundle.export'|'snapshot.read',payload:Data={})=>perform(async()=>{const p=ref.current;if(!p)throw new Error('설계 프로젝트가 없습니다.');const r=await api.request(type,{designProjectId:p.id,...payload});setPrepared({descriptor:data(r.download) as unknown as Download,mime:type==='bundle.export'?'application/zip':'application/json'});});
  const restore=(file:File)=>perform(async()=>{const t=await api.upload(file,file.name);const r=await api.request('backup.import',{transferId:t.transferId});await load(String(data(r.project).id));await list();});
  return {api,project,projectRef:ref,projects,files,capabilities,error,setError,busy,tab,navigate,create,select,reload,mutate,commit,commitJob,action,perform,upload,exportFile,restore,remoteVersion,prepared,
    savePrepared:()=>perform(async()=>{if(prepared){await api.save(prepared.descriptor,prepared.mime);setPrepared(null);}}),
    deleteProject:(confirmation:string)=>perform(async()=>{const p=ref.current;if(!p||confirmation!==p.id)throw new Error('확인한 프로젝트가 다릅니다.');await api.request('project.delete',{designProjectId:p.id,expectedVersion:p.version,confirmation:{projectId:confirmation}});ref.current=null;setProject(null);setFiles([]);localStorage.removeItem('auto-codex.atelier.project');await list();})};
}
export type AtelierController=ReturnType<typeof useAtelier>;
