import {describe,expect,it} from 'vitest';
import {AtelierApi,digest,toBase64,type Data} from './api';
import {AtelierDrafts} from './drafts';
import {renderToStaticMarkup} from 'react-dom/server';
import {AtelierWorkspace} from './Workspace';
import {AtelierNavigation} from '../../components/layout/AtelierNavigation';

describe('manual workspace transport and drafts',()=>{
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
  expect(nav).not.toContain('disabled=""');expect(nav).toContain('사용자 흐름');
  const html=renderToStaticMarkup(<AtelierWorkspace api={new AtelierApi()} connected={false}/>);
  for(const title of ['아이디어부터','이미지부터','컨셉 확정','기존 결과 개선'])expect(html).toContain(title);
  expect(html).toContain('연결이 끊겼습니다');expect(html).toContain('AI 설계 제안은 아직 연결되지 않았습니다');expect(html).not.toContain('실행 완료');
 });
});
