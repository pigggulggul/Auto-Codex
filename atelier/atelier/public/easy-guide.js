// Task-first views over the SAME decisions, graphs, files and snapshots as the detailed editor.
// Presets are explicit, editable local teaching material; no text/image inference takes place.
import {decision,confirmed,updateDecision,touch,chooseConcept,applyPalette,issues,uid} from './domain.js';
import {createGraph} from './structure.js';

const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(text,action,attrs='',primary=false)=>`<button class="btn ${primary?'primary':''}" data-action="easy-${action}" ${attrs}>${text}</button>`;
const field=(label,d,prop='value',placeholder='',area=false)=>`<label class="easy-label" for="easy-${d.id}-${prop}">${label}</label><${area?'textarea':'input'} id="easy-${d.id}-${prop}" class="input" data-decision="${d.id}" data-prop="${prop}" aria-label="${h(label)}" placeholder="${h(placeholder)}" ${area?'':`value="${h(d[prop])}"`}>${area?h(d[prop]):''}${area?'</textarea>':''}`;
const draft=(p,label,key,{area=false,placeholder='',options}={})=>`<label class="easy-label" for="easy-${key}">${label}</label>${options?`<select class="input" id="easy-${key}" data-path="progress.easy.${key}" aria-label="${h(label)}">${options.map(([v,t])=>`<option value="${h(v)}" ${p.progress.easy[key]===v?'selected':''}>${h(t)}</option>`).join('')}</select>`:`<${area?'textarea':'input'} id="easy-${key}" class="input" data-path="progress.easy.${key}" aria-label="${h(label)}" placeholder="${h(placeholder)}" ${area?'':`value="${h(p.progress.easy[key])}"`}>${area?h(p.progress.easy[key]):''}${area?'</textarea>':''}`}`;
const note=(title,text)=>`<div class="easy-note"><strong>${title}</strong><p>${text}</p></div>`;
const go=(tab,label)=>`<button class="btn primary" data-action="tab" data-tab="${tab}">${label} →</button>`;
const lines=x=>String(x||'').split('\n').map(s=>s.trim()).filter(Boolean);

export const FLOW_PATTERNS=[
 {id:'custom',label:'직접 적기',hint:'어떤 프로젝트든 한 줄에 행동 하나씩 적으세요.',steps:''},
 {id:'control',label:'상태를 보고 조작하는 도구',hint:'장비·IoT·시뮬레이터·관리 도구',steps:'현재 상태 확인\n입력값 변경\n변경 결과 확인'},
 {id:'round',label:'여러 사람이 진행하는 게임',hint:'파티 게임·퀴즈·라운드 게임',steps:'참가자와 규칙 설정\n각자 정보 확인\n게임 진행\n결과 확인'},
 {id:'compare',label:'둘을 비교하며 고르기',hint:'투표·토너먼트·상품 비교',steps:'비교할 후보 준비\n두 후보 비교\n한 후보 선택\n최종 결과 확인'},
 {id:'answer',label:'질문에 답하고 제출하기',hint:'앙케이트·설문·신청서',steps:'질문과 참여 방법 확인\n답변 입력\n답변 확인과 제출\n완료 확인'},
 {id:'create',label:'내용을 만들고 완성하기',hint:'편집기·콘텐츠·제작 도구',steps:'작업할 대상 준비\n내용 작성과 편집\n완성한 결과 확인'}
];
export const EASY_STYLES=[
 {id:'clear',label:'정보가 또렷한 화면',summary:'상태와 숫자를 먼저, 조작 버튼은 따로 모읍니다.',bg:'#f4f6f8',text:'#243047',accent:'#315ed4',font:'sans-serif',shape:'8px',layout:'현재 정보와 작업 대상을 위에, 조작 도구를 그 아래에 배치',material:'장식 없는 단색 패널과 얇은 구분선',motion:'값과 선택 상태가 바뀔 때만 160ms 전환'},
 {id:'lively',label:'선택이 즐거운 화면',summary:'비교할 대상을 크게, 선택 결과를 분명하게 보여 줍니다.',bg:'#fff5ea',text:'#432e32',accent:'#b52f52',font:'sans-serif',shape:'16px',layout:'핵심 콘텐츠를 크게, 다음 행동은 한 곳에 배치',material:'넓은 단색 면과 둥근 버튼, 본문 주변 장식 최소화',motion:'선택 결과에 180ms 전환, 동작 줄이기 설정 지원'},
 {id:'quiet',label:'차분히 읽는 화면',summary:'읽을 내용을 중심에, 긴 글도 편안하게 배치합니다.',bg:'#f5f3ed',text:'#34372e',accent:'#526940',font:'serif',shape:'4px',layout:'본문 폭을 제한하고 제목·설명·입력 순서로 한 열 배치',material:'따뜻한 단색 바탕, 장식 없는 본문 표면',motion:'입력과 제출 상태만 150ms 전환'}
];
const HELP=[
 ['steps','처음 쓰는 사람이 조작 순서를 알아야 해요.','어디부터 눌러야 하는지 모를 수 있다는 사용자 가설','시작 버튼과 짧은 단계 안내를 실제 작업 화면에 표시하고 시작부터 완료까지 직접 실행해 확인한다.'],
 ['meaning','상태나 결과가 무슨 뜻인지 알아야 해요.','상태·숫자·결과의 의미를 오해할 수 있다는 사용자 가설','상태 이름과 결과 설명을 해당 값 옆에 표시하고 사용자가 의미를 구별하는지 확인한다.'],
 ['undo','잘못 선택해도 고칠 수 있어야 해요.','실수하면 입력을 잃을 수 있다는 사용자 가설','이전 선택과 입력을 보존하고 수정·재시도 버튼을 제공한다. 실수 후 복구를 직접 실행해 확인한다.'],
 ['later','아직 몰라요. 첫 사용에서 확인할게요.','처음 쓰는 사람이 막히는 지점은 아직 확인하지 않음','첫 사용 과정을 관찰해 멈춘 위치를 기록한다. 그 전에는 검증된 사용자 조사나 성과로 표현하지 않는다.']
];
const FIT=[['clarity','정보와 조작을 빨리 구별해야 해서'],['fun','선택하고 참여하는 재미가 중요해서'],['reading','내용을 오래 읽거나 입력해야 해서'],['custom','내 이유를 직접 적기']];
const CHECKS=[['start','첫 화면에서 시작할 버튼을 찾을 수 있다.'],['state','현재 상태와 선택한 값이 글자로도 구별된다.'],['finish','주요 작업을 마치면 결과와 완료 여부를 알 수 있다.'],['retry','잘못 입력하거나 실패해도 입력을 잃지 않고 다시 시도한다.'],['read','긴 한글 설명과 작은 화면에서도 내용과 버튼이 겹치지 않는다.']];

export function ensureEasy(p){
 p.progress.easy??={};const e=p.progress.easy;
 const first=p.flows.find(f=>f.easyManaged);
 const defaults={designStage:0,featuresText:p.features.filter(f=>f.status!=='excluded'&&f.priority==='이번 범위').map(f=>f.value).join('\n'),laterText:p.features.filter(f=>f.status!=='excluded'&&f.priority==='후속 범위').map(f=>f.value).join('\n'),help:'',materials:p.contents.filter(d=>d.status!=='excluded').map(d=>d.value).join('\n')||'화면 안내 문구와 작업에 필요한 예시 데이터',flowText:first?first.steps.map(id=>p.screens.find(s=>s.id===id)?.value||'').join('\n'):'',flowSource:'user',flowPattern:'custom',back:first?.graph?.branchPolicy==='none'?'none':'',recovery:'',loop:first?.loop||false,fit:'',fitCustom:'',checks:[],customCheck:'',constraintEnabled:confirmed(p.fields.constraints),newFlow:false,reviewIndex:0,environment:p.fields.environment.value||'',type:p.type};
 for(const [k,v]of Object.entries(defaults))e[k]??=v;
 // Refresh a clean draft when the detailed editor changed the same decisions.
 // An unfinished user draft is retained and explicitly offered a refresh instead.
 const canonical={featuresText:p.features.filter(f=>f.status!=='excluded'&&f.priority==='이번 범위').map(f=>f.value).join('\n'),laterText:p.features.filter(f=>f.status!=='excluded'&&f.priority==='후속 범위').map(f=>f.value).join('\n'),flowText:first?first.steps.map(id=>p.screens.find(s=>s.id===id)?.value||'').join('\n'):''};
 e.baselines??={};for(const [key,value]of Object.entries(canonical)){const previous=e.baselines[key];if(previous!==undefined&&previous!==value&&e[key]===previous)e[key]=value;e.baselines[key]=value;}
 return e;
}
function set(p,key,value,source='user',extra={}){return updateDecision(p,p.fields[key],{value,status:'confirmed',source,reviewNeeded:false,...extra},key);}
const requireText=(x,message,field=null)=>{if(!String(x||'').trim())throw Object.assign(new Error(message),{field});return String(x).trim();};
export function confirmBasics(p){
 const e=ensureEasy(p);for(const [key,message]of [['product','만들려는 제품을 한 문장으로 적어 주세요.'],['user','누가 사용할지 적거나 아래 선택지를 골라 주세요.'],['goal','사용자가 마칠 핵심 작업을 적어 주세요.']])requireText(p.fields[key].value,message,'easy-'+p.fields[key].id+'-value');
 requireText(e.environment,'컴퓨터·휴대폰 중 사용할 기기를 골라 주세요.','easy-environment');
 for(const key of ['product','user','goal'])set(p,key,p.fields[key].value,p.fields[key].source);
 set(p,'environment',e.environment);set(p,'decisionMaker',p.fields.user.value+' — 별도 구매 담당자는 아직 정하지 않음','user',{dependsOn:[p.fields.user.id],reason:'제품 설명에서 확인한 사용자를 재사용함. 구매 정책은 추가하지 않음'});
 set(p,'value',p.fields.goal.value,'user',{dependsOn:[p.fields.goal.id],reason:'사용자가 마칠 작업을 제공 가치로 재사용함'});
 p.fields.goal.reviewNeeded=false;
 p.type=e.type==='아직 미정'?'기타':e.type;e.type=p.type;touch(p,'제품 설명과 사용할 기기 확인');e.designStage=1;
}
export function confirmFeatures(p){
 const e=ensureEasy(p),names=lines(e.featuresText),later=lines(e.laterText);
 if(!names.length)throw new Error('이번에 필요한 기능을 한 줄에 하나씩 적어 주세요.');
 if(new Set(names.concat(later)).size!==names.length+later.length)throw new Error('같은 기능은 한 번만 적고, 지금 만들지 나중에 만들지 골라 주세요.');
 const help=HELP.find(x=>x[0]===e.help);if(!help)throw new Error('처음 쓰는 사람에게 필요한 도움을 하나 골라 주세요. 아직 몰라도 선택할 수 있습니다.');
 const materials=requireText(e.materials,'작업에 필요한 문구·데이터·이미지 또는 준비 계획을 적어 주세요.');if(e.constraintEnabled)requireText(p.fields.constraints.value,'반드시 지킬 조건을 적거나 추가 조건 포함을 해제해 주세요.','easy-'+p.fields.constraints.id+'-value');
 for(const old of p.features.filter(f=>!names.concat(later).includes(f.value)))updateDecision(p,old,{status:'excluded'});
 for(const [list,priority]of [[names,'이번 범위'],[later,'후속 범위']])for(const value of list){const old=p.features.find(f=>f.value===value),patch={value,priority,purpose:p.fields.goal.value,action:value,info:'사용자가 입력하거나 확인할 정보',flowIds:old?.flowIds||[],status:'confirmed',reviewNeeded:false};if(old)updateDecision(p,old,patch);else p.features.push(decision(value,'user','confirmed',patch));}
 set(p,'scope','지금 만들기: '+names.join(', ')+(later.length?' / 다음에 검토: '+later.join(', '):''));
 set(p,'doubt',help[2],'example');set(p,'evidence',help[3],'example',{dependsOn:[p.fields.doubt.id],reason:'사용자가 직접 선택한 내장 도움 방안. 사용자 조사 결과가 아님'});
 const materialSource=materials==='화면 안내 문구와 작업에 필요한 예시 데이터'?'example':'user';
 let c=p.contents.find(c=>c.easyManaged);if(c)updateDecision(p,c,{value:materials,source:materialSource,status:'confirmed',reviewNeeded:false});else p.contents.push(decision(materials,materialSource,'confirmed',{easyManaged:true,kind:'데이터',availability:'제작 필요',materialType:'제안 문구',content:'실제 파일은 미확보. 구현 과정에서 준비할 계획.',purpose:'핵심 작업에 필요한 안내와 예시',conditions:'샘플과 실제 자료 구별',screenIds:[]}));
 if(e.constraintEnabled)set(p,'constraints',p.fields.constraints.value);else if(p.fields.constraints.status!=='excluded')updateDecision(p,p.fields.constraints,{status:'excluded'});
 p.features.filter(f=>f.status==='confirmed').forEach(f=>f.reviewNeeded=false);
 touch(p,'만들 기능과 자료 준비 계획 확인');p.progress.tab='flow';
}
export function saveEasyFlow(p){
 const e=ensureEasy(p),names=lines(e.flowText);if(names.length<2)throw new Error('사용자가 하는 일을 두 단계 이상 적어 주세요. 같은 화면 안의 행동이어도 됩니다.');
 if(names.length>30)throw new Error('한 흐름은 30단계 이내로 나눠 주세요. 더 큰 프로젝트는 상세 편집에서 흐름을 추가할 수 있습니다.');
 if(!['back','none'].includes(e.back))throw new Error('이전 단계로 돌아갈 수 있는지 골라 주세요.');
 if(!['retry','previous'].includes(e.recovery))throw new Error('실패했을 때 다시 시작할 위치를 골라 주세요.');
 let f=e.newFlow?null:p.flows.find(f=>f.easyManaged);const oldIds=f?.steps||[],source=e.flowSource;
 const screens=names.map((name,i)=>{const existing=p.screens.find(s=>s.id===oldIds[i]);const patch={value:name,role:name+'을 수행하고 현재 진행 상태를 확인',kind:'페이지',entry:i?names[i-1]:'사용자가 작업 시작',priority:name+'에 필요한 정보',actions:name+', '+(i?'이전 단계 확인':'시작'),response:'입력과 선택을 반영하고 현재 상태 표시',next:names[i+1]||(e.loop?names[0]:'완료'),exceptions:'실패한 이유를 알리고 입력을 보존한 채 다시 시도',preserve:'입력한 값·선택·현재 진행 상태',links:existing?.links||[],status:'confirmed',source,reviewNeeded:false};if(existing){updateDecision(p,existing,patch);return existing;}const s=decision(name,source,'confirmed',patch);p.screens.push(s);return s;});
 const patch={value:p.name+' 사용 순서',easyManaged:true,goal:p.fields.goal.value||p.idea||p.name,role:p.fields.user.value||'이 프로젝트를 사용하는 사람',start:names[0],complete:names.at(-1)+'에서 작업 결과를 확인',steps:screens.map(s=>s.id),branch:e.back==='back'?'선택을 바꾸고 싶으면 이전 단계로 돌아감':'다른 경로 없이 순서대로 진행',recovery:e.recovery==='retry'?'실패한 단계에서 입력을 유지하고 다시 시도':'입력과 선택을 유지하고 이전 단계로 돌아가 수정',loop:!!e.loop,status:'confirmed',source,reviewNeeded:false};
 // Build real links from the displayed choices. No fabricated camera/game branches.
 const graph=createGraph(patch);graph.branchPolicy=e.back==='back'?'mapped':'none';graph.branchReason=e.back==='none'?'사용자가 다른 경로 없이 순서대로 진행하기를 선택함':'';
 if(e.back==='back')for(let i=1;i<screens.length;i++)graph.transitions.push({id:uid('edge'),from:screens[i].id,to:screens[i-1].id,kind:'branch',condition:'사용자가 이전 선택을 바꾸려 함',preserve:'입력한 값·선택·현재 진행 상태'});
 graph.recoveryPolicy='mapped';graph.recoveryReason='사용자가 실패 후 재시도 위치를 선택함';
 for(let i=0;i<screens.length;i++)graph.transitions.push({id:uid('edge'),from:screens[i].id,to:screens[e.recovery==='previous'?Math.max(0,i-1):i].id,kind:'recovery',condition:'이 단계의 작업 실패 또는 취소',preserve:'입력한 값·선택·현재 진행 상태'});
 graph.version=(f?.graph?.version||0)+1;graph.reviewedVersion=graph.version;patch.graph=graph;
 if(f)updateDecision(p,f,patch);else{f=decision(patch.value,source,'confirmed',patch);p.flows.push(f);}
 for(const id of oldIds.filter(id=>!patch.steps.includes(id))){const s=p.screens.find(s=>s.id===id);if(!p.flows.some(other=>other.id!==f.id&&other.steps.includes(id)))updateDecision(p,s,{status:'excluded'});}
 // One explicit confirmation covered these screen roles; clearing stale flags is limited to them.
 for(const feature of p.features.filter(d=>confirmed(d)&&d.priority==='이번 범위'))updateDecision(p,feature,{flowIds:[...new Set([...(feature.flowIds||[]),f.id])]});
 f.reviewNeeded=false;screens.forEach(s=>s.reviewNeeded=false);
 touch(p,'화면에 보인 사용 순서·되돌아가기·실패 재시도 확인');e.newFlow=false;p.progress.tab='reference';
}
export function selectEasyStyle(p,index){
 const palette=EASY_STYLES[index];if(!palette)throw new Error('비교할 화면 스타일을 선택하세요.');
 const {id:paletteId,...values}=palette;
 let c=p.concepts.find(c=>c.easyPalette===paletteId);if(!c){c=decision(palette.label,'example','proposed',{...values,easyPalette:paletteId,selected:false,experience:p.fields.goal.value,hero:'프로젝트의 핵심 작업과 실제 콘텐츠',typography:'짧은 제목과 읽기 쉬운 한글 본문',intensity:'작업 화면은 낮은 장식 밀도',resources:'기본 서체와 단색 패널',reference:'사용자가 선택하는 내장 비교 예시. 이미지 분석 아님',assumptions:'실제 결과에서 사용성과 적합성 확인 필요'});p.concepts.push(c);}
 chooseConcept(p,c.id);p.progress.tab='concept';
}
export function confirmDirection(p){
 const e=ensureEasy(p),c=p.concepts.find(c=>c.selected);if(!c)throw new Error('위에서 사용할 화면 스타일을 하나 선택하거나 직접 작성해 주세요.');
 const fit=FIT.find(x=>x[0]===e.fit);if(!fit)throw new Error('이 화면을 고른 이유를 하나 선택해 주세요.');
 const reason=e.fit==='custom'?requireText(e.fitCustom,'직접 고른 이유를 적어 주세요.'):fit[1];
 updateDecision(p,c,{status:'confirmed',reason,reviewNeeded:false});set(p,'fit',reason+' — '+c.value,'user',{dependsOn:[c.id]});
 if(!p.styles.some(s=>s.conceptId===c.id)){applyPalette(p,c);}
 p.progress.tab=['product','user','goal','environment'].every(k=>confirmed(p.fields[k]))?'style':'design';touch(p,'선택한 스타일이 프로젝트에 맞는 이유 확인');
}
export function confirmStyle(p){
 const e=ensureEasy(p),c=p.concepts.find(c=>c.selected),styles=p.styles.filter(s=>s.conceptId===c?.id);
 if(!styles.length)throw new Error('먼저 화면 스타일을 고르거나 상세 편집에서 규칙을 작성해 주세요.');
 const checks=CHECKS.filter(([id])=>e.checks.includes(id)).map(([,text])=>text);if(e.customCheck.trim())checks.push(e.customCheck.trim());
 if(!checks.length)throw new Error('완성된 화면에서 확인할 항목을 하나 이상 골라 주세요.');
 // Switching direction never leaves a previous palette as a conflicting confirmed demand.
 for(const s of styles){if(['배경','본문','강조'].includes(s.role)&&!/^#[0-9a-f]{6}$/i.test(s.value))throw new Error('배경·본문·강조 색은 #315ed4처럼 6자리 색상 값으로 적어 주세요.');}
 for(const old of p.styles.filter(s=>!styles.includes(s)&&s.conceptId&&s.status==='confirmed'))updateDecision(p,old,{status:'excluded'});
 for(const s of styles)updateDecision(p,s,{status:'confirmed',reviewNeeded:false});
 set(p,'criteria',checks.join('\n'));touch(p,'색·글자·배치 규칙과 결과 확인 항목 확정');p.progress.tab=['product','user','goal','environment'].every(k=>confirmed(p.fields[k]))?'brief':'design';
}

function basicsView(p){const e=ensureEasy(p);return `<div class="easy-kicker">제품 설명 · 1 / 2</div><h2>누가 무엇을 할 수 있는 제품인가요?</h2><p class="easy-intro">세 가지 답이면 시작할 수 있어요. 분위기나 디자인 용어는 아직 몰라도 됩니다.</p>${field('만들려는 제품',p.fields.product,'value','예: 입력 신호를 바꾸며 출력 상태를 확인하는 시뮬레이터',true)}${!p.fields.product.value&&p.idea?button('처음 적은 설명 사용하기','original'):''}${field('누가 사용하나요?',p.fields.user,'value','예: 장비를 시험하는 개발자 / 친구들과 게임하는 사람')}<div class="easy-choices">${['나와 동료','초대받은 참가자','누구나 방문해서 사용','아직 몰라요 · 처음 쓰는 사람'].map(t=>button(t,'user',`data-value="${h(t)}"`)).join('')}</div>${field('사용자가 여기서 마칠 핵심 작업',p.fields.goal,'value','예: 입력을 바꾼 뒤 출력 변화를 확인한다.')}<p class="easy-hint">기능 이름 대신 사용자가 할 일을 적으세요. 이 답은 기능과 완료 화면에 다시 쓰입니다.</p>${draft(p,'어떤 기기에서 사용하나요?','environment',{options:[['','선택해 주세요'],['컴퓨터 웹 · 키보드와 마우스 · 한국어','컴퓨터'],['모바일 웹 · 터치 · 한국어','휴대폰'],['컴퓨터와 모바일 웹 · 키보드·마우스·터치 · 한국어','둘 다'],['사용 기기는 미정 · 이후 실제 환경 확인 필요','아직 몰라요']]})}<details class="easy-extra"><summary>제품 분류를 정하고 싶어요 (선택)</summary>${draft(p,'가까운 제품 종류','type',{options:['아직 미정','제작 도구','게임','비교·선택 서비스','설문·참여 서비스','판매 서비스','콘텐츠 서비스','브랜드','기타'].map(x=>[x,x])})}<p>분류를 몰라도 진행할 수 있습니다. 다른 프로젝트의 내용이 자동으로 들어가지 않습니다.</p></details><div class="easy-footer">${button('이 설명으로 필요한 기능 정하기 →','basics','',true)}</div>`;}
function featuresView(p){const e=ensureEasy(p);return `<div class="easy-kicker">제품 설명 · 2 / 2</div><h2>이번에 사용하게 만들 기능만 골라요.</h2>${note(h(p.fields.product.value),'사용자: '+h(p.fields.user.value)+'<br>완료할 일: '+h(p.fields.goal.value))}${draft(p,'지금 만들 기능 · 한 줄에 하나씩','featuresText',{area:true,placeholder:'예: 입력값 변경\n현재 상태 표시\n변경 결과 확인'})}<div class="easy-choices">${button('핵심 작업을 첫 기능으로 사용','goal-feature')}</div><p class="easy-hint">여기에 적은 기능만 이번 디자인에 포함합니다. 로그인·결제·촬영 같은 기능은 자동으로 추가하지 않아요.</p><details class="easy-extra"><summary>나중에 만들 기능도 적어둘래요 (선택)</summary>${draft(p,'다음 버전에서 검토할 기능','laterText',{area:true})}<p>지금 만드는 화면에 추가하라는 요구가 아니라, 다음 작업을 위한 메모입니다.</p></details><h3>처음 쓰는 사람이 어떤 도움을 받으면 좋을까요?</h3><p class="easy-hint">왜 묻나요? 안내·설명·실수 복구 중 무엇을 화면에 넣을지 정하기 위해서예요. 사용자 조사를 했다고 표시하지 않습니다.</p><div class="easy-option-list">${HELP.map(([id,label])=>button(label,'help-choice',`data-value="${id}" aria-pressed="${e.help===id}" class-unused=""`,false)).join('')}</div>${e.help?note('화면에는 이렇게 넣어요',h(HELP.find(x=>x[0]===e.help)?.[3])):''}${draft(p,'작업에 필요한 문구·데이터·이미지 또는 준비 계획','materials',{area:true})}<p class="easy-hint">실제 파일이 없어도 준비할 계획으로 진행할 수 있어요. 파일은 ‘상세 편집 → 콘텐츠와 자료 준비’에서 첨부할 수 있습니다.</p><details class="easy-extra"><summary>반드시 지킬 조건이 있어요 (선택)</summary><label class="easy-check"><input type="checkbox" data-path="progress.easy.constraintEnabled" ${e.constraintEnabled?'checked':''}> 추가 조건을 프롬프트에 포함</label>${field('반드시 지킬 조건',p.fields.constraints,'value','예: 상태는 색만으로 구별하지 않기 / 회원가입 없이 사용하기',true)}<p>계약·접근성·기기 제한처럼 꼭 지켜야 할 조건이 있을 때만 적으세요. 없어도 진행할 수 있습니다.</p></details><div class="easy-footer">${button('← 제품 설명 수정','design-back')}${button('기능 확인하고 사용 순서 만들기 →','features','',true)}</div>`;}
function flowView(p){const e=ensureEasy(p),f=p.flows.find(f=>f.easyManaged);return `<h2>사용자가 하는 일을 순서대로 놓아 보세요.</h2><p class="easy-intro">페이지 수가 아니라 행동 순서예요. 한 화면에서 여러 단계를 해도 괜찮습니다.</p>${note('이 프로젝트에서 마칠 일',h(p.fields.goal.value||p.idea||p.name))}${p.flows.filter(f=>!f.easyManaged&&f.status!=='excluded').map(f=>note(h(f.value),f.steps.map(id=>h(p.screens.find(s=>s.id===id)?.value)).join(' → ')+`<br>${button('이 흐름은 사용하지 않기','exclude-flow',`data-id="${f.id}"`)}`)).join('')}${p.flows.some(f=>!f.easyManaged&&f.status!=='excluded')?'<p class="easy-hint">기존 흐름은 보존합니다. 아래에서는 별도의 사용 순서를 추가할 수 있어요. 기존 상세 연결은 상단 ‘상세 편집’에서 수정합니다.</p>':''}<div class="easy-patterns">${FLOW_PATTERNS.map(t=>`<button class="easy-pattern ${e.flowPattern===t.id?'selected':''}" data-action="easy-pattern" data-id="${t.id}" aria-pressed="${e.flowPattern===t.id}"><strong>${t.label}</strong><small>${t.hint}</small></button>`).join('')}</div><p class="easy-hint">선택한 내장 예시를 복사할 뿐, 입력 내용을 자동 분석하지 않습니다. 아래 내용을 내 프로젝트에 맞게 바꾸세요.</p>${draft(p,'이 프로젝트의 사용 순서 · 한 줄에 한 행동','flowText',{area:true,placeholder:'처음 할 일\n가장 중요한 작업\n완료 후 확인할 것'})}<div class="easy-sequence">${lines(e.flowText).map((s,i)=>`<span><b>${i+1}</b>${h(s)}</span>`).join('<i>→</i>')}</div>${draft(p,'사용자가 이전 선택을 바꾸려 하면?','back',{options:[['','선택해 주세요'],['back','입력을 유지하고 이전 단계로 돌아가게 해요'],['none','다른 경로 없이 순서대로만 진행해요']]})}${draft(p,'입력 오류·불러오기 실패가 나면?','recovery',{options:[['','선택해 주세요'],['retry','입력을 유지하고 같은 단계에서 다시 시도해요'],['previous','입력을 유지하고 이전 단계에서 수정해요']]})}<label class="easy-check"><input type="checkbox" data-path="progress.easy.loop" ${e.loop?'checked':''}> 끝나면 첫 단계부터 반복할 수 있어요</label><p class="easy-hint">이 선택이 실제 다음·이전·재시도 연결로 저장됩니다. 직접 추가할 특별한 조건이 있으면 상세 편집에서 출발 단계와 도착 단계를 고를 수 있어요.</p>${f?note('지금 저장된 순서',f.steps.map(id=>h(p.screens.find(s=>s.id===id)?.value)).join(' → ')):''}<div class="easy-footer">${button('이 순서와 재시도 방법 확인하기 →','flow','',true)}</div>`;}
function sample(p,c){return `<div class="easy-sample" style="background:${h(c.bg)};color:${h(c.text)};--choice-accent:${h(c.accent)};border-radius:${h(c.shape)}"><small>비교용 화면 샘플 · 완성된 제품 아님</small><h3 style="font-family:${['serif','sans-serif','monospace'].includes(c.font)?c.font:'sans-serif'}">${h(p.name)}</h3><p>${h(p.fields.goal.value||'내 프로젝트의 핵심 작업')}</p><div class="easy-sample-panel">${h(p.screens.find(s=>s.status!=='excluded')?.value||'작업할 내용')}<br><small>현재 선택과 진행 상태</small></div><span class="easy-sample-button" style="background:${h(c.accent)};color:white">${h(p.screens.filter(s=>s.status!=='excluded')[1]?.value||'작업 시작하기')}</span></div>`;}
function conceptView(p){const e=ensureEasy(p),c=p.concepts.find(c=>c.selected);return `<h2>${p.entry==='concept'?'정해 둔 방향을 여기서 구체화해요.':'내 작업이 잘 보이는 화면을 골라요.'}</h2><p class="easy-intro">아래는 어떤 프로젝트에도 바꿔 쓸 수 있는 내장 예시입니다. 색뿐 아니라 정보 배치와 글자의 차이도 비교해 보세요.</p>${p.entry==='concept'?'<details class="easy-extra"><summary>다른 화면 스타일도 비교하기 (선택)</summary>':''}<div class="easy-style-cards">${EASY_STYLES.map((s,i)=>`<article class="easy-style-card ${c?.easyPalette===s.id?'selected':''}">${sample(p,s)}<h3>${s.label}</h3><p>${s.summary}</p>${button(c?.easyPalette===s.id?'선택됨':'이 화면 스타일 선택','palette',`data-index="${i}" aria-pressed="${c?.easyPalette===s.id}"`)}</article>`).join('')}</div>${p.entry==='concept'?'</details>':''}<details class="easy-extra" ${p.entry==='concept'&&!c?'open':''}><summary>이미 정한 컨셉을 직접 작성할게요</summary><label class="easy-label" for="easy-concept-name">컨셉 이름</label><input class="input" id="easy-concept-name" value="${h(e.conceptName??(c&&!c.easyPalette?c.value:''))}" placeholder="예: 계기판처럼 명확한 상태 화면"><label class="easy-label" for="easy-concept-summary">어떤 화면이면 좋을까요?</label><textarea class="input" id="easy-concept-summary" placeholder="무엇을 크게 보여 주고 어떤 분위기와 배치를 원하는지 적어 주세요.">${h(e.conceptSummary??(c&&!c.easyPalette?c.summary:''))}</textarea>${button('이 설명을 내 방향으로 사용','custom-concept')}<p>직접 작성한 방향에 기본 색과 글자 조합을 제안합니다. 다음 단계에서 실제 값을 고칠 수 있어요.</p></details>${c?note('선택한 방향: '+h(c.value),h(c.summary)):''}${c?`${draft(p,'이 화면을 고른 이유는?','fit',{options:[['','방향을 고른 다음 선택해 주세요'],...FIT]})}${e.fit==='custom'?draft(p,'내 프로젝트에 어울리는 이유','fitCustom',{area:true}):''}<p class="easy-hint">왜 묻나요? 예쁜 화면이 실제 작업에도 맞는지 확인하기 위해서예요. 방향을 고르기 전에는 답할 필요가 없습니다.</p>`:'<p class="easy-hint">먼저 위에서 화면 스타일을 선택하거나 직접 적어 주세요. 선택한 다음에만 이유를 확인합니다.</p>'}<div class="easy-footer">${button(['product','user','goal','environment'].every(k=>confirmed(p.fields[k]))?'이 방향으로 색과 글자 확인하기 →':'방향 저장하고 만들 제품 설명하기 →','direction','',true)}</div>`;}

function styleRule(s){
 const id='easy-style-'+s.id;
 const options=s.role==='서체'?[['sans-serif','고딕 · 또렷한 글자'],['serif','명조 · 개성 있는 제목'],['monospace','고정폭 · 숫자와 코드']]:s.role==='형태'?[['0px','각진 모서리'],['4px','살짝 둥근 모서리'],['8px','조금 둥근 모서리'],['16px','둥근 모서리'],['24px','많이 둥근 모서리']]:null;
 const color=['배경','본문','강조'].includes(s.role);
 return '<div data-locate="'+s.id+'"><label class="easy-label" for="'+id+'">'+h(s.role==='강조'?'주요 버튼과 선택 표시':s.role==='형태'?'모서리 모양':s.role==='서체'?'제목 글자':s.role)+'</label>'+(options?'<select class="input" id="'+id+'" data-decision="'+s.id+'" data-prop="value" aria-label="'+h(s.role)+'">'+options.map(([v,l])=>'<option value="'+v+'" '+(s.value===v?'selected':'')+'>'+l+'</option>').join('')+'</select>':color?'<div class="easy-color"><input type="color" id="'+id+'" value="'+h(s.value)+'" data-decision="'+s.id+'" data-prop="value" aria-label="'+h(s.role)+' 색상"><code data-color-rule="'+s.id+'">'+h(s.value)+'</code></div>':field(h(s.role),s,'value','',true))+'<small>사용할 곳: '+h(s.scope)+'</small></div>';
}
function styleRules(styles){const basic=styles.filter(s=>['배경','본문','강조','서체','형태'].includes(s.role)),extra=styles.filter(s=>!basic.includes(s));return '<div class="easy-rules">'+basic.map(styleRule).join('')+'</div><details class="easy-extra"><summary>배치·표면·움직임 제안 확인하고 바꾸기 (선택)</summary><p>선택한 방향의 아래 규칙도 함께 포함됩니다. 다음 확인 버튼으로 이 제안을 확정할 수 있어요.</p><div class="easy-rules">'+extra.map(styleRule).join('')+'</div></details>';}

function styleView(p){const e=ensureEasy(p),c=p.concepts.find(c=>c.selected),styles=p.styles.filter(s=>s.conceptId===c?.id);return `<h2>실제 색과 글자를 확인해요.</h2><p class="easy-intro">선택한 방향을 화면에 쓸 값으로 바꿨어요. 아래 제안을 수정한 뒤 확인하면 프롬프트에 포함됩니다.</p>${c?sample(p,{...c,bg:styles.find(s=>s.role==='배경')?.value||c.bg,text:styles.find(s=>s.role==='본문')?.value||c.text,accent:styles.find(s=>s.role==='강조')?.value||c.accent,font:styles.find(s=>s.role==='서체')?.value||c.font,shape:styles.find(s=>s.role==='형태')?.value||c.shape}):note('먼저 화면 스타일을 골라 주세요.','컨셉 탐색에서 내장 예시를 고르거나 직접 방향을 적으면 여기에서 색과 글자를 확인할 수 있어요.')}${!styles.length?go('concept','화면 스타일 고르기'):''}${styleRules(styles)}<h3>완성된 화면에서 무엇을 확인할까요?</h3><p class="easy-hint">나중에 결과를 등록하면 아래 항목으로 비교합니다. 이 프로젝트에서 확인할 것만 고르세요.</p>${CHECKS.map(([id,label])=>`<label class="easy-check"><input type="checkbox" data-action="easy-check" value="${id}" ${e.checks.includes(id)?'checked':''}>${label}</label>`).join('')}${draft(p,'이 프로젝트만의 확인 항목 (선택)','customCheck',{area:true,placeholder:'예: DI 값을 바꿀 때 연결된 DO 값이 규칙대로 표시된다.'})}<div class="easy-footer">${button('이 규칙으로 최종 내용 확인하기 →','style','',true)}</div>`;}
function referenceView(p,files){const r=p.references[0];return `<h2>${r?'좋아하는 부분을 내 화면에 어떻게 쓸까요?':'참고할 이미지가 있나요?'}</h2><p class="easy-intro">이미지가 없어도 진행할 수 있어요. 있으면 ‘어떤 부분을 어디에 쓸지’만 정리합니다.</p>${!r?`<label class="easy-upload">이미지 한 장 선택하기<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="reference" aria-label="레퍼런스 원본 이미지"><small>PNG·JPEG·WebP · 15MB 이하 · 원본을 이 컴퓨터에 저장</small></label>`:`<div class="easy-note"><strong>${h(r.name)}</strong><p>1. 전체 이미지를 선택하거나 원하는 부분을 드래그하세요.<br>2. 눈에 보이는 특징과 적용할 곳을 적으세요.</p></div>${r.fileId&&files.some(f=>f.id===r.fileId&&f.exists)?`<div class="reference-stage" id="reference-stage" data-id="${r.id}"><img id="reference-original" src="/api/projects/${p.id}/files/${r.fileId}" alt="${h(r.name)} 원본">${r.regions.map((a,i)=>`<div class="region-box" style="left:${a.rect.x*100}%;top:${a.rect.y*100}%;width:${a.rect.w*100}%;height:${a.rect.h*100}%"><span>${i+1}</span></div>`).join('')}</div><button class="btn" data-action="whole-region" data-id="${r.id}">이 이미지 전체를 참고하기</button>`:`<p class="error-note">원본 파일을 다시 등록해 주세요. 작성한 메모는 유지됩니다.</p><input type="file" data-upload="replace-reference" data-id="${r.id}" accept="image/png,image/jpeg,image/webp" aria-label="레퍼런스 원본 다시 등록">`}${r.regions.map((a,i)=>`<section class="easy-region" data-locate="${a.id}"><h3>선택한 부분 ${i+1}</h3>${a.fileId&&a.fileId!==r.fileId?'<p class="error-note">원본이 교체되었습니다. 상세 편집에서 새 원본으로 다시 영역을 지정하세요.</p>':''}${field('이미지에서 어떤 특징이 보이나요?',a,'observation','예: 연한 바탕, 큰 숫자, 진한 색 버튼',true)}${field('내 프로젝트의 어디에 쓸까요?',a,'target','예: 상태 표시 패널의 배경과 주요 버튼')}${field('이 특징이 어떤 도움이 되나요?',a,'purpose','예: 현재 값과 조작 버튼을 쉽게 구별하기 위해')}<p class="easy-hint">이미지에 실제로 보이는 특징만 적으세요. 이미지가 설명하지 않는 기능은 내 제품을 위한 별도 설계입니다.</p>${button(confirmed(a)?'이 관찰 다시 확인':'이 특징을 참고할 내용으로 확인','reference-confirm',`data-id="${a.id}"`)}</section>`).join('')}<details class="easy-extra"><summary>출처 URL·다른 이미지·원본 변경 편집하기</summary><p>상단 ‘상세 편집’에서 원본과 선택 영역을 함께 관리할 수 있습니다.</p></details>`}<div class="easy-footer">${go(confirmed(p.fields.product)?'concept':'design',confirmed(p.fields.product)?(r?'저장한 관찰로 화면 스타일 고르기':'이미지 없이 화면 스타일 고르기'):(r?'이 이미지로 만들 제품 설명하기':'이미지 없이 만들 제품 설명하기'))}</div>`;}
function briefView(p,files){const list=issues(p,new Set(files.filter(f=>f.exists).map(f=>f.id)));return `<h2>이 내용으로 디자인을 요청할까요?</h2><p class="easy-intro">앞에서 적은 내용을 다시 입력하지 않아도 돼요. 틀린 부분만 해당 단계에서 고치면 됩니다.</p><dl class="easy-summary">${[['만들 제품',p.fields.product.value],['사용자',p.fields.user.value],['마칠 작업',p.fields.goal.value],['지금 만들 기능',p.features.filter(f=>confirmed(f)&&f.priority==='이번 범위').map(f=>f.value).join(' · ')],['사용 순서',p.flows.filter(confirmed).map(f=>f.steps.map(id=>p.screens.find(s=>s.id===id)?.value).join(' → ')).join('\n')],['화면 스타일',p.concepts.find(c=>c.selected)?.value],['이 스타일을 고른 이유',p.fields.fit.value],['결과 확인 항목',p.fields.criteria.value],['준비할 자료',p.contents.filter(confirmed).map(c=>c.value+' ('+c.availability+')').join('\n')]].map(([label,value])=>`<div><dt>${label}</dt><dd>${h(value||'아직 정하지 않음')}</dd></div>`).join('')}</dl>${list.length?`<div class="easy-note"><strong>확인할 내용 ${list.length}개</strong><p>아래 버튼으로 필요한 단계에 돌아가세요. 지금까지 쓴 내용은 유지됩니다.</p></div>${list.map(i=>`<div class="easy-issue"><p>${h(i.message)}</p>${button('이 내용 확인하기','remedy',`data-tab="${i.tab}" data-id="${h(i.id||'')}"`)}</div>`).join('')}`:note('필요한 입력이 준비되었어요.','이 요약이 내가 만들려는 제품과 맞는지 확인한 다음 프롬프트를 만들 수 있습니다. 실제 디자인 검토는 결과를 등록한 뒤 진행합니다.')}<div class="easy-footer">${button(p.intent?.revision===p.revision?'확인한 내용으로 프롬프트 만들기 →':'요약 확인했어요 · 프롬프트 준비 →','intent','',true)}</div>`;}
export function easyView(p,tab,{files=[]}={}){ensureEasy(p);const views={design:()=>p.progress.easy.designStage===0?basicsView(p):featuresView(p),flow:()=>flowView(p),reference:()=>referenceView(p,files),concept:()=>conceptView(p),style:()=>styleView(p),brief:()=>briefView(p,files)};return views[tab]?`<div class="easy-guide" data-easy-tab="${tab}">${views[tab]()}</div>`:null;}
export function easyNext(p){
 ensureEasy(p);const e=p.progress.easy;
 if(p.entry==='image'&&!p.references.length&&!confirmed(p.fields.product))return {tab:'reference',label:'참고할 이미지 한 장 선택하기',why:'원본을 올린 뒤 마음에 드는 부분과 사용할 곳을 적어요. 이미지 없이도 진행할 수 있습니다.'};
 if(p.entry==='concept'&&!p.concepts.some(c=>c.selected)&&!confirmed(p.fields.product))return {tab:'concept',label:'이미 정한 화면 방향 적기',why:'새로운 컨셉을 고를 필요 없이 알고 있는 방향을 기록하면 됩니다.'};
 if(p.entry==='improve'&&!p.results.length)return {tab:'review',label:'기존 화면과 바꾸고 싶은 점 등록하기',why:'먼저 기대한 모습을 적고, 실제 화면이나 실행 기록과 비교합니다.'};
 if(!['product','user','goal','environment'].every(k=>confirmed(p.fields[k])))return {tab:'design',stage:0,label:'누가 무엇을 할 제품인지 정하기',why:'제품 설명, 사용자, 핵심 작업과 사용할 기기부터 정해요.'};
 if(!p.features.some(f=>confirmed(f)&&f.priority==='이번 범위')||!confirmed(p.fields.evidence))return {tab:'design',stage:1,label:'이번에 만들 기능만 정하기',why:'필요한 기능과 처음 쓰는 사람에게 줄 도움을 골라요.'};
 if(!p.flows.some(confirmed))return {tab:'flow',label:'내 프로젝트의 사용 순서 만들기',why:'한 줄에 행동 하나씩 적거나 가까운 예시를 골라 바꿔요.'};
 if(!p.concepts.some(c=>c.selected)||!confirmed(p.fields.fit))return {tab:'concept',label:'작업에 맞는 화면 스타일 고르기',why:'내 프로젝트의 내용으로 배치와 글자의 차이를 비교해요.'};
 if(!p.styles.some(confirmed)||!confirmed(p.fields.criteria))return {tab:'style',label:'색·글자와 결과 확인 항목 정하기',why:'실제 값을 확인하고 완성 후 확인할 것을 골라요.'};
 if(!p.intent||p.intent.revision!==p.revision)return {tab:'brief',label:'지금까지 정한 내용 한 번 확인하기',why:'빠진 곳만 보완하고, 의도와 맞으면 프롬프트를 준비해요.'};
 return {tab:'prompt',label:'확인한 내용으로 프롬프트 만들기',why:'외부 도구에 직접 전달할 문서와 파일을 가져갈 수 있어요.'};
}
export function handleEasy(p,el,ctx){
 const e=ensureEasy(p),action=el.dataset.action.slice(5);let top=true;
 switch(action){
 case 'original':updateDecision(p,p.fields.product,{value:p.idea,source:'user',status:'proposed'});break;
 case 'user':updateDecision(p,p.fields.user,{value:el.dataset.value,source:'example',status:'proposed'});break;
 case 'basics':confirmBasics(p);break;
 case 'design-back':e.designStage=0;break;
 case 'goal-feature':e.featuresText=p.fields.goal.value;break;
 case 'help-choice':e.help=el.dataset.value;top=false;break;
 case 'features':confirmFeatures(p);break;
 case 'pattern':{const preset=FLOW_PATTERNS.find(x=>x.id===el.dataset.id);if(!preset)throw new Error('사용 순서 예시가 없습니다.');if(e.flowText&&e.flowText!==preset.steps){e.patternPending=preset.id;ctx.modal('사용 순서 예시 바꾸기',`<p>지금 적은 순서는 변경 전 기록에 보관하고 선택한 내장 예시로 바꿉니다. 제품 설명과 기능은 유지됩니다.</p>${button('현재 순서 유지','pattern-cancel')}${button('선택한 예시로 바꾸기','pattern-confirm','',true)}`);return;}e.flowPattern=preset.id;e.flowText=preset.steps;e.flowSource=preset.id==='custom'?'user':'example';top=false;break;}
 case 'pattern-cancel':delete e.patternPending;ctx.close();return;
 case 'pattern-confirm':{const preset=FLOW_PATTERNS.find(x=>x.id===e.patternPending);e.flowDraftHistory??=[];e.flowDraftHistory.push({text:e.flowText,source:e.flowSource,at:new Date().toISOString()});e.flowPattern=preset.id;e.flowText=preset.steps;e.flowSource=preset.id==='custom'?'user':'example';delete e.patternPending;ctx.close();break;}
 case 'flow':saveEasyFlow(p);break;
 case 'exclude-flow':{const f=p.flows.find(f=>f.id===el.dataset.id);if(!f)throw new Error('제외할 사용 순서를 찾지 못했습니다.');updateDecision(p,f,{status:'excluded'});for(const id of f.steps){const s=p.screens.find(s=>s.id===id);if(s&&!p.flows.some(other=>other.id!==f.id&&other.status!=='excluded'&&other.steps.includes(id)))updateDecision(p,s,{status:'excluded'});}break;}
 case 'palette':selectEasyStyle(p,Number(el.dataset.index));top=false;break;
 case 'custom-concept':{const value=requireText(document.querySelector('#easy-concept-name').value,'컨셉 이름을 적어 주세요.'),summary=requireText(document.querySelector('#easy-concept-summary').value,'원하는 화면을 한 문장으로 적어 주세요.');let c=p.concepts.find(c=>c.easyCustom);const {id:presetId,...palette}=EASY_STYLES[0];const base={...palette,value,summary,easyPalette:null,easyCustom:true};if(c)updateDecision(p,c,base);else{c=decision(value,'user','proposed',base);p.concepts.push(c);}chooseConcept(p,c.id);top=false;break;}
 case 'direction':confirmDirection(p);break;
 case 'check':e.checks=el.checked?[...new Set([...e.checks,el.value])]:e.checks.filter(v=>v!==el.value);top=false;break;
 case 'style':confirmStyle(p);break;
 case 'reference-confirm':{const a=p.references.flatMap(r=>r.regions).find(a=>a.id===el.dataset.id);for(const [key,label]of [['observation','이미지에서 보이는 특징'],['target','내 프로젝트에 쓸 위치'],['purpose','어떤 도움이 되는지']])requireText(a?.[key],label+'를 적어 주세요.');const r=p.references.find(r=>r.regions.includes(a));if(a.fileId&&a.fileId!==r.fileId)throw new Error('새 원본에서 선택 영역을 다시 지정해 주세요. 상세 편집에서 원본을 확인할 수 있습니다.');updateDecision(p,a,{value:a.observation,status:'confirmed',source:'observation',reviewNeeded:false});top=false;break;}
 case 'remedy':{p.progress.returnTo={tab:'brief',guideStage:p.progress.guideStage};const q=Object.entries(p.fields).find(([key,d])=>key===el.dataset.id||d.id===el.dataset.id);p.progress.tab=q&&['fit','criteria'].includes(q[0])?(q[0]==='fit'?'concept':'style'):el.dataset.tab;if(p.progress.tab==='design')e.designStage=q&&['product','user','goal','environment','decisionMaker','value'].includes(q[0])?0:1;ctx.changed();ctx.render();ctx.locate(q?q[1].id:el.dataset.id);return;}
 case 'intent':{const list=issues(p,new Set(ctx.files.filter(f=>f.exists).map(f=>f.id)));if(list.length)throw new Error('위에 표시된 '+list.length+'개 내용을 먼저 확인해 주세요.');p.intent={choice:'match',reason:'사용자가 요약에 표시된 제품·사용자·기능·사용 순서·화면 스타일·확인 항목을 읽고 이 내용으로 요청하기를 선택함',revision:p.revision,at:new Date().toISOString()};p.progress.tab='prompt';break;}
 default:return;
 }
 ctx.changed();ctx.render();if(top)window.scrollTo(0,0);
}
