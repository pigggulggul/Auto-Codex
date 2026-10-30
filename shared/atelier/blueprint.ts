import type {FieldKey,ProductType,Project,Criterion} from './types.js';

export type DesignArchetype='monitor'|'editor'|'commerce'|'content'|'marketing'|'game'|'workflow';
export interface DesignBlueprint {
 summary:string;productType:Exclude<ProductType,'아직 미정'|'기타'>;archetype:DesignArchetype;
 requirements:Array<{quote:string;implementation:string;screenKeys:string[]}>;
 fields:Array<{key:FieldKey;value:string;reason:string;basis:'provided'|'assumption'}>;
 features:Array<{key:string;name:string;purpose:string;action:string;info:string;flowKeys:string[]}>;
 screens:Array<{key:string;name:string;role:string;entry:string;priority:string;actions:string;response:string;next:string;exceptions:string;preserve:string;layout:string}>;
 flows:Array<{key:string;name:string;goal:string;start:string;complete:string;recovery:string;screenKeys:string[];entryKey:string;terminalKeys:string[];transitions:Array<{from:string;to:string;kind:'next'|'branch'|'recovery'|'loop';condition:string;preserve:string}>;branchPolicy:'mapped'|'none';branchReason:string;recoveryPolicy:'mapped'|'none';recoveryReason:string}>;
 visual:{name:string;direction:string;why:string;primaryTask:string;firstViewport:string[];layout:string;density:'compact'|'balanced'|'spacious';typography:string;spacing:string;shape:string;motion:string;responsive:string;avoid:string[];colors:{background:string;surface:string;text:string;muted:string;accent:string;accentText:string;border:string};font:{family:string;fallback:string;availability:'system'|'file-needed';reason:string}};
 assets:Array<{name:string;kind:string;purpose:string;method:string;rules:string;usage:string;sourceUrl:string}>;
 references:Array<{url:string;apply:string;avoid:string;limitation:string}>;
 assumptions:string[];questions:Array<{key:string;question:string;why:string;blocking:boolean;options:string[]}>;
 checks:Array<{label:string;expected:string;method:'visual'|'behavior';viewport:string}>;
}
export const ARCHETYPE_LABELS:Record<DesignArchetype,string>={monitor:'상태 확인·운영',editor:'편집·제작',commerce:'비교·구매',content:'탐색·읽기',marketing:'소개·문의',game:'플레이',workflow:'업무 진행'};
export function designReviewCriteria(p:Project):Criterion[]{
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const easy=p.progress.easy;if(!object(easy)||!object(easy.blueprint)||!Array.isArray(easy.blueprint.checks)||easy.blueprint.checks.length>12)return [];
 return easy.blueprint.checks.flatMap((c,i)=>object(c)&&typeof c.label==='string'&&c.label.length<=768&&typeof c.expected==='string'&&c.expected.length<=3072&&typeof c.viewport==='string'&&c.viewport.length<=768&&['visual','behavior'].includes(String(c.method))?[{id:'design-quality-'+i,label:c.label,expected:c.viewport+' · '+c.expected,scope:c.method as 'visual'|'behavior',decisionIds:[...p.screens,...p.styles,...p.features].map(d=>d.id)}]:[]);
}
export const DESIGN_QUALITY_INSTRUCTIONS=`서비스의 실제 사용 목적을 먼저 판단한다. 모니터는 상태·최근 변화·주요 조작을 첫 화면에, 편집기는 작업 대상과 도구를, 콘텐츠는 실제 읽을 내용을, 판매는 비교·판단 정보를, 게임은 플레이 공간을 중심에 둔다. 소개·전환이 주목적인 서비스에서만 큰 홍보용 히어로를 쓴다.
완성도는 색 하나나 작동하는 버튼 개수로 판단하지 않는다. 정보 위계, 그리드·간격·정렬, 서체 크기·행간·굵기, 표면·선·색의 역할, 주요/보조/위험 조작, 선택·호버·포커스·로딩·빈 상태·실패·완료의 일관된 시각 언어를 구체화한다. 입력 예정값·전송 중·마지막 전송값·실제 수신값을 혼동시키지 않는다.
참고 URL만으로 실제 열람·이미지 분석·폰트 확보를 주장하지 않는다. 확인한 사실, 제안, 미확인 사항을 구분한다. 확보되지 않은 서체·아이콘은 출처·라이선스·대체안을 명시하고 대체를 몰래 같은 결과라고 취급하지 않는다. 참고 스타일의 어떤 원리를 어느 화면에 적용하고 무엇을 제외할지 설명한다.
원문에 명시한 숫자·주기·탭 이름·신호 방향·사용자 금지 사항을 보존한다. 모호해서 핵심 조작이나 정보 구조가 달라지는 점만 최대 4개의 짧은 질문으로 묻는다. 알고리즘·프로토콜이 미정이어도 화면 설계 가능한 부분은 구체화하고, 실제 연결·저장·검증 성공을 꾸미지 않는다.
검토 기준은 실제로 확인할 수 있게 만든다. 대표 데스크톱과 390px 모바일의 첫 화면, 긴 이름·많은 항목, 오류 복구, 키보드와 prefers-reduced-motion을 포함한다. 자체 점수나 실행 종료를 디자인 품질 검증으로 사용하지 않는다.`;
