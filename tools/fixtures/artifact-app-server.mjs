// Synthetic App Server only. Writes bounded fixture files in the supplied isolated workspace.
import {createInterface} from 'node:readline';
import {writeFileSync,utimesSync,existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {crc32} from './build-server/server/atelier/resources.js';
const threads=new Map(),approvals=new Map(),send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const chunk=(kind,data)=>{const type=Buffer.from(kind),header=Buffer.alloc(4),crc=Buffer.alloc(4);header.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([header,type,data,crc]);};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.method){const next=approvals.get(m.id);if(next){approvals.delete(m.id);next(m.result);}return;}if(m.id===undefined)return;
 if(m.method==='model/list'){send({id:m.id,result:{data:[{id:'gpt-6-fixture',model:'gpt-6-fixture',displayName:'합성 6시리즈 fixture · 실제 AI 아님',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'low'}]}]}});return;}
 if(m.method==='thread/start'||m.method==='thread/resume'){const id=m.params.threadId||randomUUID();threads.set(id,m.params.cwd);send({id:m.id,result:{thread:{id}}});return;}
 if(m.method==='turn/interrupt'){send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:m.params.turnId,status:'interrupted'}}});return;}
 if(m.method!=='turn/start'){send({id:m.id,result:m.method==='skills/list'?{data:[]}:{}});return;}
 const threadId=m.params.threadId,turnId=randomUUID(),cwd=threads.get(threadId),mode=[...JSON.stringify(m.params.input).matchAll(/ARTIFACT_MODE=(\w+)/g)].at(-1)?.[1]||'normal';
 const item=(type,body)=>send({method:'item/completed',params:{threadId,turnId,item:{id:randomUUID(),type,...body}}});
 const finish=status=>send({method:'turn/completed',params:{threadId,turn:{id:turnId,status}}});
 send({id:m.id,result:{turn:{id:turnId}}});
 setTimeout(()=>{
  send({method:'turn/started',params:{threadId,turn:{id:turnId}}});
  if(mode==='denied'){const id='fixture-approval-'+turnId;approvals.set(id,()=>{item('commandExecution',{command:'npm test',status:'declined',cwd});finish('failed');});send({id,method:'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:id,command:'npm test',cwd,reason:'Synthetic denial path'}});return;}
  if(m.params.outputSchema){item('agentMessage',{text:JSON.stringify({tasks:[{id:'build',title:'Synthetic artifact builder',description:'Create fixture files only',kind:'implementation',access:'write',agentRole:'builder',dependsOn:[],order:1}]})});finish('completed');return;}
  if(m.params.sandboxPolicy.type!=='workspaceWrite'){item('agentMessage',{text:'Synthetic read-only report'});finish('completed');return;}
  const write=(name,bytes)=>{const target=path.join(cwd,name);writeFileSync(target,bytes);const past=new Date(Date.now()-2000);utimesSync(target,past,past);};
  const files=[];
  if(mode==='missing')files.push({path:'absent.html',kind:{type:'add'},diff:'untrusted diff is intentionally not retained'});
  else{
   const second=mode==='rewrite',title=second?'ARTIFACT_REVISED':'ARTIFACT_INITIAL';
   write('index.html',`<!doctype html><title>${title}</title><h1>${title}</h1><button>Keep this button</button><script>window.ARTIFACT_PARENT_EXECUTED=true;fetch('https://example.invalid/forbidden')</script>`);
   write('actual.png',PNG);files.push(...['index.html','actual.png'].map(name=>({path:name,kind:{type:second?'update':'add'},diff:'fixture diff omitted'})));
   if(mode==='unsafe')files.push({path:'../outside.txt',kind:{type:'add'},diff:''},{path:'.env',kind:{type:'update'},diff:''});
  }
  item('fileChange',{changes:files,status:'completed'});
  if(mode==='hold')return;
  // Wait for the bridge checkpoint to observe the actual fixture bytes.
  setTimeout(()=>{
   item('commandExecution',{command:'npm test',cwd,status:mode==='fail'?'failed':'completed',exitCode:mode==='fail'?1:0,durationMs:10,aggregatedOutput:'MUST_NOT_STORE_RAW_OUTPUT'});
   const complete=()=>{item('agentMessage',{text:'Synthetic fixture output, not AI inference or user review'});finish(mode==='fail'?'failed':'completed');};
   if(mode==='latewrite')setTimeout(()=>{write('index.html','<h1>Changed after the check</h1>');item('fileChange',{changes:[{path:'index.html',kind:{type:'update'},diff:''}],status:'completed'});complete();},120);
   else setTimeout(complete,80);
  },80);
 },100);
});
