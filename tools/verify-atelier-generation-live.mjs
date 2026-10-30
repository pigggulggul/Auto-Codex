// Explicit live smoke only. Uses installed Codex authentication; never reads credentials.
// Writes a single HTML file under this repository's ignored .cache and preserves it for inspection.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {WebSocket} from 'ws';
import {AtelierHandlers} from '../build-server/server/atelier/handlers.js';
import {domain} from '../build-server/server/atelier/validation.js';
import {readProjectTrust} from '../build-server/server/project-trust.js';
import {defaultModel,isSixSeries} from '../build-server/shared/model-selection.js';
if(!process.argv.includes('--live'))throw new Error('Use --live explicitly; this requests the installed Codex model.');
const modelIndex=process.argv.indexOf('--model'),requestedModel=modelIndex>=0?process.argv[modelIndex+1]:undefined;
if(modelIndex>=0&&!requestedModel)throw new Error('--model requires an explicitly selected catalog model.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');assert.equal(await readProjectTrust(root),'trusted','The repository must already be explicitly trusted. This tool never changes trust.');
await mkdir(path.join(root,'.cache'),{recursive:true});const scratch=await mkdtemp(path.join(root,'.cache','atelier-live-'));await cp(path.join(root,'build-server'),path.join(scratch,'build-server'),{recursive:true});
const relative=path.relative(root,path.join(scratch,'smoke.html')).split(path.sep).join('/');
const p=domain.newProject({name:'Live synthetic HTML smoke',type:'제작 도구',idea:`Only create a tiny standalone HTML file at ${relative}. Do not modify other project code.`});
for(const d of Object.values(p.fields)){d.value='로컬 스모크: 외부 자료·의존성·네트워크 없는 정적 한 화면';d.status='confirmed';}
const screen=domain.decision('정적 스모크 화면','user','confirmed',{kind:'페이지',role:'스모크 확인',entry:'파일 열기',priority:'제목',actions:'버튼 선택',response:'텍스트 갱신',next:'완료',exceptions:'입력 없음',preserve:'제목',links:[]});p.screens.push(screen);
const flow=domain.decision('정적 한 화면','user','confirmed',{goal:'스모크 확인',role:'테스터',start:'파일 열기',steps:[screen.id],branch:'없음',recovery:'파일 다시 열기',complete:'제목 확인',loop:false});flow.graph=domain.createGraph(flow);Object.assign(flow.graph,{reviewedVersion:1,branchPolicy:'none',branchReason:'한 화면',recoveryPolicy:'none',recoveryReason:'상태 저장 없음'});p.flows.push(flow);
p.features.push(domain.decision('단일 HTML','user','confirmed',{priority:'이번 범위',flowIds:[flow.id]}));p.styles.push(domain.decision('#343432','user','confirmed',{role:'본문',scope:'전체',exception:'없음'}));p.assets.push(domain.decision('외부 리소스 없음','user','confirmed',{availability:'제작 필요'}));
p.output.tech='HTML, inline CSS, optional small inline JS, no dependencies';p.output.format='단일 HTML';p.output.common='저장소의 기존 소스를 수정하지 않는다. 아래 지정된 .cache 파일만 만든다.';p.output.extra=`실제 제작 스모크입니다. 오직 ${relative} 하나만 만들고 제목 ATELIER_SMOKE_CREATE와 버튼 하나를 넣으세요. 외부 요청, 설치, 배포, 다른 소스 수정은 하지 마세요. 테스트는 파일 읽기 또는 node 구문 검사로 제한하세요. 새 프레임워크 프로젝트를 생성하지 마세요.`;
p.intent={choice:'match',revision:p.revision,reason:'격리된 단일 HTML smoke 입력'};assert(domain.ready(p));domain.makeSnapshot(p);
const service=await AtelierHandlers.open(scratch);await service.store.insert(p);await service.store.close();
const port=4884;let child,socket,messages=[],generation;const evidence={liveAttempt:true,liveModelResponse:false,syntheticDesign:true,workspace:root,outputRelativePath:relative,approvalPolicy:'existing pending approvals; smoke tool declines requests',ok:false};
const delay=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(100);}throw new Error('Timeout: '+label);}
async function rpc(type,payload={}){const id=randomUUID();socket.send(JSON.stringify({type:'atelier.'+type,v:1,clientRequestId:id,payload}));await until(()=>messages.some(m=>m.clientRequestId===id),type);const r=messages.find(m=>m.clientRequestId===id);if(!r.ok)throw new Error(type+': '+r.error.code);return r.result;}
const last=t=>messages.findLast(m=>m.type===t);const hash=x=>createHash('sha256').update(x).digest('hex');
async function run(snapshot,purpose){const started=await rpc('generation.start',{designProjectId:p.id,expectedVersion:p.version,snapshotId:snapshot.id,bindingId:evidence.bindingId,purpose,executionMode:'solo',skillMode:'manual',model:evidence.model,idempotencyKey:randomUUID()});generation=started.generation;await until(async()=>{await delay(1100);generation=(await rpc('generation.get',{designProjectId:p.id,generationId:generation.id})).generation;return ['completed','failed','interrupted'].includes(generation.state);},purpose,120000);assert.equal(generation.state,'completed','Live turn did not complete');return generation;}
try{
 child=spawn(process.execPath,[path.join(scratch,'build-server/server/index.js')],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTO_CODEX_PORT:String(port)}});let listening=false;child.stdout.on('data',d=>{if(String(d).includes('Auto Codex bridge'))listening=true;});child.stderr.on('data',()=>{});await until(()=>listening,'bridge');
 socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:`http://127.0.0.1:${port}`});socket.on('message',d=>{const m=JSON.parse(String(d));messages.push(m);if(m.type==='approval.request')socket.send(JSON.stringify({type:'approval.resolve',approvalId:m.approval.approvalId,decision:'decline'}));});await once(socket,'open');await until(()=>last('models.list')?.models.length,'installed CLI model catalog');
 socket.send(JSON.stringify({type:'project.select',path:root}));await until(()=>last('bridge.state')?.snapshot.projectPath===root,'trusted workspace');
 const catalog=last('models.list').models;
 const model=requestedModel?catalog.find(m=>m.model===requestedModel):defaultModel(catalog);assert(model&&isSixSeries(model.model),'Live smoke requires a returned GPT-6 series model');evidence.model=model.model;
 evidence.bindingId=(await rpc('binding.set',{designProjectId:p.id,expectedVersion:p.version,conversationId:last('bridge.state').snapshot.activeConversationId})).binding.id;
 const created=await run(p.snapshots[0],'create');const first=await readFile(path.join(root,relative));assert(first.toString().includes('ATELIER_SMOKE_CREATE'));evidence.liveModelResponse=true;evidence.create={generationId:created.id,threadId:created.runtime.threadId,turnId:created.runtime.turnId,hash:hash(first),size:first.length};
 await delay(300);await socket.close();
 // Prepare the next immutable revision through the same domain rules using actual observed file evidence.
 const done=once(child,'exit');child.kill();await done;
 const next=await AtelierHandlers.open(scratch);let revision;
 try{const current=await next.store.get(p.id);const saved=await next.store.mutate(p.id,current.version,p=>{
   const result={id:domain.uid('result'),snapshotId:p.snapshots[0].id,fileId:null,source:'live smoke file read',environment:'local filesystem',screen:'smoke.html',execution:'Actual file exists; SHA-256 '+hash(first)};p.results.push(result);const review=domain.beginReview(p,result);review.items[0].selected=true;
   const plan=domain.createPlan(p,review,{change:`Change only ${relative}: replace ATELIER_SMOKE_CREATE with ATELIER_SMOKE_REVISE. Keep the existing button. No other source changes, installs, external requests or deployment.`,keep:'Existing HTML and button',check:'Read the same file and verify new title; behavior review is not completed.'});plan.confirmed=true;revision=domain.makeSnapshot(p,{plan});
 });p.version=saved.version;
 }finally{await next.store.close();}
 messages=[];child=spawn(process.execPath,[path.join(scratch,'build-server/server/index.js')],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTO_CODEX_PORT:String(port)}});listening=false;child.stdout.on('data',d=>{if(String(d).includes('Auto Codex bridge'))listening=true;});child.stderr.on('data',()=>{});await until(()=>listening,'restart bridge');socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:`http://127.0.0.1:${port}`});socket.on('message',d=>{const m=JSON.parse(String(d));messages.push(m);if(m.type==='approval.request')socket.send(JSON.stringify({type:'approval.resolve',approvalId:m.approval.approvalId,decision:'decline'}));});await once(socket,'open');await until(()=>last('models.list')?.models.length,'restart catalog');
 const revised=await run(revision,'revise');const second=await readFile(path.join(root,relative));assert(second.toString().includes('ATELIER_SMOKE_REVISE'));assert.notEqual(hash(second),hash(first));evidence.revise={generationId:revised.id,threadId:revised.runtime.threadId,turnId:revised.runtime.turnId,hash:hash(second),size:second.length};evidence.soloResume=revised.runtime.threadId===created.runtime.threadId;evidence.ok=true;
}catch(e){evidence.failure=e instanceof Error?e.message:'Live smoke failed';const activity=messages.filter(m=>m.type==='activity.event').map(m=>JSON.stringify(m)).join('\n');evidence.failureCode=/not supported.*ChatGPT account/i.test(activity)?'MODEL_UNSUPPORTED':'LIVE_SMOKE_FAILED';if(generation)evidence.lastGeneration={id:generation.id,state:generation.state,error:generation.error};process.exitCode=1;}
finally{socket?.terminate();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}await writeFile(path.join(root,'docs/atelier/STAGE6_LIVE_EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));}
