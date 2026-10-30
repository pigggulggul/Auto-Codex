import type {DesignBlueprint} from '../../shared/atelier/blueprint.js';
import {DESIGN_QUALITY_INSTRUCTIONS} from '../../shared/atelier/blueprint.js';
import type {Project,Flow,Screen,FieldKey,Decision} from '../../shared/atelier/types.js';
import {QUESTIONS,TYPES} from '../../shared/atelier/guide.js';
import {domain,validateProject} from './validation.js';
import {check} from './errors.js';
import * as s from './schema.js';

type Schema=Record<string,unknown>;
const text={type:'string',maxLength:768},nonempty={...text,minLength:1};
const obj=(properties:Record<string,Schema>):Schema=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const list=(items:Schema,minItems=0,maxItems=12):Schema=>({type:'array',items,minItems,maxItems});
const one=(values:readonly string[]):Schema=>({type:'string',enum:values});
const key={type:'string',pattern:'^[a-z][a-z0-9_]{0,31}$'};
export const blueprintSchema=obj({
 summary:nonempty,productType:one(TYPES.filter(t=>t!=='아직 미정')),archetype:one(['monitor','editor','commerce','content','marketing','game','workflow']),
 requirements:list(obj({quote:nonempty,implementation:nonempty,screenKeys:list(key,1,16)}),1,16),
 fields:list(obj({key:one(QUESTIONS.map(q=>q.key)),value:nonempty,reason:text,basis:one(['provided','assumption'])}),12,12),
 features:list(obj({key,name:nonempty,purpose:nonempty,action:nonempty,info:text,flowKeys:list(key,1,8)}),1,12),
 screens:list(obj(Object.fromEntries(['key','name','role','entry','priority','actions','response','next','exceptions','preserve','layout'].map(k=>[k,k==='key'?key:nonempty]))),1,16),
 flows:list(obj({key,name:nonempty,goal:nonempty,start:nonempty,complete:nonempty,recovery:nonempty,screenKeys:list(key,1,16),entryKey:key,terminalKeys:list(key,1,16),transitions:list(obj({from:key,to:key,kind:one(['next','branch','recovery','loop']),condition:text,preserve:text}),0,48),branchPolicy:one(['mapped','none']),branchReason:nonempty,recoveryPolicy:one(['mapped','none']),recoveryReason:nonempty}),1,8),
 visual:obj({name:nonempty,direction:nonempty,why:nonempty,primaryTask:nonempty,firstViewport:list(nonempty,1,8),layout:nonempty,density:one(['compact','balanced','spacious']),typography:nonempty,spacing:nonempty,shape:nonempty,motion:nonempty,responsive:nonempty,avoid:list(nonempty,1,8),colors:obj(Object.fromEntries(['background','surface','text','muted','accent','accentText','border'].map(k=>[k,{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}]))),font:obj({family:nonempty,fallback:nonempty,availability:one(['system','file-needed']),reason:nonempty})}),
 assets:list(obj(Object.fromEntries(['name','kind','purpose','method','rules','usage','sourceUrl'].map(k=>[k,k==='sourceUrl'?text:nonempty]))),1,12),
 references:list(obj({url:nonempty,apply:nonempty,avoid:nonempty,limitation:nonempty}),0,8),assumptions:list(nonempty,0,12),questions:list(obj({key,question:nonempty,why:nonempty,blocking:{type:'boolean'},options:list(nonempty,2,4)}),0,4),
 checks:list(obj({label:nonempty,expected:nonempty,method:one(['visual','behavior']),viewport:nonempty}),4,12)
});
/** Validate the same bounded schema locally; JSON Schema sent to a model is never authority. */
function schemaRule(schema:Schema):s.Rule{return value=>{
 if(schema.enum){s.one(schema.enum as string[])(value);return;}
 if(schema.type==='string'){s.text(Number(schema.maxLength||768)*4,Number(schema.minLength||0))(value);if(schema.maxLength)check(Array.from(String(value)).length<=Number(schema.maxLength),'설계 문장이 너무 깁니다.');if(schema.pattern)check(new RegExp(String(schema.pattern)).test(String(value)));return;}
 if(schema.type==='boolean'){s.bool(value);return;}
 if(schema.type==='array'){const rule=schemaRule(schema.items as Schema);s.array(rule,Number(schema.maxItems))(value);check((value as unknown[]).length>=Number(schema.minItems));return;}
 const properties=schema.properties as Record<string,Schema>;s.shape(Object.fromEntries(Object.entries(properties).map(([k,v])=>[k,schemaRule(v)])))(value);
};}
export function contrast(a:string,b:string){const luminance=(hex:string)=>hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function parseBlueprint(value:unknown):DesignBlueprint{
 s.json(value);schemaRule(blueprintSchema)(value);const b=value as DesignBlueprint;
 const unique=(keys:string[])=>check(new Set(keys).size===keys.length,'전체 설계의 키가 중복되었습니다.');
 unique(b.fields.map(f=>f.key));check(QUESTIONS.every(q=>b.fields.some(f=>f.key===q.key)));
 unique([...b.features,...b.screens,...b.flows,...b.questions].map(n=>n.key));
 const screens=new Set(b.screens.map(n=>n.key)),flows=new Set(b.flows.map(n=>n.key));
 for(const requirement of b.requirements)check(requirement.screenKeys.every(k=>screens.has(k)),'요구사항이 가리키는 화면이 없습니다.');
 for(const f of b.features)check(f.flowKeys.every(k=>flows.has(k)),'기능이 가리키는 흐름이 없습니다.');
 for(const f of b.flows){unique(f.screenKeys);unique(f.terminalKeys);check(f.screenKeys.every(k=>screens.has(k))&&f.screenKeys.includes(f.entryKey)&&f.terminalKeys.every(k=>f.screenKeys.includes(k)),'화면 연결이 설계 범위를 벗어납니다.');for(const e of f.transitions)check(f.screenKeys.includes(e.from)&&f.screenKeys.includes(e.to),'흐름 밖의 화면 연결입니다.');}
 check(b.screens.every(screen=>b.flows.some(f=>f.screenKeys.includes(screen.key))),'연결되지 않은 화면이 있습니다.');
 for(const ref of b.references){let url:URL;try{url=new URL(ref.url);}catch{throw new Error('Invalid reference URL');}check(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'사용할 수 없는 참고 주소입니다.');}
 check(contrast(b.visual.colors.text,b.visual.colors.background)>=4.5&&contrast(b.visual.colors.text,b.visual.colors.surface)>=4.5,'본문과 배경의 대비를 다시 설계하세요.');
 check(contrast(b.visual.colors.accentText,b.visual.colors.accent)>=4.5,'강조 버튼의 글자 대비를 다시 설계하세요.');
 check(b.checks.some(c=>c.method==='visual')&&b.checks.some(c=>c.method==='behavior'),'시각 검토와 동작 검토 기준이 각각 필요합니다.');
 return b;
}
export function blueprintEligible(p:Project){return ![p.features,p.screens,p.flows,p.concepts,p.styles,p.assets,p.contents].some(items=>items.length);}
export function blueprintQualityText(b:DesignBlueprint){const v=b.visual;return `[작업실 디자인 제작 기준 v1]\n서비스 용도: ${b.archetype}\n주요 작업: ${v.primaryTask}\n첫 화면에 반드시 보일 내용: ${v.firstViewport.join(' / ')}\n화면 구성: ${v.layout}\n정보 밀도: ${v.density}\n글자: ${v.typography}\n간격: ${v.spacing}\n형태: ${v.shape}\n서체: ${v.font.family} / 대체: ${v.font.fallback} / 확보: ${v.font.availability} / ${v.font.reason}\n움직임: ${v.motion}\n반응형: ${v.responsive}\n피할 표현: ${v.avoid.join(' / ')}\n참고 적용 계획(실제 열람을 의미하지 않음):\n${b.references.map(r=>`${r.url}: 적용 ${r.apply} / 제외 ${r.avoid} / 미확인 ${r.limitation}`).join('\n')||'없음'}\n검증 전 가정: ${b.assumptions.join(' / ')||'없음'}\n실제 결과에서 확인할 기준:\n${b.checks.map(c=>`- [${c.method}] ${c.viewport}: ${c.label} — ${c.expected}`).join('\n')}\n${DESIGN_QUALITY_INSTRUCTIONS}`;}
/** Only server-created IDs enter the existing domain. No replacement project or runtime settings are accepted. */
export function applyBlueprint(p:Project,b:DesignBlueprint,confirm:boolean,source:string){
 check(blueprintEligible(p),'이미 설계 항목이 있습니다. 전체 초안은 새 프로젝트에서 만들거나 기존 항목별 제안을 사용하세요.','INVALID_SELECTION');
 const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();check(b.requirements.every(r=>normalize(p.idea).includes(normalize(r.quote))),'요구사항 원문 인용이 실제 아이디어와 다릅니다.','INVALID_SELECTION');
 const proposed='proposed' as const,reason=source+'\n'+b.summary;
 const make=<T extends Partial<Decision>>(name:string,rest:T)=>domain.decision(name,'external',proposed,{reason,...rest});
 for(const f of b.fields){const d=p.fields[f.key as FieldKey];if(d.status==='confirmed'){check(d.value===f.value,'이미 확정한 답변과 전체 초안이 다릅니다. 기존 답변을 유지하도록 새로 요청하세요.','INVALID_SELECTION');continue;}if(d.status==='excluded'){check(QUESTIONS.find(q=>q.key===f.key)?.optional,'제외한 필수 답변이 있습니다. 포함 여부를 먼저 직접 확인하세요.','INVALID_SELECTION');continue;}domain.updateDecision(p,d,{value:f.value,reason:`${f.basis==='assumption'?'설계 가정':'입력 기반 제안'}: ${f.reason}\n${source}`,source:'external',status:proposed,reviewNeeded:false});}
 p.type=b.productType;const screenIds=new Map<string,string>(),flowIds=new Map<string,string>();
 for(const screen of b.screens){const d=make(screen.name,{kind:'페이지·상태',role:screen.role,entry:screen.entry,priority:screen.priority+'\n배치: '+screen.layout,actions:screen.actions,response:screen.response,next:screen.next,exceptions:screen.exceptions,preserve:screen.preserve,links:[]}) as Screen;screenIds.set(screen.key,d.id);p.screens.push(d);}
 for(const flow of b.flows){const steps=flow.screenKeys.map(k=>screenIds.get(k)!);const f=make(flow.name,{goal:flow.goal,role:b.fields.find(d=>d.key==='user')!.value,start:flow.start,complete:flow.complete,recovery:flow.recovery,steps,loop:flow.transitions.some(e=>e.kind==='loop'),branch:flow.branchReason}) as Flow;
  f.graph={version:1,reviewedVersion:0,entryId:screenIds.get(flow.entryKey)!,terminalIds:flow.terminalKeys.map(k=>screenIds.get(k)!),transitions:flow.transitions.map(e=>({...e,id:domain.uid('edge'),from:screenIds.get(e.from)!,to:screenIds.get(e.to)!})),branchPolicy:flow.branchPolicy,branchReason:flow.branchReason,recoveryPolicy:flow.recoveryPolicy,recoveryReason:flow.recoveryReason};p.flows.push(f);flowIds.set(flow.key,f.id);
 }
 for(const f of b.features)p.features.push(make(f.name,{priority:'이번 범위',purpose:f.purpose,action:f.action,info:f.info,flowIds:f.flowKeys.map(k=>flowIds.get(k)!)}));
 const v=b.visual;p.concepts.push(make(v.name,{selected:confirm,summary:v.direction,experience:v.why,hero:v.primaryTask,bg:v.colors.background,text:v.colors.text,accent:v.colors.accent,font:v.font.family,typography:v.typography,shape:v.shape,layout:v.layout,motion:v.motion,material:'표면 대비와 구분선',intensity:v.density,resources:b.assets.map(a=>a.name).join(', '),reference:b.references.map(r=>r.apply+' / '+r.limitation).join('\n'),assumptions:b.assumptions.join('\n')}));
 for(const [role,value]of [['배경',v.colors.background],['본문',v.colors.text],['강조',v.colors.accent],['서체',v.typography],['간격·정렬',v.spacing],['상태·인터랙션',v.motion]])p.styles.push(make(value,{role,scope:'서비스 전체',exception:v.avoid.join('\n')}));
 for(const a of b.assets)p.assets.push(make(a.name,{...a,availability:'제작 필요'}));
 p.output.extra=[p.output.extra,blueprintQualityText(b),'입력 원문과 화면의 연결:\n'+b.requirements.map(r=>`“${r.quote}” → ${r.implementation} → ${r.screenKeys.map(k=>b.screens.find(s=>s.key===k)!.name).join(', ')}`).join('\n')].filter(Boolean).join('\n\n');p.output.format='코드로 구현한 UI';p.output.purpose='사용자 목적에 맞는 완성된 UI/UX 설계와 제작';p.output.version++;p.progress.easy={blueprint:{archetype:b.archetype,summary:b.summary,checks:b.checks,assumptions:b.assumptions,references:b.references}};
 domain.touch(p,'전체 설계 초안 반영');
 if(confirm){for(const d of [...Object.values(p.fields),...p.features,...p.screens,...p.flows,...p.concepts,...p.styles,...p.assets].filter(d=>d.status!=='excluded'))domain.updateDecision(p,d,{status:'confirmed',reviewNeeded:false},undefined,{propagate:false});for(const f of p.flows){check(domain.graphIssues(p,{...f,graph:{...f.graph!,reviewedVersion:f.graph!.version}}).length===0,'제작 기준으로 확정할 화면 연결을 다시 확인하세요.','INVALID_SELECTION');domain.acknowledgeGraph(p,f);}p.intent={choice:'match',revision:p.revision,reason:'사용자가 전체 설계와 가정·참고 제한을 검토하고 제작 기준으로 확정함'};check(domain.ready(p),'전체 설계의 필수 기준을 다시 확인하세요.','INVALID_SELECTION');}
 validateProject(p);
}
