import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,issues,makeSnapshot,addFlowExample,addConcepts,assemble,updateDecision} from '../public/domain.js';
import {ensureEasy,confirmBasics,confirmFeatures,saveEasyFlow,selectEasyStyle,confirmDirection,confirmStyle,easyNext,FLOW_PATTERNS} from '../public/easy-guide.js';
import {validateProject,validateBackup} from '../src/project-validation.mjs';
import {graphIssues} from '../public/structure.js';

function complete(name='임의의 장치 도구',pattern='custom'){
 const p=newProject({name,idea:name+'를 사용하고 결과를 확인하는 서비스'}),e=ensureEasy(p);
 Object.assign(p.fields.product,{value:p.idea,source:'user'});p.fields.user.value='처음 쓰는 참가자';p.fields.goal.value=name+'의 핵심 작업을 완료한다.';e.environment='컴퓨터와 모바일 웹';confirmBasics(p);
 e.featuresText=name+' 시작\n'+name+' 작업\n'+name+' 결과 확인';e.help='later';e.materials=name+' 안내와 예시 데이터';confirmFeatures(p);
 e.flowText=pattern==='custom'?'준비\n작업\n완료':FLOW_PATTERNS.find(x=>x.id===pattern).steps;e.flowSource=pattern==='custom'?'user':'example';e.back='back';e.recovery='retry';saveEasyFlow(p);
 selectEasyStyle(p,0);e.fit='clarity';confirmDirection(p);e.checks=['state','finish'];e.customCheck=name+' 결과의 의미를 알 수 있다.';confirmStyle(p);return p;
}
test('four neutral activity patterns reach validated final output without photo or survival demands',()=>{
 for(const [name,pattern]of [['DI/DO 보드 상태 변환 시뮬레이터','control'],['라이어 게임 디자인','round'],['이상형월드컵 사이트 UI','compare'],['앙케이트 사이트 UI','answer']]){
  const p=complete(name,pattern);assert.deepEqual(issues(p),[]);validateProject(p);validateBackup({format:'atelier-backup',version:1,project:p,files:[]});
  p.intent={choice:'match',revision:p.revision,reason:'요약에서 기능·순서·스타일 확인'};const snap=makeSnapshot(p);assert(snap.text.includes(name));assert(!/촬영|네 장|꾸미기|거점|채집/.test(snap.text));assert(snap.sections.some(s=>s.decisionIds.includes(p.fields.goal.id)));assert(!p.reviews.length);
 }
});
test('basics do not ask about style; unknown helper is explicit uncertainty, never fabricated research',()=>{
 const p=newProject({name:'정의 전'});assert.equal(easyNext(p).tab,'design');assert.throws(()=>confirmBasics(p),/제품/);const done=complete();assert(done.fields.evidence.value.includes('그 전에는 검증된 사용자 조사'));assert.equal(done.fields.evidence.source,'example');assert.equal(done.fields.constraints.status,'excluded');
});
test('real back/retry links have no dead end, saved IDs persist through edits and removed steps stay in history',()=>{
 const p=complete(),f=p.flows[0],first=f.steps[0],e=ensureEasy(p);assert.deepEqual(graphIssues(p,f),[]);assert(f.graph.transitions.filter(t=>t.kind==='recovery').every(t=>t.from===t.to&&t.preserve));
 const before=structuredClone(f);e.flowText='준비 변경\n완료';e.back='none';e.recovery='previous';saveEasyFlow(p);assert.equal(f.steps[0],first);assert(f.history.some(v=>v.graph?.transitions.length===before.graph.transitions.length));assert.equal(p.screens.find(s=>s.id===before.steps.at(-1)).status,'excluded');assert.deepEqual(graphIssues(p,f),[]);validateProject(p);
});
test('switching style excludes old rules without changing frozen snapshots or another project',()=>{
 const p=complete(),other=complete('다른 프로젝트');p.intent={choice:'match',revision:p.revision};const snap=makeSnapshot(p),text=snap.text,oldIds=p.styles.map(s=>s.id),e=ensureEasy(p);selectEasyStyle(p,1);e.fit='fun';confirmDirection(p);confirmStyle(p);assert(oldIds.every(id=>p.styles.find(s=>s.id===id).status==='excluded'));assert.deepEqual(issues(p),[]);assert.equal(snap.text,text);assert.equal(other.styles.filter(s=>s.status==='confirmed').length,8);validateProject(p);
});
test('category examples stay neutral, named photo/game demos remain isolated',()=>{
 for(const type of ['제작 도구','게임','기타','비교·선택 서비스','설문·참여 서비스']){const p=newProject({name:'IoT용 임의 도구',type});addFlowExample(p);addConcepts(p);assert(!/촬영|네 장|꾸미기|거점|채집/.test(JSON.stringify(p.flows)+JSON.stringify(p.concepts)));}
});
test('upstream changes flag only affected existing decisions and require a new confirmation',()=>{
 const p=complete();p.intent={choice:'match',revision:p.revision};const old=makeSnapshot(p),text=old.text;updateDecision(p,p.fields.goal,{value:'새로운 완료 목표'},'goal');assert(p.flows[0].reviewNeeded);assert(issues(p).some(i=>i.code==='stale'));assert.equal(old.text,text);assert.throws(()=>makeSnapshot(p),/필수/);assert(assemble(p,{draft:true}).text.includes('새로운 완료 목표'));
});
test('detailed edits refresh clean list drafts while unfinished guided text is retained',()=>{
 const p=complete(),e=ensureEasy(p);ensureEasy(p);const old=p.features[0].value;updateDecision(p,p.features[0],{value:'상세 편집에서 고친 작업'});ensureEasy(p);assert(e.featuresText.includes('상세 편집에서 고친 작업'));assert(!e.featuresText.includes(old+'\n'));
 e.featuresText='아직 확인하지 않은 내 임시 입력';updateDecision(p,p.features[0],{value:'다시 고친 실제 작업'});ensureEasy(p);assert.equal(e.featuresText,'아직 확인하지 않은 내 임시 입력');assert.equal(p.features[0].value,'다시 고친 실제 작업');
});
test('optional constraints can be explicitly removed and an empty enabled constraint does not mutate decisions',()=>{
 const p=complete(),e=ensureEasy(p);e.constraintEnabled=true;p.fields.constraints.value='색만으로 상태를 구분하지 않음';confirmFeatures(p);assert.equal(p.fields.constraints.status,'confirmed');
 e.constraintEnabled=false;confirmFeatures(p);assert.equal(p.fields.constraints.status,'excluded');assert(!assemble(p,{draft:true}).text.includes('색만으로 상태를 구분하지 않음'));
 e.constraintEnabled=true;p.fields.constraints.value='';const before=JSON.stringify(p);assert.throws(()=>confirmFeatures(p),/조건/);assert.equal(JSON.stringify(p),before);
});
