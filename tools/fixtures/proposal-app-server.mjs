// Synthetic protocol fixture only: no Codex/model/tool/network execution.
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.method||m.id===undefined)return;
 if(process.env.AUTO_CODEX_TEST_REQUESTS)appendFileSync(process.env.AUTO_CODEX_TEST_REQUESTS,JSON.stringify(m)+'\n');
 if(m.method==='model/list'){send({id:m.id,result:{data:[{id:'fixture',model:'fixture',displayName:'합성 모델 · 실제 AI 아님',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]}});return;}
 if(m.method==='thread/start'){send({id:m.id,result:{thread:{id:randomUUID()}}});return;}
 if(m.method==='turn/interrupt'){send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:m.params.turnId,status:'interrupted'}}});return;}
 if(m.method!=='turn/start'){send({id:m.id,result:m.method==='skills/list'?{data:[]}:{}});return;}
 const threadId=m.params.threadId,turnId=randomUUID(),text=JSON.stringify(m.params.input),mode=/synthetic-mode:(\w+)/.exec(text)?.[1]||'normal';
 const proposal=!!m.params.outputSchema;
 if(proposal&&mode==='startfail'){send({id:m.id,error:{code:-32000,message:'Synthetic model turn rejection'}});return;}
 const complete=()=>{
  send({method:'turn/started',params:{threadId,turn:{id:turnId}}});
  if(proposal&&mode==='permission'){send({id:'fixture-permission',method:'item/permissions/requestApproval',params:{threadId,turnId,permissions:{network:{enabled:true}}}});return;}
  if(mode==='hold')return;
  const schema=m.params.outputSchema?.properties.candidates.items.properties;
  const output=!proposal?'Synthetic ordinary conversation':mode==='bad'?'invalid fixture JSON':JSON.stringify({candidates:schema.targetId.enum.map(targetId=>({targetId,patch:Object.fromEntries(schema.patch.required.map(key=>[key,'Synthetic fixture '+key])),rationale:'Synthetic test rationale',assumptions:'No actual AI inference'}))});
  send({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',id:randomUUID(),text:output}}});
  send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:mode==='fail'?'failed':'completed'}}});
 };
 if(proposal&&mode==='early'){complete();send({id:m.id,result:{turn:{id:turnId}}});}
 else{send({id:m.id,result:{turn:{id:turnId}}});setTimeout(complete,proposal?150:50);}
});
