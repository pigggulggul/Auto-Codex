import type { Project } from '../../shared/atelier/types.js';
import { createDomain } from '../../shared/atelier/domain.js';
import { QUESTIONS, TYPES } from '../../shared/atelier/guide.js';
import { randomUUID } from 'node:crypto';
import { check } from './errors.js';
import * as s from './schema.js';
import { BACKUP_LIMIT } from './resources.js';
export const domain = createDomain({id: prefix => `${prefix}_${randomUUID()}`, now: () => new Date().toISOString()});
export const finite: s.Rule = v => check(typeof v === 'number' && Number.isFinite(v));
export const rect = s.shape({x:finite,y:finite,w:finite,h:finite});
const statuses = ['unknown','proposed','confirmed','excluded'];
const sources = ['user','example','observation','external'];
const linkKeys = ['dependsOn','screenIds','flowIds','assetIds','referenceIds','regionIds','appliesTo','fileIds'];
const strings = ['kind','role','priority','purpose','action','info','content','conditions','materialType','availability','method','rules','sourceUrl','usage','review','exception','summary','experience','hero','bg','text','accent','font','shape','layout','material','motion','typography','intensity','resources','reference','assumptions','label','name','observation','interpretation','dimension','target','keep','change','avoid','useMode','goal','start','branch','recovery','complete','entry','response','next','exceptions','preserve','actions'];
const maybe = (keys: string[], rule: s.Rule) => Object.fromEntries(keys.map(k => [k,s.optional(rule)]));
export const transition = s.shape({id:s.id,from:s.text(90),to:s.text(90),kind:s.one(['next','branch','recovery','loop']),condition:s.text(),preserve:s.text()});
export const graph: s.Rule = v => {
  s.shape({version:s.integer(1),reviewedVersion:s.integer(),entryId:s.text(90),terminalIds:s.ids,transitions:s.array(transition,2048),branchPolicy:s.one(['pending','mapped','none']),recoveryPolicy:s.one(['pending','mapped','none']),branchReason:s.text(),recoveryReason:s.text()})(v);
  const g = s.obj(v); check(Number(g.reviewedVersion) <= Number(g.version));
  const edges = g.transitions as s.Obj[]; check(new Set(edges.map(e=>e.id)).size === edges.length,'흐름 연결 ID가 중복되었습니다.');
};
const history=s.shape({...maybe(['value','scope','reason'],s.text()),version:s.optional(s.integer()),status:s.optional(s.one(statuses)),source:s.optional(s.one(sources)),at:s.optional(s.text(64)),...maybe(linkKeys,s.ids),conceptId:s.optional(s.nullable(s.id)),fontAssetId:s.optional(s.nullable(s.id)),scopeMode:s.optional(s.one(['global','targets'])),fileId:s.optional(s.nullable(s.id)),cropId:s.optional(s.nullable(s.id)),rect:s.optional(rect),graph:s.optional(graph)});
export const decisionRules: Record<string,s.Rule> = {
  id:s.id,version:s.integer(1),value:s.text(),status:s.one(statuses),source:s.one(sources),reason:s.text(),scope:s.text(),reviewNeeded:s.bool,
  ...maybe(linkKeys,s.ids), ...maybe(strings,s.text()), scopeMode:s.optional(s.one(['global','targets'])),
  conceptId:s.optional(s.nullable(s.id)),fontAssetId:s.optional(s.nullable(s.id)),fileId:s.optional(s.nullable(s.id)),cropId:s.optional(s.nullable(s.id)),
  rect:s.optional(rect),graph:s.optional(graph),selected:s.optional(s.bool),loop:s.optional(s.bool),steps:s.optional(s.ids),links:s.optional(s.array(s.text(90))),
  history: s.array(history,50)
  ,easyManaged:s.optional(s.bool),easyCustom:s.optional(s.bool),easyPalette:s.optional(s.nullable(s.text(120)))
};
const decision = s.shape(decisionRules);
const reference = s.shape({id:s.id,name:s.label(180),url:s.optional(s.text()),fileId:s.nullable(s.id),note:s.optional(s.text()),role:s.optional(s.text()),regions:s.array(decision,2048),...maybe(linkKeys,s.ids),scopeMode:s.optional(s.one(['global','targets'])),conceptId:s.optional(s.nullable(s.id)),fontAssetId:s.optional(s.nullable(s.id)),history:s.optional(s.array(history,50))});
const criterion = s.shape({id:s.text(90,1),label:s.text(),expected:s.text(2*1024*1024),scope:s.one(['visual','behavior']),decisionIds:s.optional(s.ids)});
const reviewItem = s.shape({id:s.text(90,1),label:s.text(),expected:s.text(2*1024*1024),scope:s.one(['visual','behavior']),decisionIds:s.optional(s.ids),verdict:s.one(['match','partial','mismatch','unverifiable','na']),observation:s.text(),evidence:s.text(),target:s.text(),keep:s.text(),cause:s.text(),resolution:s.one(['resolved','remaining','new-problem','unverifiable']),regression:s.bool,selected:s.bool});
const review = s.shape({id:s.id,resultId:s.id,snapshotId:s.id,parentReviewId:s.nullable(s.id),planId:s.nullable(s.id),createdAt:s.text(64),completedAt:s.optional(s.text(64)),state:s.one(['reviewing','completed','held','needs-revision']),scope:s.one(['visual','behavior']),screen:s.text(),intent:s.text(),intentReason:s.text(),holdReason:s.text(),learning:s.text(),externalFeedback:s.text(),feedbackSource:s.text(),items:s.array(reviewItem,256),recheck:s.optional(s.shape({decisionIds:s.array(s.id,50000),criterionIds:s.array(s.text(90)),reason:s.text(),at:s.text(64)}))});
export const planFields = s.shape({problem:s.optional(s.text()),cause:s.optional(s.text()),target:s.optional(s.text()),change:s.text(32768,1),scope:s.optional(s.text()),keep:s.text(32768,1),materials:s.optional(s.text()),check:s.text(32768,1)});
const result = s.shape({id:s.id,number:s.optional(s.integer(1)),createdAt:s.optional(s.text(64)),snapshotId:s.id,fileId:s.optional(s.nullable(s.id)),...maybe(['source','environment','instruction','execution','note','keep'],s.text()),screen:s.text()});
const plan = s.shape({id:s.id,reviewId:s.id,resultId:s.id,snapshotId:s.id,selection:s.optional(s.selection),itemIds:s.array(s.text(90)),createdAt:s.text(64),confirmed:s.bool,...maybe(['problem','cause','target','scope','materials'],s.text()),change:s.text(),keep:s.text(),check:s.text()});
const outputRules = {purpose:s.text(),format:s.text(),scope:s.text(),selection:s.optional(s.selection),tech:s.text(),extra:s.text(),common:s.text(),commonVersion:s.integer(1),procedure:s.text(),procedureSource:s.optional(s.text()),language:s.text(),version:s.integer(1)};
const intent = s.nullable(s.shape({choice:s.text(64),reason:s.optional(s.text()),revision:s.integer(1),at:s.optional(s.text(64))}));
const projectKeys = ['schemaVersion','modelVersion','id','name','idea','entry','type','version','revision','createdAt','updatedAt','fields','features','contents','flows','screens','references','concepts','styles','assets','snapshots','results','reviews','plans','activity','intent','handoff','progress','output','settings','sampleKind','scopeBasis','lastImpact','restoredFrom'];

/** Validates stored/legacy data; does not accept a browser project replacement. */
export function validateProject(input: unknown, historical = false): Project {
  s.json(input);
  check(Buffer.byteLength(JSON.stringify(input))<=BACKUP_LIMIT,'프로젝트 JSON이 90MiB 한도를 초과합니다.','LIMIT_EXCEEDED');
  const p = s.obj(input);
  check(Object.keys(p).every(k => projectKeys.includes(k)), '프로젝트에 허용되지 않은 필드가 있습니다.');
  check(p.schemaVersion === 1, '지원하지 않는 설계 버전입니다.', 'UNSUPPORTED_VERSION');
  s.id(p.id); s.label(120,1)(p.name); s.text()(p.idea); s.one(['idea','image','concept','improve'])(p.entry); s.one([...TYPES,'기타'])(p.type);
  s.integer(1)(p.version); s.integer(1)(p.revision); s.text(64)(p.createdAt); s.text(64)(p.updatedAt);
  s.optional(s.integer(1))(p.modelVersion);
  const fields = s.obj(p.fields); check(Object.keys(fields).length === QUESTIONS.length);
  for (const q of QUESTIONS) decision(fields[q.key]);
  for (const k of ['features','contents','flows','screens','concepts','styles','assets','scopeBasis']) s.optional(s.array(decision,10000))(p[k]);
  for (const k of ['features','contents','flows','screens','concepts','styles','assets']) check(Array.isArray(p[k]));
  s.array(reference,2048)(p.references); s.array(result,10000)(p.results); s.array(review,10000)(p.reviews); s.array(plan,10000)(p.plans);
  s.array(s.shape({at:s.text(64),reason:s.text(),ids:s.array(s.id,50000),revision:s.integer(1)}),150)(p.activity); intent(p.intent); s.nullable(s.shape({snapshotId:s.id,waiting:s.bool,revision:s.optional(s.bool),at:s.optional(s.text(64))}))(p.handoff); s.progress(p.progress); s.shape(outputRules)(p.output); s.shape({density:s.one(['guide','quick'])})(p.settings);
  s.optional(s.text(64))(p.sampleKind); s.optional(s.shape({roots:s.array(s.id,50000),decisionIds:s.array(s.id,50000),reason:s.text(),at:s.text(64)}))(p.lastImpact); if(p.restoredFrom!==undefined){if(typeof p.restoredFrom==='string')s.text(120)(p.restoredFrom);else s.shape({id:s.id,at:s.text(64)})(p.restoredFrom);}
  check(Array.isArray(p.snapshots) && p.snapshots.length <= 10000);
  if (historical) check(p.snapshots.length === 0 && (p.results as unknown[]).length === 0 && (p.reviews as unknown[]).length === 0 && (p.plans as unknown[]).length === 0,'고정 입력에 회차 기록을 중첩할 수 없습니다.');
  for (const item of p.snapshots) {
    s.shape({id:s.id,number:s.integer(1),createdAt:s.text(64),revision:s.integer(1),templateVersion:s.text(120),guideVersion:s.text(120),commonVersion:s.integer(1),selection:s.optional(s.selection),scopeContexts:s.optional(s.array(s.json,10000)),decisions:s.array(s.shape({id:s.id,version:s.integer(1)}),50000),referenceFileIds:s.array(s.id,50000),input:s.json,criteria:s.array(criterion,256),intent,output:s.shape(outputRules),text:s.text(64*1024*1024),sections:s.array(s.shape({id:s.text(90),title:s.text(),body:s.text(64*1024*1024),decisionIds:s.array(s.text(90,1),50000),tab:s.one(s.tabs)}),256),draft:s.bool,planId:s.nullable(s.id),baselineReason:s.optional(s.text())})(item);
    validateProject(s.obj(item).input,true);
  }
  // The complete runtime shape above, plus specialized flow/screen requirements below, justify this cast.
  const project = p as unknown as Project;
  for (const f of project.flows) { s.ids(f.steps); s.bool(f.loop); for (const k of ['goal','start','branch','recovery','complete'] as const) s.text()(f[k]); }
  for (const screen of project.screens) for (const k of ['entry','response','next','exceptions','preserve','actions'] as const) s.text()(screen[k]);
  if (!historical) domain.upgradeProject(project);
  validateRelations(project, historical);
  return project;
}

export function validateRelations(p: Project, historical = false) {
  const all = [...domain.decisionNodes(p),...p.snapshots,...p.results,...p.reviews,...p.plans];
  check(new Set(all.map(d=>d.id)).size === all.length,'프로젝트 내부 ID가 중복되었습니다.');
  const nodes = new Set(domain.decisionNodes(p).map(d=>d.id)), screens = new Set(p.screens.map(d=>d.id)), flows = new Set(p.flows.map(d=>d.id)), assets = new Set(p.assets.map(d=>d.id)), refs = new Set(p.references.map(d=>d.id));
  const checkIds = (values: readonly string[] | undefined, allowed: Set<string>) => { for (const value of values || []) if (value) check(allowed.has(value),'연결한 대상이 이 프로젝트에 없습니다.','PROJECT_MISMATCH'); };
  if (!historical) for (const d of domain.decisionNodes(p)) { checkIds(d.dependsOn,nodes); checkIds(d.screenIds,screens); checkIds(d.flowIds,flows); checkIds(d.assetIds,assets); checkIds(d.referenceIds,refs); checkIds(d.regionIds,new Set(p.references.flatMap(r=>r.regions.map(a=>a.id)))); checkIds(d.appliesTo,nodes); if (d.fontAssetId) checkIds([d.fontAssetId],assets); }
  for (const f of p.flows) {
    checkIds(f.steps,screens);
    if (f.graph) { checkIds([f.graph.entryId,...f.graph.terminalIds],screens); for (const e of f.graph.transitions) { checkIds([e.from,e.to],screens); check(f.steps.includes(e.from) || !e.from,'연결의 출발 화면이 흐름 밖에 있습니다.'); check(f.steps.includes(e.to) || !e.to,'연결의 도착 화면이 흐름 밖에 있습니다.'); } }
  }
  for (const ref of p.references) for (const a of ref.regions) {
    const z = a.rect; check(z && [z.x,z.y,z.w,z.h].every(Number.isFinite) && z.x >= 0 && z.y >= 0 && z.w > 0 && z.h > 0 && z.x+z.w <= 1.00001 && z.y+z.h <= 1.00001,'원본 범위를 벗어난 영역입니다.');
    // An old observation can be retained as stale, but cannot be confirmed against a new original.
    if (a.status === 'confirmed' && !a.reviewNeeded) check(!a.fileId || a.fileId === ref.fileId,'영역의 원본 연결을 갱신하세요.');
  }
  if (p.output.selection && p.output.selection.mode !== 'all') checkIds(p.output.selection.ids,new Set(p[p.output.selection.mode].map(d=>d.id)));
  for (const result of p.results) check(p.snapshots.some(snap=>snap.id===result.snapshotId),'결과의 기준 버전이 없습니다.','PROJECT_MISMATCH');
  if(!historical&&p.handoff)check(p.snapshots.some(snap=>snap.id===p.handoff!.snapshotId),'수동 전달 기준이 없습니다.','PROJECT_MISMATCH');
  for (const review of p.reviews) {
    check(p.results.some(r=>r.id===review.resultId && r.snapshotId===review.snapshotId),'검토의 결과·기준 연결이 다릅니다.','PROJECT_MISMATCH');
    if (review.parentReviewId) check(p.reviews.some(r=>r.id===review.parentReviewId));
    if (review.planId) check(p.plans.some(r=>r.id===review.planId));
  }
  for (const plan of p.plans) check(p.reviews.some(r=>r.id===plan.reviewId && r.resultId===plan.resultId && r.snapshotId===plan.snapshotId),'수정 계획의 연결이 다릅니다.','PROJECT_MISMATCH');
  if (!historical) for (const snapshot of p.snapshots) if (snapshot.planId) check(p.plans.some(plan=>plan.id===snapshot.planId),'수정 기준의 계획이 없습니다.');
}

export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : s.object(v) ? Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}
