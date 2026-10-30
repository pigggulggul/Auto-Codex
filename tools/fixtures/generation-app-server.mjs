// Synthetic JSONL protocol only. Does not call models, tools, a shell, or the network.
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const pending=new Map();
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(!m.method){const p=pending.get(m.id);if(p){pending.delete(m.id);p(m.result);}return;}
 if(m.id===undefined)return;
 if(process.env.AUTO_CODEX_TEST_REQUESTS)appendFileSync(process.env.AUTO_CODEX_TEST_REQUESTS,JSON.stringify(m)+'\n');
 if(m.method==='model/list'){send({id:m.id,result:{data:[{id:'fixture',model:'fixture',displayName:'Synthetic generation QA',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'low'}]}]}});return;}
 if(m.method==='thread/start'||m.method==='thread/resume'){send({id:m.id,result:{thread:{id:m.params.threadId||randomUUID()}}});return;}
 if(m.method==='turn/interrupt'){send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:m.params.turnId,status:'interrupted'}}});return;}
 if(m.method!=='turn/start'){send({id:m.id,result:m.method==='skills/list'?{data:[]}:{}});return;}
 const threadId=m.params.threadId,turnId=randomUUID(),text=JSON.stringify(m.params.input),mode=[...text.matchAll(/GENMODE=(\w+)/g)].at(-1)?.[1]||'normal';
 if(mode==='startfail'){send({id:m.id,error:{code:-32000,message:'Synthetic dispatch rejected'}});return;}
 const finish=status=>send({method:'turn/completed',params:{threadId,turn:{id:turnId,status}}});
 const run=()=>{
   send({method:'turn/started',params:{threadId,turn:{id:turnId}}});
   send({method:'thread/tokenUsage/updated',params:{threadId,turnId,tokenUsage:{last:{inputTokens:10,outputTokens:5,totalTokens:15}}}});
   if(mode==='hold'||mode==='slow')return;
   if(mode==='approval'){
     const id='permission-'+turnId;pending.set(id,result=>finish(result?.permissions?.network?.enabled?'completed':'failed'));
     send({id,method:'item/permissions/requestApproval',params:{threadId,turnId,permissions:{network:{enabled:true}},reason:'Synthetic denial path'}});return;
   }
   const output=m.params.outputSchema?JSON.stringify({tasks:[{id:'build',title:'Synthetic builder',description:'No actual code execution',kind:'implementation',access:'write',agentRole:'builder',dependsOn:[],order:1}]}):'Synthetic runtime output; no model inference';
   send({method:'item/completed',params:{threadId,turnId,item:{id:randomUUID(),type:'agentMessage',text:output}}});
   send({method:'item/commandExecution/outputDelta',params:{threadId:'unowned-thread',turnId:'unowned-turn',delta:'FOREIGN_MUST_NOT_ATTACH'}});
   finish(mode==='fail'?'failed':'completed');
   setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId,turnId,delta:'LATE_MUST_NOT_ATTACH'}}),250);
 };
 if(mode==='earlywrong'){
   const wrong=randomUUID();send({method:'turn/started',params:{threadId,turn:{id:wrong}}});send({method:'item/agentMessage/delta',params:{threadId,turnId:wrong,delta:'WRONG_EARLY_MUST_NOT_ATTACH'}});send({method:'turn/completed',params:{threadId,turn:{id:wrong,status:'completed'}}});send({id:m.id,result:{turn:{id:turnId}}});setTimeout(run,120);
 }
 else if(mode==='slow'){run();setTimeout(()=>send({id:m.id,result:{turn:{id:turnId}}}),500);}
 else if(mode==='early'){run();send({id:m.id,result:{turn:{id:turnId}}});}
 else{send({id:m.id,result:{turn:{id:turnId}}});setTimeout(run,120);}
});
