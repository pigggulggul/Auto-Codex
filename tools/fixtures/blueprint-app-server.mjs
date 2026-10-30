// Test-only structured full-design responses; never performs model, file-write or tool execution.
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.method||m.id===undefined)return;
 if(m.method==='model/list'){send({id:m.id,result:{data:[{id:'blueprint-fixture',model:'blueprint-fixture',displayName:'설계 검증 fixture · 실제 AI 아님',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[]}]}});return;}
 if(m.method==='thread/start'){send({id:m.id,result:{thread:{id:randomUUID()}}});return;}
 if(m.method==='turn/interrupt'){send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:m.params.turnId,status:'interrupted'}}});return;}
 if(m.method!=='turn/start'){send({id:m.id,result:m.method==='skills/list'?{data:[]}:{}});return;}
 const turnId=randomUUID(),threadId=m.params.threadId;send({id:m.id,result:{turn:{id:turnId}}});
 const text=m.params.input[0].text,input=JSON.parse(text.slice(text.lastIndexOf('\n')+1));
 const plan=JSON.parse(readFileSync(process.env.AUTO_CODEX_BLUEPRINT_FIXTURE,'utf8'));
 if(input.idea.includes('질문검증')&&!input.clarifications.length)plan.questions=[{key:'device_question',question:'주로 확인하는 기기는 무엇인가요?',why:'첫 화면의 배치를 결정해요.',blocking:true,options:['데스크톱','모바일']}];
 if(input.clarifications.length){plan.visual.responsive+=' · 사용자 답변: '+input.clarifications.map(a=>a.answer).join(', ');}
 const output=JSON.stringify({candidates:[{targetId:input.projectTargetId,patch:plan,rationale:'합성 설계 검증용 전체 구성',assumptions:plan.assumptions.join(', ')}]});
 setTimeout(()=>{send({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',id:randomUUID(),phase:'final_answer',text:output}}});send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});},100);
});
