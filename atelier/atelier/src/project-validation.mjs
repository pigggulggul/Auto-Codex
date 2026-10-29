import {createHash} from 'node:crypto';
import {detectResource} from './resources.mjs';
import {detectImage} from './validation-image.mjs';
import {upgradeProject,decisionNodes,TRANSITION_KINDS} from '../public/structure.js';
import {fileIds,SCHEMA_VERSION,allDecisions} from '../public/domain.js';
import {QUESTIONS} from '../public/guide.js';
export {detectImage} from './validation-image.mjs';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export function assert(condition,message){if(!condition)throw Object.assign(new Error(message),{status:400});}
export function validId(x){return typeof x==='string'&&/^[a-z]+_[a-z0-9-]{1,80}$/i.test(x);}
const idsArray=x=>Array.isArray(x)&&x.every(validId);
const string=x=>typeof x==='string';
const optionalFile=x=>x==null||validId(x);

export function validateProject(p){
 assert(p&&typeof p==='object'&&!Array.isArray(p),'프로젝트 객체가 필요합니다.');
 assert(p.schemaVersion===SCHEMA_VERSION,'지원하지 않는 프로젝트 버전입니다.');
 assert(validId(p.id),'프로젝트 ID가 올바르지 않습니다.');
 assert(string(p.name)&&p.name.trim().length>0&&p.name.length<=120,'프로젝트 이름은 1~120자로 적어 주세요.');
 assert(Number.isInteger(p.revision)&&p.revision>=1&&Number.isInteger(p.version)&&p.version>=1,'프로젝트와 결정 버전이 올바르지 않습니다.');
 assert(p.fields&&typeof p.fields==='object'&&!Array.isArray(p.fields)&&p.output&&p.progress&&p.settings,'필수 프로젝트 구조가 없습니다.');
 for(const q of QUESTIONS)assert(p.fields[q.key]&&typeof p.fields[q.key]==='object',`설계 필드 ${q.key}가 없습니다.`);
 for(const key of ['features','contents','flows','screens','references','concepts','styles','assets','snapshots','results','reviews','plans','activity'])assert(Array.isArray(p[key]),`${key} 목록이 없습니다.`);
 for(const r of p.references)assert(Array.isArray(r.regions)&&string(r.name)&&optionalFile(r.fileId),'레퍼런스 원본·이름·영역 구조가 올바르지 않습니다.');
 for(const f of p.flows)assert(idsArray(f.steps),'흐름의 화면 연결 형식이 올바르지 않습니다.');
 const ids=new Set();
 for(const d of allDecisions(p)){
  assert(d&&validId(d.id)&&!ids.has(d.id),'중복되거나 유효하지 않은 결정 ID입니다.');ids.add(d.id);
  assert(string(d.value)&&['unknown','proposed','confirmed','excluded'].includes(d.status),'결정의 값과 상태가 올바르지 않습니다.');
  assert(['user','example','observation','external'].includes(d.source),'결정 출처가 올바르지 않습니다.');
  assert(Number.isInteger(d.version)&&d.version>=1&&Array.isArray(d.history)&&string(d.scope)&&string(d.reason),'결정 버전·범위·근거·이력이 필요합니다.');
  for(const key of ['dependsOn','screenIds','assetIds','referenceIds','regionIds','flowIds','appliesTo','fileIds'])if(d[key]!=null)assert(idsArray(d[key]),`${key} 연결 목록의 형식이 올바르지 않습니다.`);
  assert(optionalFile(d.fileId)&&optionalFile(d.cropId),'실제 파일 식별자가 올바르지 않습니다.');
 }
 for(const r of p.references){assert(validId(r.id)&&!ids.has(r.id),'레퍼런스 식별자가 중복되거나 잘못되었습니다.');ids.add(r.id);
  for(const a of r.regions){const z=a.rect;assert(z&&[z.x,z.y,z.w,z.h].every(Number.isFinite)&&z.x>=0&&z.y>=0&&z.w>0&&z.h>0&&z.x+z.w<=1.00001&&z.y+z.h<=1.00001,'원본 범위를 벗어나는 선택 영역 좌표입니다.');}
 }
 for(const list of [p.snapshots,p.results,p.reviews,p.plans])for(const d of list){assert(validId(d.id)&&!ids.has(d.id),'버전·검토·계획 식별자가 중복되거나 잘못되었습니다.');ids.add(d.id);}
 for(const s of p.snapshots)assert(string(s.text)&&Array.isArray(s.sections)&&Array.isArray(s.criteria)&&Array.isArray(s.referenceFileIds)&&s.input&&s.output,'프롬프트 스냅샷 구조가 올바르지 않습니다.');
 const snapshots=new Set(p.snapshots.map(s=>s.id));
 for(const x of p.results)assert(snapshots.has(x.snapshotId)&&optionalFile(x.fileId),'결과의 기준 스냅샷이나 파일 식별자가 없습니다.');
 for(const r of p.reviews){
  assert(p.results.some(x=>x.id===r.resultId)&&snapshots.has(r.snapshotId),'진단의 결과 또는 스냅샷이 없습니다.');
  assert(Array.isArray(r.items)&&['visual','behavior'].includes(r.scope),'진단 기준이나 검토 범위가 올바르지 않습니다.');
  for(const i of r.items)assert(['match','partial','mismatch','unverifiable','na'].includes(i.verdict)&&string(i.expected)&&string(i.observation)&&string(i.evidence),'진단의 기대·관찰·근거·판정 형식이 올바르지 않습니다.');
 }
 upgradeProject(p);
 for(const f of p.flows){const g=f.graph;
  assert(g&&Array.isArray(g.transitions)&&idsArray(g.terminalIds)&&string(g.entryId),'흐름의 연결 구조가 올바르지 않습니다.');
  assert(Number.isInteger(g.version)&&g.version>=1&&Number.isInteger(g.reviewedVersion)&&g.reviewedVersion>=0&&g.reviewedVersion<=g.version,'연결 구조의 확인 버전이 올바르지 않습니다.');
  const edgeIds=new Set();for(const e of g.transitions){assert(validId(e.id)&&!edgeIds.has(e.id)&&string(e.from)&&string(e.to)&&TRANSITION_KINDS[e.kind]&&string(e.condition)&&string(e.preserve),'분기 연결의 형식이나 식별자가 올바르지 않습니다.');edgeIds.add(e.id);}
 }
 assert(['all','flows','screens','assets'].includes(p.output.selection.mode)&&idsArray(p.output.selection.ids),'출력 대상 형식이 올바르지 않습니다.');
 for(const key of ['scope','purpose','format','tech','extra','common','procedure','language'])assert(string(p.output[key]),`출력 설정 ${key}가 올바르지 않습니다.`);
 return p;
}

function validateRelations(p){
 const nodes=new Set(decisionNodes(p).map(d=>d.id)),screens=new Set(p.screens.map(d=>d.id)),flows=new Set(p.flows.map(d=>d.id)),assets=new Set(p.assets.map(d=>d.id)),refs=new Set(p.references.map(d=>d.id));
 const check=(values,targets,label)=>{for(const id of values||[])assert(targets.has(id),`${label}의 참조 대상 ${id}이 백업에 없습니다.`);};
 for(const d of decisionNodes(p)){check(d.dependsOn,nodes,'결정 근거');check(d.screenIds,screens,'화면');check(d.flowIds,flows,'흐름');check(d.assetIds,assets,'리소스');check(d.referenceIds,refs,'레퍼런스');check(d.appliesTo,nodes,'적용 대상');if(d.fontAssetId)check([d.fontAssetId],assets,'실제 서체');}
 for(const f of p.flows){check(f.steps,screens,'흐름 단계');if(f.graph.entryId)check([f.graph.entryId],screens,'흐름 시작');check(f.graph.terminalIds,screens,'완료 지점');for(const e of f.graph.transitions)check([e.from,e.to].filter(Boolean),screens,'분기·복구');}
 for(const r of p.reviews){if(r.parentReviewId)assert(p.reviews.some(x=>x.id===r.parentReviewId),'이전 검토 회차가 백업에 없습니다.');if(r.planId)assert(p.plans.some(x=>x.id===r.planId),'재검토의 수정 계획이 없습니다.');}
 for(const x of p.plans)assert(p.reviews.some(r=>r.id===x.reviewId)&&p.results.some(r=>r.id===x.resultId)&&p.snapshots.some(r=>r.id===x.snapshotId),'수정 계획의 기준·결과·검토 연결이 없습니다.');
 if(p.output.selection.mode!=='all')check(p.output.selection.ids,new Set(p[p.output.selection.mode].map(d=>d.id)),'출력 대상');
}

export function validateBackup(b){
 assert(b?.format==='atelier-backup'&&b.version===1,'Atelier 백업 형식 또는 버전이 아닙니다.');validateProject(b.project);validateRelations(b.project);
 assert(Array.isArray(b.files),'백업에 파일 목록이 없습니다.');const files=new Map();
 for(const f of b.files){
  assert(validId(f.id)&&!files.has(f.id),'파일 식별자가 중복되거나 올바르지 않습니다.');
  assert(typeof f.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(f.data),'파일 내용이 올바르지 않습니다.');
  const data=Buffer.from(f.data,'base64');assert(data.length>0&&data.length<=15*1024*1024,'파일 크기는 15MB 이하여야 합니다.');
  assert(hash(data)===f.sha256,'파일 해시가 다릅니다. 손상된 백업입니다.');assert(detectResource(data,f.name),'지원하지 않거나 손상된 파일 형식입니다.');files.set(f.id,{...f,buffer:data});
 }
 for(const id of fileIds(b.project))assert(files.has(id),`참조 파일 ${id}이 백업에 없습니다.`);
 const imageIds=[...b.project.references.flatMap(r=>[r.fileId,...r.regions.flatMap(a=>[a.fileId,a.cropId])]),...b.project.results.map(r=>r.fileId)].filter(Boolean);
 for(const id of imageIds)assert(detectImage(files.get(id).buffer),'레퍼런스 원본·크롭·결과는 이미지 파일이어야 합니다.');
 return files;
}
