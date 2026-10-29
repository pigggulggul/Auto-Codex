// Additive project structures. Existing snapshots are never migrated or mutated.
const id=prefix=>prefix+'_'+crypto.randomUUID();
const copy=x=>structuredClone(x);
const active=d=>d?.status==='confirmed'&&!!d.value?.trim();
export const TRANSITION_KINDS={next:'기본 진행',branch:'조건 분기',recovery:'실패·취소 복구',loop:'반복'};

export function createGraph(flow,{example=false}={}){
 const steps=flow.steps||[];
 const transitions=steps.slice(1).map((to,i)=>({id:id('edge'),from:steps[i],to,kind:'next',condition:'',preserve:''}));
 if(flow.loop&&steps.length)transitions.push({id:id('edge'),from:steps.at(-1),to:steps[0],kind:'loop',condition:'다음 반복 시작',preserve:'현재까지의 작업과 진행 데이터'});
 if(example&&steps.length>2){
  transitions.push({id:id('edge'),from:steps[1],to:steps[0],kind:'branch',condition:flow.branch,preserve:'이전에 선택한 조건과 진행 상태'});
  transitions.push({id:id('edge'),from:steps.at(-1),to:steps[Math.max(0,steps.length-2)],kind:'recovery',condition:flow.recovery,preserve:'원본과 현재 편집·진행 데이터'});
 }
 return {version:1,reviewedVersion:example?1:0,entryId:steps[0]||'',terminalIds:steps.length?[steps.at(-1)]:[],transitions,
  branchPolicy:example?'mapped':'pending',branchReason:example?'내장 예시, 사용자 확인 후 적용':'',
  recoveryPolicy:example?'mapped':'pending',recoveryReason:example?'내장 예시, 사용자 확인 후 적용':''};
}

export function upgradeProject(p){
 if(!p||p.schemaVersion!==1)return p;
 p.modelVersion=2;p.output.selection??={mode:'all',ids:[]};
 for(const list of [Object.values(p.fields),p.features,p.contents,p.flows,p.screens,p.styles,p.assets,p.concepts])for(const d of list||[])d.dependsOn??=[];
 for(const f of p.flows||[])if(!f.graph)f.graph=createGraph(f);
 for(const r of p.references||[]){r.dependsOn??=[];for(const a of r.regions){a.dependsOn??=[];a.appliesTo??=[];}}
 return p;
}

export function graphIssues(p,f){
 const result=[],add=(code,message,id=f.id)=>result.push({code,message:`${f.value}: ${message}`,tab:'flow',id,severity:'blocking'});
 const g=f.graph;if(!g){add('graph-migration','기존 단계 메모를 연결 구조로 확인해 주세요.');return result;}
 const steps=new Set(f.steps||[]),screens=new Set(p.screens.map(s=>s.id));
 if(!steps.has(g.entryId))add('graph-entry','시작 화면을 흐름 안의 화면으로 지정하세요.');
 if(!g.terminalIds?.length)add('graph-terminal','완료 화면 또는 반복의 확인 지점을 하나 이상 지정하세요.');
 for(const s of g.terminalIds||[])if(!steps.has(s))add('graph-terminal','확인 지점이 이 흐름에 없습니다.');
 const edges=g.transitions||[],seen=new Set();
 for(const e of edges){
  if(seen.has(e.id))add('graph-duplicate','중복된 연결 식별자입니다.');seen.add(e.id);
  if(!steps.has(e.from)||!steps.has(e.to)||!screens.has(e.from)||!screens.has(e.to))add('graph-reference','연결의 출발·도착 화면을 흐름 안에서 선택하세요.',f.id);
  if(!TRANSITION_KINDS[e.kind])add('graph-kind','연결 종류를 선택하세요.');
  if(e.kind!=='next'&&!e.condition?.trim())add('graph-condition','분기·복구·반복에는 발생 조건이 필요합니다.');
  if(e.kind==='recovery'&&!e.preserve?.trim())add('graph-preserve','복구할 때 유지할 데이터를 적으세요.');
 }
 for(const key of ['branch','recovery']){
  const policy=g[key+'Policy'];
  if(policy==='pending'||!policy)add('graph-policy',`${key==='branch'?'분기':'실패·복구'}를 실제 연결로 정리하거나 해당 없음을 이유와 함께 선택하세요.`);
  else if(policy==='mapped'&&!edges.some(e=>e.kind===(key==='branch'?'branch':'recovery')))add('graph-policy',`${key==='branch'?'분기':'복구'} 연결을 하나 이상 추가하세요.`);
  else if(policy==='none'&&!g[key+'Reason']?.trim())add('graph-policy','해당 없음의 이유를 남겨 주세요.');
  if(policy==='none'&&edges.some(e=>e.kind===(key==='branch'?'branch':'recovery')))add('graph-policy','해당 없음과 실제 연결이 충돌합니다.');
 }
 const valid=edges.filter(e=>steps.has(e.from)&&steps.has(e.to));
 const visit=(roots,reverse=false)=>{const reached=new Set(roots),queue=[...roots];while(queue.length){const n=queue.shift();for(const e of valid){const from=reverse?e.to:e.from,to=reverse?e.from:e.to;if(from===n&&!reached.has(to)){reached.add(to);queue.push(to);}}}return reached;};
 const reached=visit([g.entryId]),finishes=visit(g.terminalIds||[],true);
 for(const s of steps){const name=p.screens.find(x=>x.id===s)?.value||s;if(!reached.has(s))add('graph-unreachable',`${name}에 시작 지점에서 도달할 수 없습니다.`,s);else if(!finishes.has(s))add('graph-dead-end',`${name}에서 완료·반복 확인 지점으로 돌아갈 수 없습니다.`,s);}
 if(g.reviewedVersion!==g.version)add('graph-unreviewed','변경한 연결·분기·복구 기준을 다시 확인하세요.');
 return result;
}

export function decisionNodes(p){return [...Object.values(p.fields),...p.features,...p.flows,...p.screens,...p.contents,...p.styles,...p.assets,...p.concepts,...p.references,...p.references.flatMap(r=>r.regions)];}

export function dependencyEdges(p){
 const edges=[],add=(from,to,reason)=>{if(from&&to&&from!==to&&!edges.some(e=>e.from===from&&e.to===to))edges.push({from,to,reason});};
 const f=p.fields;
 for(const [from,tos]of Object.entries({user:['goal','doubt','evidence','fit'],value:['goal','doubt','evidence','fit'],decisionMaker:['doubt','evidence'],doubt:['evidence','fit']}))for(const to of tos)add(f[from]?.id,f[to]?.id,'고객·목표 맥락');
 for(const d of p.features)add(f.scope?.id,d.id,'이번 기능 범위');
 for(const flow of p.flows){add(f.goal?.id,flow.id,'전체 목표');add(f.user?.id,flow.id,'사용자 역할');for(const s of flow.steps)add(flow.id,s,'흐름과 화면 역할');}
 for(const feature of p.features)for(const flow of feature.flowIds||[])add(feature.id,flow,'기능이 필요한 흐름');
 for(const r of p.references)for(const a of r.regions){add(r.id,a.id,'원본과 선택 영역');for(const target of a.appliesTo||[])add(a.id,target,'레퍼런스 적용 대상');}
 for(const d of decisionNodes(p)){
  for(const from of d.dependsOn||[])add(from,d.id,'사용자가 연결한 근거');
  for(const screen of d.screenIds||[])add(screen,d.id,'화면별 적용·자료');
  for(const ref of d.referenceIds||[])add(ref,d.id,'기준 레퍼런스');
  for(const region of d.regionIds||[])add(region,d.id,'기준 선택 영역');
  for(const asset of d.assetIds||[])add(asset,d.id,'관련 리소스');
  if(d.conceptId)add(d.conceptId,d.id,'선택 컨셉');
  if(d.fontAssetId)add(d.fontAssetId,d.id,'실제 서체 파일');
 }
 return edges;
}

export function impactedIds(p,roots){
 const graph=dependencyEdges(p),visited=new Set(roots),queue=[...roots],result=[];
 while(queue.length){const n=queue.shift();for(const e of graph)if(e.from===n&&!visited.has(e.to)){visited.add(e.to);queue.push(e.to);result.push(e.to);}}
 return result;
}

export function criterionDependencies(p){return {
 intent:[p.fields.product.id,p.fields.goal.id,...p.flows.filter(active).map(d=>d.id)],
 customer:[p.fields.user.id,p.fields.value.id,p.fields.doubt.id,p.fields.evidence.id,...p.contents.filter(active).map(d=>d.id)],
 fit:[p.fields.fit.id,...p.concepts.filter(c=>c.selected&&active(c)).map(d=>d.id)],
 style:p.styles.filter(active).map(d=>d.id),scope:[...p.styles,...p.screens].filter(active).map(d=>d.id),
 reference:p.references.filter(r=>r.regions.some(active)).flatMap(r=>[r.id,...r.regions.filter(active).map(d=>d.id)]),
 interaction:[...p.flows,...p.screens,...p.features].filter(active).map(d=>d.id),
 consistency:[...p.styles,...p.assets,...p.contents,...p.screens].filter(active).map(d=>d.id)
};}

export function propagateImpact(p,roots,reason){
 const ids=impactedIds(p,roots),nodes=decisionNodes(p);
 for(const id of ids){const d=nodes.find(d=>d.id===id);if(d?.status==='confirmed')d.reviewNeeded=true;}
 const changed=new Set([...roots,...ids]);
 for(const review of p.reviews){const snap=p.snapshots.find(s=>s.id===review.snapshotId);if(!snap)continue;
  const dependencies=criterionDependencies(snap.input||p),criteria=review.items.filter(i=>(i.decisionIds||dependencies[i.id]||[]).some(id=>changed.has(id))).map(i=>i.id);
  if(criteria.length)review.recheck={decisionIds:[...new Set([...(review.recheck?.decisionIds||[]),...changed])],criterionIds:[...new Set([...(review.recheck?.criterionIds||[]),...criteria])],reason,at:new Date().toISOString()};
 }
 p.lastImpact={roots:[...roots],decisionIds:ids,reason,at:new Date().toISOString()};return ids;
}

export function selectionIssues(p){
 const s=p.output.selection||{mode:'all',ids:[]},out=[],add=message=>out.push({code:'output-selection',message,tab:'prompt',severity:'blocking'});
 if(!['all','flows','screens','assets'].includes(s.mode)){add('지원하지 않는 출력 대상입니다.');return out;}
 if(s.mode==='all')return out;
 const list=p[s.mode];if(!s.ids?.length)add('출력할 실제 대상을 하나 이상 선택하세요.');
 for(const id of s.ids||[]){const item=list.find(d=>d.id===id);if(!item)add('선택한 출력 대상이 프로젝트에 없습니다.');else if(!active(item))add(`${item.value}: 출력 대상의 확정이 필요합니다.`);}
 return out;
}

export function selectScope(original){
 const p=copy({...original,snapshots:[],results:[],reviews:[],plans:[]}),selection=p.output.selection||{mode:'all',ids:[]};
 const selected=new Set(selection.ids||[]),mode=selection.mode;
 if(mode==='all')return {project:p,selection,contexts:[],omitted:[]};
 let flowIds=new Set(),screenIds=new Set(),assetIds=new Set(),contexts=[];
 if(mode==='flows'){flowIds=selected;for(const f of p.flows.filter(f=>selected.has(f.id)))for(const s of f.steps)screenIds.add(s);}
 if(mode==='screens'){screenIds=selected;flowIds=new Set(p.flows.filter(f=>f.steps.some(s=>selected.has(s))).map(f=>f.id));}
 if(mode==='assets'){assetIds=selected;for(const a of p.assets.filter(a=>selected.has(a.id)))for(const s of a.screenIds||[])screenIds.add(s);flowIds=new Set(p.flows.filter(f=>f.steps.some(s=>screenIds.has(s))).map(f=>f.id));}
 const matching=d=>{if(d.scopeMode==='global')return true;
  const screens=d.screenIds||[],flows=d.flowIds||[],assets=d.assetIds||[];
  if(screens.length||flows.length||assets.length)return screens.some(id=>screenIds.has(id))||flows.some(id=>flowIds.has(id))||assets.some(id=>assetIds.has(id));
  return d.scopeMode!=='targets';
 };
 const named=id=>original.screens.find(s=>s.id===id)?.value||id;
 for(const f of p.flows.filter(f=>flowIds.has(f.id)))contexts.push({id:f.id,name:f.value,goal:f.goal,path:f.steps.map(named),boundaries:(f.graph?.transitions||[]).filter(e=>screenIds.has(e.from)!==screenIds.has(e.to)).map(e=>({...e,fromName:named(e.from),toName:named(e.to)}))});
 p.flows=mode==='flows'?p.flows.filter(f=>flowIds.has(f.id)):[];
 p.screens=mode==='assets'?[]:p.screens.filter(s=>screenIds.has(s.id));
 p.features=p.features.filter(matching);
 p.contents=mode==='assets'?[]:p.contents.filter(matching);
 p.assets=mode==='assets'?p.assets.filter(a=>assetIds.has(a.id)):p.assets.filter(matching);
 p.styles=p.styles.filter(matching);
 // A font is an explicit supporting attachment even when its own screen is not selected.
 for(const d of p.styles)if(d.fontAssetId&&!p.assets.some(a=>a.id===d.fontAssetId)){const asset=original.assets.find(a=>a.id===d.fontAssetId);if(asset)p.assets.push(copy(asset));}
 const included=new Set([...p.features,...p.contents,...p.assets,...p.styles,...p.screens,...p.flows].filter(active).map(d=>d.id));
 const observes=a=>a.appliesTo?.length?a.appliesTo.some(id=>included.has(id)||screenIds.has(id)):matching(a);
 p.references=p.references.map(r=>({...r,regions:r.regions.filter(observes)})).filter(r=>r.regions.some(active)||[...p.assets,...p.contents,...p.styles].some(d=>d.referenceIds?.includes(r.id)));
 const requiredConcepts=new Set(p.styles.map(d=>d.conceptId).filter(Boolean));
 p.concepts=p.concepts.filter(c=>c.selected||requiredConcepts.has(c.id));
 const kept=new Set(decisionNodes(p).map(d=>d.id)),basis=[...(p.scopeBasis||[])],basisIds=new Set(basis.map(d=>d.id)),sources=[...decisionNodes(original),...(original.scopeBasis||[])];
 const queue=decisionNodes(p).filter(active).flatMap(d=>d.dependsOn||[]);
 while(queue.length){const id=queue.shift();if(kept.has(id)||basisIds.has(id))continue;const source=sources.find(d=>d.id===id);if(!source||!active(source))continue;basisIds.add(id);const record=copy(source);record.history=[];basis.push(record);queue.push(...(source.dependsOn||[]));}
 p.scopeBasis=basis;
 for(const id of basisIds)kept.add(id);
 const omitted=decisionNodes(original).filter(d=>!kept.has(d.id)).map(d=>({id:d.id,value:d.value||d.name}));
 return {project:p,selection,contexts,omitted};
}

export function attachmentIds(p){
 const ids=new Set(),add=id=>{if(id)ids.add(id);};
 for(const r of p.references){if(r.regions.some(active)||[...p.assets,...p.contents,...p.styles].some(d=>active(d)&&d.referenceIds?.includes(r.id))){add(r.fileId);for(const a of r.regions.filter(active)){add(a.fileId);add(a.cropId);}}}
 for(const d of [...p.assets,...p.contents,...p.styles].filter(active)){add(d.fileId);for(const id of d.fileIds||[])add(id);}
 for(const d of (p.scopeBasis||[]).filter(active)){add(d.fileId);add(d.cropId);for(const id of d.fileIds||[])add(id);}
 return [...ids];
}

export function currentInput(project){
 const p=copy({...project,snapshots:[],results:[],reviews:[],plans:[],activity:[]});
 delete p.lastImpact;delete p.restoredFrom;
 p.progress={tab:'prompt',guideStage:0,returnTo:null};
 for(const d of [...decisionNodes(p),...(p.scopeBasis||[])])d.history=[];
 return p;
}

