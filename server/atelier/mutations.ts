import type { Project, Decision, Flow, PlanFields } from '../../shared/atelier/types.js';
import { PALETTES } from '../../shared/atelier/guide.js';
import { domain, decisionRules, graph, rect, planFields } from './validation.js';
import { check } from './errors.js';
import * as s from './schema.js';

export const editableKinds=['fields','features','contents','flows','screens','references','regions','concepts','styles','assets'] as const;
export type EditableKind=typeof editableKinds[number];
const common=['value','reason','scope','dependsOn','screenIds','flowIds','assetIds','referenceIds','regionIds','appliesTo','scopeMode','conceptId','fontAssetId'];
const perKind: Record<EditableKind,string[]> = {
  fields:['value','reason','scope'],features:['priority','purpose','action','info','flowIds'],contents:['kind','purpose','availability','content','conditions','materialType','screenIds','fileId','fileIds'],
  flows:['goal','role','start','steps','branch','recovery','complete','loop','graph'],screens:['kind','role','entry','priority','actions','response','next','exceptions','preserve','links'],
  references:['name','url','fileId','note','role','dependsOn'],regions:['fileId','cropId','rect','dimension','observation','interpretation','target','purpose','keep','change','avoid','useMode','appliesTo'],
  concepts:['summary','experience','hero','bg','text','accent','font','shape','typography','material','layout','motion','intensity','resources','reference','assumptions'],styles:['role','exception','fontAssetId'],assets:['kind','purpose','method','availability','rules','sourceUrl','usage','review','fileId','fileIds','referenceIds']
};
const edgePatch=s.shape({id:s.optional(s.id),from:s.text(90),to:s.text(90),kind:s.one(['next','branch','recovery','loop']),condition:s.text(),preserve:s.text()});
export const graphPatch=s.shape({entryId:s.text(90),terminalIds:s.ids,transitions:s.array(edgePatch,2048),branchPolicy:s.one(['pending','mapped','none']),recoveryPolicy:s.one(['pending','mapped','none']),branchReason:s.text(),recoveryReason:s.text()});
export function entityPatch(kind: EditableKind,value: unknown,adding=false) {
  const keys=kind==='references'?perKind[kind]:[...common,...perKind[kind]];
  const rules:Record<string,s.Rule>={};
  for(const key of keys) rules[key]=s.optional(key==='graph'?graphPatch:kind==='references'&&['url','note','name','role'].includes(key)?(key==='name'?s.label(180):s.text()):decisionRules[key]||s.json);
  if(kind==='regions'&&adding)rules.referenceId=s.id;
  s.shape(rules)(value); return s.obj(value);
}
function list(p: Project,kind: EditableKind) {
  return kind==='fields'?Object.values(p.fields):kind==='regions'?p.references.flatMap(r=>r.regions):p[kind];
}
export function mutateEntity(p: Project,payload: s.Obj) {
  const kind=payload.kind as EditableKind,action=String(payload.action),id=payload.entityId as string | undefined;
  check(editableKinds.includes(kind),'독립 명령으로 처리해야 하는 데이터입니다.');
  const collection=list(p,kind);
  const node=kind==='fields'?p.fields[id as keyof Project['fields']]||collection.find(d=>d.id===id):collection.find(d=>d.id===id);
  if(action==='add') {
    check(kind!=='fields' && !id && !payload.order,'새 field key 또는 클라이언트 ID를 만들 수 없습니다.');
    const patch=entityPatch(kind,payload.value||{},true);
    let d:Decision;
    if(kind==='references') { p.references.push({id:domain.uid('ref'),name:String(patch.name||'레퍼런스'),url:'',fileId:null,note:'',role:'',regions:[],dependsOn:[],...patch}); }
    else {
      const defaults:Record<string,unknown>= kind==='flows'?{goal:'',role:'',start:'',steps:[],branch:'',recovery:'',complete:'',loop:false}:kind==='screens'?{kind:'페이지',role:'',entry:'',priority:'',actions:'',response:'',next:'',exceptions:'',preserve:'',links:[]}:kind==='features'?{priority:'이번 범위',purpose:'',action:'',info:'',flowIds:[]}:{};
      d=domain.decision('',kind==='regions'?'observation':'user','unknown',{...defaults,...patch});
      if(kind==='flows') {
        const flow=d as Flow;
        if(patch.graph){const g=s.obj(patch.graph);const transitions=(g.transitions as s.Obj[]).map(e=>{check(!e.id,'새 흐름의 연결 ID는 서버가 만듭니다.');return {...e,id:domain.uid('edge')};});flow.graph={...g,transitions,version:1,reviewedVersion:0} as unknown as NonNullable<Flow['graph']>;graph(flow.graph);}
        else flow.graph=domain.createGraph(flow);
        p.flows.push(flow);
      }
      else if(kind==='screens') p.screens.push(d as Project['screens'][number]);
      else if(kind==='features')p.features.push(d as Project['features'][number]);
      else if(kind==='regions') { const ref=p.references.find(r=>r.id===patch.referenceId); check(ref,'소속 레퍼런스가 없습니다.','PROJECT_MISMATCH'); check(patch.fileId===ref.fileId,'영역 원본이 레퍼런스와 다릅니다.'); delete (d as unknown as s.Obj).referenceId; p.references.find(r=>r.id===ref.id)!.regions.push(d); }
      else p[kind].push(d);
    }
    domain.touch(p,'설계 항목 추가'); return;
  }
  if(action==='reorder') {
    check(kind!=='fields' && kind!=='regions' && !id && !payload.value); s.ids(payload.order);
    const order=payload.order as string[];check(order.length===collection.length && new Set(order).size===collection.length && order.every(i=>collection.some(d=>d.id===i)),'정렬 목록이 현재 항목과 다릅니다.');
    const target=p[kind];target.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));domain.touch(p,'설계 항목 순서 변경');return;
  }
  check(node,'설계 항목이 없습니다.','NOT_FOUND');check(!payload.order);
  if(action==='remove') {
    check(kind!=='fields' && !payload.value);
    if(kind==='regions')for(const ref of p.references)ref.regions=ref.regions.filter(d=>d.id!==node.id);
    else { const target=p[kind];const index=target.findIndex(d=>d.id===node.id);target.splice(index,1); }
    domain.touch(p,'설계 항목 제거',[node.id]); return;
  }
  if(kind==='references') {
    check(action==='patch','레퍼런스 자체는 결정 확정 대상이 아닙니다.');
    const patch=entityPatch(kind,payload.value);Object.assign(node,patch);domain.touch(p,'레퍼런스 변경',[node.id]); return;
  }
  const d=node as Decision;
  if(action==='confirm'||action==='exclude') { check(!payload.value);domain.updateDecision(p,d,{status:action==='confirm'?'confirmed':'excluded',reviewNeeded:false});return; }
  if(action==='selectConcept') { check(kind==='concepts'&&!payload.value);domain.chooseConcept(p,d.id);return; }
  if(action==='acknowledgeGraph') { check(kind==='flows'&&!payload.value);const flow=d as Flow,g=structuredClone(flow.graph||domain.createGraph(flow));g.reviewedVersion=g.version;check(domain.graphIssues(p,{...flow,graph:g}).length===0,'흐름의 분기·복구·연결을 확인하세요.','INVALID_SELECTION');domain.acknowledgeGraph(p,flow);return; }
  if(action==='applyPalette') { check(kind==='concepts'); s.shape({paletteIndex:s.integer(0,PALETTES.length-1)})(payload.value);domain.applyPalette(p,{...PALETTES[Number(s.obj(payload.value).paletteIndex)],id:d.id});return; }
  check(action==='patch','지원하지 않는 변경 명령입니다.');
  const patch=entityPatch(kind,payload.value);
  if(kind==='flows'&&patch.graph) {
    const flow=d as Flow,g=s.obj(patch.graph),old=flow.graph||domain.createGraph(flow);
    const transitions=(g.transitions as s.Obj[]).map(e=>{
      if(e.id)check(old.transitions.some(item=>item.id===e.id),'다른 흐름의 연결 ID입니다.','PROJECT_MISMATCH');
      return {...e,id:e.id||domain.uid('edge')};
    });
    patch.graph={...g,transitions,version:old.version+1,reviewedVersion:old.reviewedVersion};graph(patch.graph);
  }
  domain.updateDecision(p,d,patch as Partial<Decision>);
  if(patch.graph&&d.status==='confirmed')d.reviewNeeded=true;
}
export function validatePlanFields(value: unknown): PlanFields { planFields(value);return value as PlanFields; }
export function validateRegion(value: unknown) { rect(value); }
