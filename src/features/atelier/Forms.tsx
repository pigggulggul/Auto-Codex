import {useId,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {AtelierDrafts} from './drafts';
import type {Data} from './api';
import {FIELD_HELP} from './guidance';

export const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function draftStorage():Pick<Storage,'getItem'|'setItem'|'removeItem'>{try{return window.localStorage;}catch{return {getItem:()=>null,setItem:()=>{throw new Error('임시 보관 불가');},removeItem:()=>{}};}}
type FormProps={draftKey:string;initial:Data;title:string;children:(values:Data,set:(key:string,value:unknown)=>void)=>ReactNode;onSave:(values:Data)=>Promise<unknown>;disabled?:boolean;onDirty?:()=>void};
/** Explicit server save and a separate local draft. A refreshed baseline never replaces a dirty form. */
export function DraftForm({draftKey,initial,title,children,onSave,disabled,onDirty}:FormProps){
 const store=useRef(new AtelierDrafts(draftStorage()));const cached=useRef(store.current.get(draftKey));
 const [values,setValues]=useState<Data>(()=>cached.current?.value||initial),[base,setBase]=useState(()=>cached.current?.base||stable(initial));
 const [dirty,setDirty]=useState(!!cached.current),[override,setOverride]=useState(false),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
 const current=stable(initial),conflict=dirty&&base!==current;
 const editVersion=useRef(0);
 const shown=dirty?values:initial;
 const change=(key:string,value:unknown)=>{
   editVersion.current++;const next={...shown,[key]:value},baseline=dirty?base:current;setValues(next);setBase(baseline);setDirty(true);setOverride(false);
   try{store.current.put(draftKey,{value:next,base:baseline});setMessage('입력 임시 보관됨 · 서버 저장 전');}catch{setMessage('브라우저 임시 보관 실패 · 이 창의 입력을 유지합니다.');}onDirty?.();
 };
 return <form className="design-form" aria-label={title} onSubmit={async event=>{
   event.preventDefault();if(!dirty||saving||disabled||conflict&&!override)return;setSaving(true);setMessage('실제 저장 요청 중');
   const submittedVersion=editVersion.current;
   try{await onSave(shown);if(editVersion.current!==submittedVersion){setMessage('요청 당시 입력은 저장했습니다. 이후 입력은 초안으로 유지합니다. 최신 저장본과 비교하세요.');return;}store.current.clear(draftKey);setDirty(false);setOverride(false);setMessage('서버 저장 확인됨');}
   catch(e){setMessage(e instanceof Error?e.message:'저장 실패 · 입력 유지');}finally{setSaving(false);}
 }}>
  <h3>{title}</h3>{children(shown,change)}
  {conflict&&<div className="design-conflict" role="alert"><p>저장본이 바뀌었습니다. 아래 초안은 유지했습니다. 최신 내용과 비교한 뒤 선택하세요.</p><details><summary>현재 저장본 확인</summary><pre>{JSON.stringify(initial,null,2)}</pre></details><label><input type="checkbox" checked={override} onChange={e=>setOverride(e.target.checked)}/>최신 저장본을 확인했고 이 초안을 적용합니다</label></div>}
  <div className="design-actions"><button className="atelier-primary" type="submit" disabled={!dirty||disabled||saving||conflict&&!override}>{saving?'저장 확인 중…':'저장'}</button><button type="button" disabled={!dirty||saving} onClick={()=>{store.current.clear(draftKey);setDirty(false);setBase(current);setOverride(false);setMessage('저장본으로 돌아왔습니다.');onDirty?.();}}>이 초안 버리고 저장본 보기</button><span role="status">{message|| (dirty?'저장 전 초안':'저장본')}</span></div>
 </form>;
}
export interface Choice {id:string;label:string}
export interface Field {key:string;label:string;type?:'text'|'area'|'select'|'multi'|'checkbox'|'number';options?:Choice[];help?:string;placeholder?:string}
export function Inputs({fields,values,set}:{fields:Field[];values:Data;set:(k:string,v:unknown)=>void}){
 const prefix=useId();
 return <div className="design-fields">{fields.map(field=>{
  const value=values[field.key],help=field.help??FIELD_HELP[field.key],hint=help?prefix+field.key:undefined;
  const label=<span>{field.label}</span>,description=help&&<small id={hint} className="design-field-help">{help}</small>;
  if(field.type==='multi'){
   const selected=Array.isArray(value)?value.map(String):[];
   return <fieldset key={field.key} className="design-choices" aria-describedby={hint}><legend>{field.label}</legend>{description}{!field.options?.length&&<p>아직 연결할 항목이 없어요. 해당 항목을 먼저 추가한 뒤 여기에서 연결할 수 있어요. 지금은 비워 두어도 돼요.</p>}{field.options?.map(o=><label key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={e=>set(field.key,e.target.checked?[...selected,o.id]:selected.filter(id=>id!==o.id))}/><span>{o.label}</span></label>)}</fieldset>;
  }
  if(field.type==='checkbox')return <label key={field.key}>{label}<input type="checkbox" aria-describedby={hint} checked={value===true} onChange={e=>set(field.key,e.target.checked)}/>{description}</label>;
  if(field.type==='select')return <label key={field.key}>{label}<select aria-describedby={hint} value={String(value??'')} onChange={e=>set(field.key,e.target.value)}><option value="">아직 정하지 않았어요</option>{field.options?.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>{description}</label>;
  return <label key={field.key}>{label}{field.type==='area'?<textarea rows={3} aria-describedby={hint} placeholder={field.placeholder} value={String(value??'')} onChange={e=>set(field.key,e.target.value)}/>:<input type={field.type==='number'?'number':'text'} aria-describedby={hint} placeholder={field.placeholder} value={String(value??'')} onChange={e=>set(field.key,field.type==='number'?Number(e.target.value):e.target.value)}/ >}{description}</label>;
 })}</div>;
}
