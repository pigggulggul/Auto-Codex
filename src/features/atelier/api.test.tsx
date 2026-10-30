import {describe,expect,it} from 'vitest';
import {AtelierApi,digest,toBase64,type Data} from './api';
import {AtelierDrafts} from './drafts';
import {renderToStaticMarkup} from 'react-dom/server';
import {AtelierWorkspace} from './Workspace';
import {AtelierNavigation} from '../../components/layout/AtelierNavigation';
import {Inputs} from './Forms';
import {fieldsFor} from './Editors';
import {FIELD_HELP,TAB_GUIDANCE} from './guidance';
import {createDomain} from '../../../shared/atelier/domain';
import {PROPOSAL_PURPOSES,proposalNodes,proposalTargetName} from './Proposals';

describe('manual workspace transport and drafts',()=>{
 it('serializes the entire background file download so a prepared backup leaves one usable slot',async()=>{
  const api=new AtelierApi(),bytes=new TextEncoder().encode('synthetic file'),hash=await digest(bytes);let active=1,peak=1,next=0;const descriptors=new Set<string>();
  api.connect(raw=>{const message=JSON.parse(raw) as {clientRequestId:string;type:string;payload:Data};let result:Data;
   if(message.type==='atelier.file.read'){active++;peak=Math.max(peak,active);const id='up_'+(++next);descriptors.add(id);result={file:{id:'file_'+next,name:'file.txt'},download:{transferId:id,name:'file.txt',totalBytes:bytes.length,sha256:hash,chunkBytes:262144}};}
   else{expect(message.type).toBe('atelier.transfer.read');expect(descriptors.delete(String(message.payload.transferId))).toBe(true);active--;result={index:0,totalBytes:bytes.length,sha256:hash,dataBase64:toBase64(bytes),last:true};}
   queueMicrotask(()=>api.receive({type:'atelier.response',v:1,clientRequestId:message.clientRequestId,ok:true,result}));
  });
  const files=await Promise.all([api.file('p_one','file_one'),api.file('p_one','file_two'),api.file('p_one','file_three')]);expect(files).toHaveLength(3);expect(peak).toBe(2);expect(active).toBe(1);api.disconnect();
 });
 it('releases oversized downloads before rejecting them and treats expired release as already closed',async()=>{
  const api=new AtelierApi(),sent:Data[]=[];api.connect(raw=>{const message=JSON.parse(raw) as Data;sent.push(message);queueMicrotask(()=>api.receive({type:'atelier.response',v:1,clientRequestId:message.clientRequestId,ok:false,error:{code:'TRANSFER_EXPIRED',message:'expired'}}));});
  const descriptor={transferId:'up_test',name:'large',totalBytes:99,sha256:'0'.repeat(64),chunkBytes:262144};await expect(api.bytes(descriptor,10)).rejects.toMatchObject({code:'LIMIT_EXCEEDED'});await expect(api.release(descriptor)).resolves.toBeUndefined();expect(sent.map(m=>m.type)).toEqual(['atelier.transfer.abort','atelier.transfer.abort']);api.disconnect();
 });
 it('explains every entity field and every tab; multi-selection works without modifier keys',()=>{
  const p=createDomain({id:prefix=>prefix+'_synthetic',now:()=>''}).newProject({name:'synthetic'});
  for(const kind of ['features','contents','flows','screens','concepts','styles','assets','regions'] as const)for(const field of fieldsFor(kind,p))expect(field.help||FIELD_HELP[field.key],kind+'.'+field.key).toBeTruthy();
  expect(Object.keys(TAB_GUIDANCE)).toHaveLength(8);expect(PROPOSAL_PURPOSES).toHaveLength(5);expect(proposalNodes(p,'brief')).toHaveLength(12);expect(proposalTargetName(p,p.fields.product.id)).toBe('무엇을 만드는 프로젝트인가요?');
  const html=renderToStaticMarkup(<Inputs fields={[{key:'ids',label:'연결 화면',type:'multi',options:[{id:'one',label:'장소 찾기'}],help:'사용할 화면을 체크하세요.'}]} values={{ids:['one']}} set={()=>{}}/>);expect(html).toContain('type="checkbox"');expect(html).toContain('checked=""');expect(html).toContain('aria-describedby=');expect(html).not.toContain('<select');
 });
 it('generation interrupt bypasses a pending start on the same connection without replaying it',async()=>{
  const api=new AtelierApi(),sent:Data[]=[];api.connect(raw=>sent.push(JSON.parse(raw) as Data));
  const start=api.request('generation.start',{idempotencyKey:'synthetic-key'});await new Promise(r=>setTimeout(r,0));
  const interrupt=api.request('generation.interrupt',{generationId:'gen_test'});await new Promise(r=>setTimeout(r,0));
  expect(sent.map(m=>m.type)).toEqual(['atelier.generation.start','atelier.generation.interrupt']);
  api.receive({type:'atelier.response',v:1,clientRequestId:sent[1].clientRequestId,ok:true,result:{kind:'interruptRequested'}});expect(await interrupt).toEqual({kind:'interruptRequested'});
  api.receive({type:'atelier.response',v:1,clientRequestId:sent[0].clientRequestId,ok:true,result:{state:'interrupted'}});await start;expect(sent).toHaveLength(2);api.disconnect();
 });
 it('correlates only pending replies and rejects queued mutations after disconnect',async()=>{
  const api=new AtelierApi(),sent:Data[]=[];api.connect(raw=>sent.push(JSON.parse(raw) as Data));
  const first=api.request('capabilities'),second=api.request('project.list');
  await new Promise(resolve=>setTimeout(resolve,0));expect(sent).toHaveLength(1);
  api.receive({type:'atelier.response',v:1,clientRequestId:'foreign',ok:true,result:{kind:'wrong'}});
  expect(sent).toHaveLength(1);api.receive({type:'atelier.response',v:1,clientRequestId:sent[0].clientRequestId,ok:true,result:{kind:'capabilities'}});expect(await first).toEqual({kind:'capabilities'});
  await new Promise(resolve=>setTimeout(resolve,0));expect(sent).toHaveLength(2);api.disconnect();await expect(second).rejects.toMatchObject({code:'DISCONNECTED'});
  api.connect(raw=>sent.push(JSON.parse(raw) as Data));expect(sent).toHaveLength(2);
 });
 it('checks actual download byte totals and digest before returning JSON bytes',async()=>{
  const api=new AtelierApi(),bytes=new TextEncoder().encode('actual synthetic bytes'),hash=await digest(bytes);
  api.connect(raw=>{const request=JSON.parse(raw) as Data;queueMicrotask(()=>api.receive({type:'atelier.response',v:1,clientRequestId:request.clientRequestId,ok:true,result:{index:0,totalBytes:bytes.length,sha256:hash,dataBase64:toBase64(bytes),last:true}}));});
  expect(await api.bytes({transferId:'up_test',name:'test.txt',totalBytes:bytes.length,sha256:hash,chunkBytes:262144})).toEqual(bytes);
  api.connect(raw=>{const request=JSON.parse(raw) as Data;queueMicrotask(()=>api.receive({type:'atelier.response',v:1,clientRequestId:request.clientRequestId,ok:true,result:{index:0,totalBytes:bytes.length,sha256:hash,dataBase64:toBase64(new Uint8Array(bytes.length)),last:true}}));});
  await expect(api.bytes({transferId:'up_test',name:'bad.txt',totalBytes:bytes.length,sha256:hash,chunkBytes:262144})).rejects.toThrow('해시');api.disconnect();
 });
 it('retains unsaved values and their old baseline independently for each project/entity',()=>{
  const map=new Map<string,string>();const storage={getItem:(key:string)=>map.get(key)||null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};
  const first=new AtelierDrafts(storage);first.put('p_one:d_one',{value:{value:'unsaved'},base:'old version'});first.put('p_two:d_one',{value:{value:'other'},base:'other version'});
  const restored=new AtelierDrafts(storage);expect(restored.get('p_one:d_one')).toEqual({value:{value:'unsaved'},base:'old version'});restored.clear('p_two:d_one');expect(restored.get('p_one:d_one')?.value.value).toBe('unsaved');
 });
 it('enables all eight editor destinations but reports offline/manual AI state without success',()=>{
  const nav=renderToStaticMarkup(<AtelierNavigation page="design" mobileOpen={false} onNavigate={()=>{}} onMobileClose={()=>{}} onLegacy={()=>{}} onDesignTab={()=>{}} designTab="flow"/>);
  expect(nav).not.toContain('disabled=""');expect(nav).toContain('이용 순서');
  const html=renderToStaticMarkup(<AtelierWorkspace api={new AtelierApi()} connected={false}/>);
  for(const title of ['아이디어부터','이미지부터','컨셉 확정','기존 결과 개선'])expect(html).toContain(title);
  expect(html).toContain('연결이 끊겼습니다');expect(html).toContain('AI 설계 제안은 아직 연결되지 않았습니다');expect(html).not.toContain('실행 완료');
 });
});
