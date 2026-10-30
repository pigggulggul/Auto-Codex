// Ported from Atelier public/domain.js. Runtime effects are caller-owned.
import { QUESTIONS, EXAMPLES, ENTRIES, GUIDE_VERSION, conceptExamples, flowExample, COMMON_DEFAULT, TYPE_FLOW_EXAMPLES, SAMPLE_EXAMPLES } from './guide.js';
import { createStructure } from './structure.js';
import { clone, freeze, editable } from './value.js';
import {designReviewCriteria} from './blueprint.js';
import type { DomainContext, Project, Decision, Provenance, DecisionStatus, NewProjectOptions, FieldKey, Palette, TransitionKind, Issue, Tab, Criterion, SnapshotOptions, SnapshotData, ManualResult, Review, PlanFields, RevisionPlan, Flow, FlowGraph, Section, OutputSelection } from './types.js';
export const TEMPLATE_VERSION = 'atelier-prompt-1.3.2';
export const SCHEMA_VERSION = 1;
export function createDomain(context: DomainContext) {
    const structure = createStructure(context);
    const { createGraph, upgradeProject, graphIssues, decisionNodes, dependencyEdges, propagateImpact, criterionDependencies, selectionIssues, selectScope, attachmentIds, currentInput } = structure;
    const uid = (prefix = 'd') => context.id(prefix);
    const confirmed = <T extends Decision>(d: T | undefined): d is T & {
        status: 'confirmed';
    } => d?.status === 'confirmed' && !!String(d.value ?? '').trim();
    const sourceNames = { user: '사용자 직접 입력', example: '내장 예시', observation: '사용자 레퍼런스 관찰', external: '직접 등록한 외부 자료' };
    const statusNames = { unknown: '미정', proposed: '제안', confirmed: '확정', excluded: '제외' };
    function decision(value?: string, source?: Provenance, status?: DecisionStatus): Decision;
    function decision<T extends Partial<Decision>>(value: string, source: Provenance, status: DecisionStatus, rest: T): Decision & T;
    function decision(value = '', source: Provenance = 'user', status: DecisionStatus = 'unknown', rest: Partial<Decision> = {}): Decision {
        return { id: uid(), version: 1, value, status, source, reason: '', scope: '프로젝트 전체', reviewNeeded: false, history: [], dependsOn: [], ...rest };
    }
    function newProject({ name, idea = '', entry = 'idea', type = '아직 미정' }: NewProjectOptions): Project { return { schemaVersion: SCHEMA_VERSION, modelVersion: 2, id: uid('p'), name: name.trim(), idea, entry, type, version: 1, revision: 1, createdAt: context.now(), updatedAt: context.now(), fields: Object.fromEntries(QUESTIONS.map(q => [q.key, decision()])) as Record<FieldKey, Decision>, features: [], contents: [], flows: [], screens: [], references: [], concepts: [], styles: [], assets: [], snapshots: [], results: [], reviews: [], plans: [], activity: [], intent: null, handoff: null, progress: { tab: ENTRIES.find(e => e[0] === entry)?.[3] || 'design', guideStage: 0, returnTo: null }, output: { purpose: '서비스 전체 UI UX 설계', format: 'UI UX 설계 문서', scope: '서비스 전체', selection: { mode: 'all', ids: [] }, tech: '미정', extra: '', common: COMMON_DEFAULT, commonVersion: 1, procedure: '관찰 → 설계 → 제작 → 실제 결과 비교 → 수정과 재검토', procedureSource: '사용자 작업 절차', language: '한국어', version: 1 }, settings: { density: 'guide' } }; }
    function allDecisions(p: Project): Decision[] {
        return [...Object.values(p.fields), ...p.features, ...p.contents, ...p.concepts, ...p.styles, ...p.assets, ...p.flows, ...p.screens, ...p.references.flatMap(r => r.regions)];
    }
    function touch(p: Project, reason: string, ids: string[] = [], { propagate = true } = {}) {
        if (propagate && ids.length)
            propagateImpact(p, ids, reason);
        p.revision++;
        p.updatedAt = context.now();
        p.intent = null;
        p.activity.unshift({ at: p.updatedAt, reason, ids, revision: p.revision });
        p.activity = p.activity.slice(0, 150);
    }
    function markDependents(p: Project, key: FieldKey) { const root = p.fields[key]?.id; return root ? propagateImpact(p, [root], key + ' 변경') : []; }
    function updateDecision<T extends Decision>(p: Project, d: T, patch: Partial<T>, key?: string, { propagate = true } = {}) {
        const before = clone(d);
        const changed = Object.entries(patch).some(([k, v]) => k !== 'reviewNeeded' && k !== 'reason' && k !== 'status' && JSON.stringify(v) !== JSON.stringify(d[k as keyof T])) || (before.status === 'confirmed' && 'status' in patch && patch.status !== before.status);
        if (!Object.entries(patch).some(([k, v]) => d[k as keyof T] !== v))
            return;
        d.history.push({ version: d.version, value: before.value, status: before.status, source: before.source, scope: before.scope, reason: before.reason, fileId: before.fileId, cropId: before.cropId, rect: before.rect, graph: before.graph, dependsOn: before.dependsOn, screenIds: before.screenIds, referenceIds: before.referenceIds, appliesTo: before.appliesTo, at: context.now() });
        d.history = d.history.slice(-50);
        Object.assign(d, patch);
        d.version++;
        touch(p, `${key || d.id} 결정 변경`, [d.id], { propagate: changed && propagate });
        return d;
    }
    function exampleInto(p: Project, key: FieldKey) { const d = p.fields[key]; updateDecision(p, d, { value: (EXAMPLES[p.type] || EXAMPLES['아직 미정'])[key], source: 'example', status: 'proposed' }, key); }
    function addFlowExample(p: Project) {
        const f = p.sampleKind ? flowExample(p.type) : (TYPE_FLOW_EXAMPLES[p.type] || TYPE_FLOW_EXAMPLES['아직 미정']!);
        const screens = f.steps.map((name, i) => decision(name, 'example', 'proposed', { kind: p.type === '게임' ? (i === 0 ? '게임 상태' : '패널') : '페이지', role: f.roles[i], entry: i === 0 ? f.start : f.steps[i - 1], priority: f.roles[i], actions: i === 0 ? '시작, 돌아가기' : '선택, 이전으로, 다시 시도', response: '선택과 작업 데이터를 유지하며 상태 변경', next: i === f.steps.length - 1 ? (f.loop ? '반복: ' + f.steps[0] : '완성') : f.steps[i + 1], exceptions: f.recovery, preserve: '사용자의 입력과 편집 상태 보존', links: [] }));
        p.screens.push(...screens);
        const flow = decision(f.name, 'example', 'proposed', { goal: f.goal, role: (EXAMPLES[p.type] || EXAMPLES['아직 미정']).user, start: f.start, steps: screens.map(s => s.id), branch: f.branch, recovery: f.recovery, complete: f.complete, loop: f.loop });
        flow.graph = createGraph(flow, { example: true });
        const g = flow.graph;
        if (p.sampleKind && ['게임', '제작 도구'].includes(p.type))
            g.transitions = g.transitions.filter(e => ['next', 'loop'].includes(e.kind));
        const edge = (from: number, to: number, kind: TransitionKind, condition: string, preserve: string) => g.transitions.push({ id: uid('edge'), from: flow.steps[from], to: flow.steps[to], kind, condition, preserve });
        if (p.sampleKind && p.type === '게임') {
            edge(2, 1, 'branch', '제작 재료가 부족함', '보유 재료·선택한 제작법');
            edge(3, 0, 'recovery', '중단 후 저장한 상태에서 재개', '거점 구조·인벤토리·진행 상태');
        }
        else if (p.sampleKind && p.type === '제작 도구') {
            edge(1, 1, 'branch', '카메라를 사용할 수 없어 사진 가져오기 선택', '이미 가져온 원본 사진');
            edge(2, 1, 'branch', '사진을 교체하거나 다시 촬영함', '선택한 프레임·장식');
            edge(4, 3, 'recovery', '저장 실패 또는 다시 편집 선택', '사진·프레임·스티커 편집 상태');
            edge(3, 2, 'recovery', '이전 단계로 이동해 사진 다시 선택', '원본과 현재 편집 데이터');
        }
        p.flows.push(flow);
        touch(p, '내장 흐름 예시 복제');
        return flow;
    }
    function addConcepts(p: Project) { p.concepts.push(...conceptExamples(p.type).map(c => decision(c.label, 'example', 'proposed', { ...c, selected: false, reason: '' }))); touch(p, '내장 컨셉 비교 예시 복제'); }
    function chooseConcept(p: Project, id: string) { const roots = p.concepts.filter(c => c.selected || c.id === id).map(c => c.id); p.concepts.forEach(c => { c.selected = c.id === id; if (c.id === id) {
        c.status = 'confirmed';
        c.version++;
    } }); touch(p, '컨셉 방향 선택', roots); }
    function applyPalette(p: Project, palette: Palette) {
        const vals: [
            string,
            string,
            string
        ][] = [['배경', palette.bg, '화면 바탕'], ['본문', palette.text, '본문과 긴 안내'], ['강조', palette.accent, '주요 버튼과 선택 테두리'], ['서체', palette.font, '짧은 제목. 긴 한글 본문은 시스템 서체'], ['형태', palette.shape, '버튼과 패널'], ['배치', palette.layout, '대표 작업 화면'], ['재질', palette.material, '화면 패널과 사용자가 지정한 리소스'], ['모션', palette.motion, '상태가 바뀌는 컴포넌트']];
        for (const [role, value, scope] of vals)
            p.styles.push(decision(value, 'example', 'proposed', { role, scope, conceptId: p.concepts.find(c => c.selected)?.id || palette.id || null, reason: '내장 조합 예시. 서비스 적합성은 직접 확인', exception: '가독성과 조작을 방해하면 강도를 줄임' }));
        touch(p, '팔레트와 표현 규칙 예시 복제');
    }
    function makeSample(kind: string) {
        const game = kind === 'game';
        const p = newProject({ name: game ? '숲과 거점' : 'Dear. four', idea: game ? '낮에는 숲을 탐험하고 밤에는 직접 만든 거점으로 돌아오는 픽셀 생존 게임' : '핑크빛 공주풍 Y2K 네컷 사진을 꾸며 저장하는 도구', entry: 'idea', type: game ? '게임' : '제작 도구' });
        p.sampleKind = kind;
        for (const q of QUESTIONS)
            p.fields[q.key] = decision(SAMPLE_EXAMPLES[p.type === '기타' ? '아직 미정' : p.type][q.key], 'example', 'proposed');
        p.features = [decision(game ? '탐험·채집·제작·건설' : '촬영·가져오기·선택·꾸미기·저장', 'example', 'proposed', { priority: '이번 범위', purpose: EXAMPLES[p.type].goal, action: game ? '상호작용하고 재료로 제작' : '사진을 선택하고 프레임 편집', info: game ? '재료·수량·설치 가능 여부' : '원본 사진·편집 상태', flowIds: [] })];
        p.contents = [decision(game ? '월드와 아이템 안내 문구' : '촬영 안내와 완성 파일 안내', 'example', 'proposed', { kind: '문구', purpose: '핵심 작업의 상태 설명', availability: '제작 필요', content: '', conditions: '실제 한글 화면으로 읽기 확인', materialType: '임시 샘플', screenIds: [] })];
        addFlowExample(p);
        p.features[0].flowIds = [p.flows[0].id];
        addConcepts(p);
        applyPalette(p, { ...conceptExamples(p.type)[0], id: p.concepts[0].id });
        p.assets = [decision(game ? '픽셀 타일·캐릭터·아이템 기준 팩' : '리본·진주 프레임과 스티커', 'example', 'proposed', { kind: '그래픽', method: '직접 제작', availability: '제작 필요', purpose: game ? '월드와 아이템' : '프레임과 장식', rules: game ? '타일 규격·외곽선·명암을 기준 팩에 맞춤' : '사진 얼굴을 가리지 않는 비율과 투명 배경', sourceUrl: '', usage: '사용 조건 확인 필요', review: '대표 화면에서 일관성과 가독성 확인', fileId: null, referenceIds: [] })];
        p.progress.guideStage = 0;
        p.activity = [];
        p.revision = 1;
        return p;
    }
    function fileIds(p: Project) { const set = new Set<string>(); const walk = (x: unknown) => { if (!x || typeof x !== 'object')
        return; for (const [k, v] of Object.entries(x)) {
        if ((k === 'fileId' || k === 'cropId') && typeof v === 'string')
            set.add(v);
        else if (k === 'fileIds' && Array.isArray(v))
            v.forEach(i => set.add(i));
        else if (typeof v === 'object')
            walk(v);
    } }; walk(p); return [...set]; }
    function issues(p: Project, existingFiles?: ReadonlySet<string>): Issue[] {
        const original = p, scoped = selectScope(p), mode = scoped.selection.mode;
        p = scoped.project;
        const out = [...selectionIssues(original)];
        const add = (code: string, message: string, tab: Tab, id?: string, severity: Issue['severity'] = 'blocking') => out.push({ code, message, tab, id, severity });
        for (const q of QUESTIONS.filter(q => !q.optional)) {
            if (!confirmed(p.fields[q.key]))
                add('required', `${q.label} — 확정이 필요합니다.`, 'design', q.key);
        }
        if (p.type === '아직 미정')
            add('type', '제품 유형을 선택해 주세요.', 'design');
        if (mode !== 'assets' && !p.features.some(f => confirmed(f) && f.priority === '이번 범위'))
            add('features', '이번 범위의 핵심 기능을 하나 이상 확정해 주세요.', 'design');
        for (const f of p.features.filter(confirmed)) {
            for (const id of f.flowIds || [])
                if (!original.flows.some(x => x.id === id))
                    add('feature-reference', `${f.value}: 연결한 흐름이 없습니다.`, 'design', f.id);
        }
        if (mode !== 'assets' && !p.flows.some(confirmed) && !scoped.contexts.length)
            add('flow', '전체 목표에 연결된 흐름을 확정해 주세요.', 'flow');
        for (const f of p.flows.filter(confirmed)) {
            out.push(...graphIssues(original, f));
            if (!f.steps.length || !f.complete.trim() || !f.start.trim() || !f.goal.trim() || !f.recovery.trim())
                add('flow-fields', `${f.value}: 시작·목표·완료·복구와 단계를 확인하세요.`, 'flow', f.id);
            for (const id of f.steps) {
                const s = p.screens.find(s => s.id === id);
                if (!s || !confirmed(s) || !s.role?.trim())
                    add('screen', `${f.value}: 연결된 화면과 역할의 확정을 확인하세요.`, 'flow', id);
            }
        }
        for (const s of p.screens.filter(confirmed)) {
            if (!s.role?.trim())
                add('screen-role', s.value + ': 화면의 역할을 작성하세요.', 'flow', s.id);
            if (!original.flows.some(f => f.steps.includes(s.id)))
                add('orphan', `${s.value}: 어떤 흐름에도 연결되지 않았습니다.`, 'flow', s.id);
        }
        if (!p.concepts.some(c => c.selected && confirmed(c)) && !p.styles.some(confirmed))
            add('concept', '선택한 컨셉이나 직접 작성한 시각 규칙이 필요합니다.', 'concept');
        if (!p.styles.some(s => confirmed(s) && s.scope.trim()))
            add('style', '값·역할·적용 범위가 있는 스타일 규칙을 확정해 주세요.', 'style');
        const roles = new Map<string, Decision>();
        for (const s of p.styles.filter(confirmed)) {
            if (!s.role?.trim() || !s.scope.trim())
                add('style-fields', '스타일 역할과 적용 범위를 적어 주세요.', 'style', s.id);
            if (['배경', '본문', '강조'].includes(s.role || '') && !/^#[0-9a-f]{6}$/i.test(s.value))
                add('color', '색상은 #RRGGBB 형식으로 적어 주세요.', 'style', s.id);
            const key = s.role + '|' + s.scope;
            const prev = roles.get(key);
            if (prev && prev.value !== s.value)
                add('explicit-conflict', `${s.role} · ${s.scope}에 서로 다른 값 ${prev.value} / ${s.value}이 확정되어 있습니다.`, 'style', s.id);
            roles.set(key, s);
        }
        if (!p.contents.some(confirmed) && !p.assets.some(confirmed))
            add('resources', '실제 자료 또는 제작 계획을 하나 이상 확인해 확정하세요.', 'design');
        for (const a of p.assets.filter(confirmed))
            if (a.availability === '보유' && !a.fileId)
                add('asset-file', `${a.value}: 보유한 실제 파일을 등록하거나 확보 상태를 바꿔 주세요.`, 'style', a.id);
        for (const a of p.contents.filter(confirmed))
            if (a.availability === '보유' && !a.fileId && !a.content?.trim())
                add('content-file', `${a.value}: 보유한 실제 내용이나 파일이 없습니다.`, 'design', a.id);
        for (const a of [...p.assets, ...p.contents].filter(confirmed)) {
            for (const id of a.screenIds || [])
                if (!original.screens.some(s => s.id === id))
                    add('content-reference', `${a.value}: 연결할 화면을 찾을 수 없습니다.`, 'style', a.id);
        }
        for (const d of allDecisions(p).filter(d => d.status === 'confirmed' && d.reviewNeeded))
            add('stale', `${d.value.slice(0, 45)}: 관련 원본 변경으로 재검토가 필요합니다.`, p.styles.includes(d) || p.assets.includes(d) ? 'style' : p.flows.some(x => x.id === d.id) || p.screens.some(x => x.id === d.id) ? 'flow' : p.references.some(r => r.regions.includes(d)) ? 'reference' : 'design', d.id);
        for (const r of p.references) {
            if (r.regions.some(confirmed) && !r
                .fileId)
                add('missing-reference', `${r.name}: 출처 URL만 있고 원본 파일이 없습니다. 관찰을 확정하지 마세요.`, 'reference', r.id);
            for (const a of r.regions.filter(confirmed)) {
                if (a.fileId && a.fileId !== r.fileId)
                    add('reference-version', `${r.name}: 선택 영역이 교체 전 원본에 연결되어 있습니다. 새 원본에서 크롭과 관찰을 갱신하세요.`, 'reference', a.id);
                const z = a.rect;
                if (!z || ![z.x, z.y, z.w, z.h].every(Number.isFinite) || z.x < 0 || z.y < 0 || z.w <= 0 || z.h <= 0 || z.x + z.w > 1.00001 || z.y + z.h > 1.00001)
                    add('coordinates', '선택 영역 좌표가 원본 범위를 벗어납니다.', 'reference', a.id);
                if (!a.observation?.trim() || !a.target?.trim() || !a.purpose?.trim())
                    add('application', '관찰·적용 대상·목적을 구체화하세요.', 'reference', a.id);
            }
        }
        for (const d of allDecisions(p).filter(confirmed)) {
            for (const id of [...(d.dependsOn || []), ...(d.referenceIds || []), ...(d.appliesTo || [])])
                if (!decisionNodes(original).some(x => x.id === id))
                    add('dependency-reference', '연결한 결정이나 자료를 찾을 수 없습니다.', 'brief', d.id);
            if (d.scopeMode === 'targets' && !((d.screenIds?.length || 0) + (d.flowIds?.length || 0) + (d.assetIds?.length || 0)))
                add('scope-target', '대상에만 적용할 규칙은 실제 대상을 연결하세요.', 'style', d.id);
            if (d.fontAssetId) {
                const font = original.assets.find(a => a.id === d.fontAssetId);
                if (!font?.fileId || !confirmed(font))
                    add('font-file', '실제 서체 파일과 리소스 확정을 확인하세요.', 'style', d.id);
            }
        }
        if (existingFiles)
            for (const id of attachmentIds(p))
                if (!existingFiles.has(id))
                    add('missing-file', `${id}: 실제 파일이 없습니다. 다시 등록하거나 참조를 보완하세요.`, 'reference', id);
        if (!p.output.scope.trim())
            add('output', '출력할 범위를 지정하세요.', 'prompt');
        if (p.output.format === '코드로 구현한 UI' && !p.output.tech.trim())
            add('tech', '기술 환경을 적거나 미정으로 표시하세요.', 'prompt');
        return out;
    }
    function ready(p: Project) { return issues(p).length === 0 && p.intent?.revision === p.revision && p.intent.choice === 'match'; }
    function nextAction(p: Project) {
        const last = p.reviews.at(-1);
        if (last?.recheck?.criterionIds.length)
            return { tab: 'review', label: '변경한 기준으로 새 검토 회차 준비하기', why: '당시 결과 기록은 보존했습니다. 변경 이유와 새 기준을 고정하고 결과를 다시 연결하세요.' };
        if (p.handoff?.waiting)
            return { tab: 'review', label: p.handoff.revision ? '수정 결과를 등록하고 같은 기준으로 비교하기' : '결과가 나왔어요 · 직접 등록하기', why: '외부 제작 진행은 알 수 없습니다. 실제 파일이나 실행 기록을 등록하면 비교를 시작합니다.' };
        if (last && !['completed', 'held'].includes(last.state))
            return { tab: 'review', label: '이 결과의 관찰과 수정 계획 이어 쓰기', why: '당시 기준과 실제 결과를 비교하고 유지할 부분을 남깁니다.' };
        if (!p.fields.product.value && p.entry === 'image' && !p.references.length)
            return { tab: 'reference', label: '이미지를 등록하고 느낌 정리하기', why: '원본을 보며 눈에 보이는 특징부터 직접 기록합니다.' };
        if (!p.fields.product.value && p.entry === 'concept' && !p.concepts.length)
            return { tab: 'concept', label: '이미 정한 컨셉을 등록하기', why: '재선택 없이 표현 규칙으로 구체화합니다.' };
        if (!p.fields.product.value && p.entry === 'improve' && !p.results.length)
            return { tab: 'review', label: '원래 의도와 기존 결과 연결하기', why: '아는 기준부터 고정하고 실제 결과와 차이를 찾습니다.' };
        const i = issues(p)[0];
        if (i)
            return { tab: i.tab, id: i.id, label: i.code === 'required' ? '사용자와 전체 목표 확인하기' : i.message.split(' — ')[0], why: '이 결정이 준비되면 전체 흐름과 출력 기준을 연결할 수 있습니다.' };
        if (!p.intent)
            return { tab: 'brief', label: '생성 전 의도와 적합성 확인하기', why: '누락 검사와 별개로, 내 의도에 맞는지 직접 확인합니다.' };
        return { tab: 'prompt', label: '통합 프롬프트와 참고 자료 가져가기', why: '확정한 결정을 하나의 문서로 조립하고 외부 도구에 직접 전달합니다.' };
    }
    function criterion(id: string, label: string, expected: string, scope: Criterion['scope'] = 'visual') { return { id, label, expected, scope }; }
    function reviewCriteria(p: Project): Criterion[] {
        p = selectScope(p).project;
        const dependencies = criterionDependencies(p);
        const get = (k: FieldKey) => confirmed(p.fields[k]) ? p.fields[k].value : '아직 확정하지 않은 기준';
        return [criterion('intent', '서비스 목적과 전체 경험', get('goal'), 'behavior'), criterion('customer', '고객 의문과 판단', get('doubt') + ' / ' + get('evidence'), 'behavior'), criterion('fit', '분위기의 서비스 적합성', get('fit')), criterion('style', '색·서체·형태·재질의 관계', p.styles.filter(confirmed).map(s => `${s.role}: ${s.value} → ${s.scope}`).join('\n') || '직접 작성한 표현 기준 필요'), criterion('scope', '지정한 영역과 적용 강도', p.styles
                .filter(confirmed).map(s => `${s.scope} / 예외: ${s.exception}`).join('\n') || '적용 범위 확인 필요'), criterion('reference', '레퍼런스의 유지와 조정', p.references.flatMap(r => r.regions.filter(confirmed).map(a => `${r.name}/${a.id}: ${a.observation} → ${a.target}`)).join('\n') || '등록한 레퍼런스 없음. 직접 규칙으로 검토'), criterion('interaction', '정보·조작·복구', p.flows.filter(confirmed).map(f => `${f.value}: ${f.recovery}`).join('\n') || get('criteria'), 'behavior'), criterion('consistency', '대표 화면과 다른 상태의 일관성', get('criteria'))].map(c => ({ ...c, decisionIds: dependencies[c.id] || [] })).concat(designReviewCriteria(p));
    }
    const safe = (s: unknown) => String(s ?? '').replaceAll('\r', '');
    function assemble(p: Project, { draft = false, plan = null }: SnapshotOptions = {}) {
        const scoped = selectScope(p);
        p = scoped.project;
        const sections: Section[] = [];
        const push = (title: string, body: string, ids: string[] = [], tab: Tab = 'design') => sections.push({ id: 'section-' + sections.length, title, body: safe(body), decisionIds: ids, tab });
        const show = (d: Decision) => confirmed(d) ? d.value : null;
        push('작업 목적과 산출물', `${p.name}\n목적: ${p.output.purpose}\n산출물: ${p.output.format}\n범위: ${p.output.scope}\n언어: ${p.output.language}\n기술 환경: ${p.output.tech}\n${draft ? '이 문서는 미정 정보를 남긴 설계 초안이다.' : '사용자 확인을 거친 확정 결정에 따라 설계한다.'}`, [], 'prompt');
        if (scoped.selection.mode !== 'all')
            push('이번 출력 대상과 서비스 맥락', `실제 작업 대상: ${scoped.selection.ids.map(id => { const d = decisionNodes(p).find(d => d.id === id); return (d && 'value' in d ? d.value || id : id) + ' [' + id + ']'; }).join(', ')}\n선택하지 않은 화면과 리소스는 새로 설계하거나 제작하지 않는다. 아래 연결은 전체 경험을 이해하기 위한 맥락이다.\n${scoped.contexts.map(c => c.name + ': ' + c.goal + ' / 전체 경로: ' + c.path.join(' → ') + '\n경계 연결: ' + c.boundaries.map(e => e.fromName + ' → ' + e.toName + ' (' + (e.condition || '기본 진행') + ')').join('; ')).join('\n')}`, scoped.selection.ids, 'prompt');
        if (p.scopeBasis?.length)
            push('선택한 결정의 확정 근거', '다음 결정과 파일은 선택 대상의 근거로 참고한다. 이 근거의 원래 화면이나 리소스를 이번 제작 대상으로 추가하지 않는다.' + '\n' + p.scopeBasis.map(d => d.value + ' [' + d.id + '@' + d.version + ']; 적용 범위: ' + d.scope + '; 파일: ' + (d.fileId || d.cropId || '텍스트 근거')).join('\n'), p.scopeBasis.map(d => d.id), 'brief');
        push('공통 작업 기준과 절차', `${p.output.common}\n기준 버전: ${p.output.commonVersion}\n작업 절차: ${p.output.procedure}\n절차 출처: ${p.output.procedureSource}`, [], 'prompt');
        const keys: FieldKey[] = ['product', 'user', 'decisionMaker', 'value', 'doubt', 'evidence', 'goal', 'environment', 'scope', 'fit', 'constraints', 'criteria'];
        push('제품·고객·제공 가치와 전체 경험', keys.filter(k => show(p.fields[k])).map(k => `${(QUESTIONS.find(q => q.key === k)!).label}\n${p.fields[k].value} [${p.fields[k].id}@${p.fields[k].version}; ${sourceNames[p.fields[k].source]}]`).join('\n\n'), keys.filter(k => show(p.fields[k])).map(k => p.fields[k].id));
        push('핵심 기능과 범위', p.features.filter(confirmed).map(f => `${f.priority}: ${f.value}\n목적: ${f
            .purpose} / 행동: ${f.action} / 필요한 정보: ${f.info} / 연결 흐름: ${(f.flowIds || []).join(', ')}`).join('\n'), p.features.filter(confirmed).map(f => f.id));
        push('전체 흐름과 화면 또는 상태', p.flows.filter(confirmed).map(f => { const steps = f.steps.map(id => p.screens.find(s => s.id === id)).filter(confirmed); return `${f.value} [${f.id}@${f.version}]\n목표: ${f.goal}; 역할: ${f.role}; 시작: ${f.start}\n${steps.map((s, i) => `${i + 1}. ${s.value} (${s.kind}) [${s.id}@${s.version}]\n   역할: ${s.role}; 진입: ${s.entry}; 정보 위계: ${s.priority}\n   행동: ${s.actions}; 반응: ${s.response}; 다음: ${s.next}\n   예외: ${s.exceptions}; 보존: ${s.preserve}`).join('\n')}\n연결 구조:\n${(f.graph?.transitions || []).map(e => { const name = (id: string) => p.screens.find(s => s.id === id)?.value || id; return name(e.from) + ' → ' + name(e.to) + ' [' + e.kind + '] 조건: ' + (e.condition || '기본 진행') + '; 유지 데이터: ' + (e.preserve || '해당 화면의 보존 규칙'); }).join('\n')}\n분기: ${f.branch}\n반복: ${f.loop ? '있음' : '순차 완료'}; 복구: ${f.recovery}; 완료: ${f.complete}`; }).join('\n\n'), [...p.flows.filter(confirmed), ...p.screens.filter(confirmed)].map(d => d.id), 'flow');
        if (!p.flows.length && p.screens.length)
            push('선택 화면·상태의 역할', p.screens.filter(confirmed).map(s => `${s.value} (${s.kind}) [${s.id}@${s.version}]\n역할: ${s.role}; 진입: ${s.entry}; 정보 위계: ${s.priority}\n행동: ${s.actions}; 반응: ${s.response}; 다음 연결: ${s.next}\n예외: ${s.exceptions}; 보존 데이터: ${s.preserve}`).join('\n\n'), p.screens.filter(confirmed).map(s => s.id), 'flow');
        const c = p.concepts.find(c => c.selected && confirmed(c));
        if (c)
            push('선택한 컨셉', `${c.value}: ${c.
                summary}\n경험: ${c.experience}; 주인공: ${c.hero}\n색 관계: 배경 ${c.
                bg}, 본문 ${c.text}, 강조 ${c.accent}\n글자: ${c.typography}\n재질: ${c.material}\n구성: ${c.layout}\n적용 강도: ${c.intensity}\n리소스와 부담: ${c.resources}\n원본과의 관계: ${c.reference}\n확인할 가정: ${c.assumptions}\n선택 이유: ${c.reason}`, [c.id], 'concept');
        push('시각 규칙과 적용 범위', p.styles.filter(confirmed).map(s => `${s.role}: ${s.value} → ${s.scope}\n이유: ${s.reason}; 예외: ${s.exception}${s.fontAssetId ? '; 실제 서체 리소스: ' + s.fontAssetId + ' / 파일: ' + (p.assets.find(a => a.id === s.fontAssetId)?.fileId || '미확보') : ''} [${s.id}@${s.version}]`).join('\n'), p.styles.filter(confirmed).map(s => s.id), 'style');
        push('레퍼런스 적용', p.references.flatMap(r => r.regions.filter(confirmed).map(a => `레퍼런스 ${r.name} [${r.id}] 영역 ${a.id}, 원본 파일 ${r.fileId || '미확보'}; 출처: ${r.url || '사용자 등록'}\n관찰: ${a.observation}\n사용자 해석: ${a.interpretation}\n적용: ${a.observation}을 ${a.purpose}을 위해 ${a.target}에 사용한다. ${a.keep}은 유지하고 ${a.change}는 조정한다. 제외할 특징: ${a.avoid}.\n사용 방식: ${a.useMode}; 영역: ${JSON.stringify(a.rect)}`)).join('\n\n') || '확정한 레퍼런스 적용 없음. 직접 작성한 스타일 규칙으로 설계한다. 이미지에 없는 화면이나 기능은 관찰 사실로 가정하지 않는다.', p.references.flatMap(r => r.regions.filter(confirmed).map(a => a.id)), 'reference');
        push('콘텐츠·실제 파일과 제작 계획', [...p.contents.filter(confirmed).map(a => `${a.value}: ${a.materialType}, ${a.availability}; 용도 ${a.purpose}; 실제 내용: ${a.content || '미확보'}; 조건 ${a.conditions}; 파일 ${a.fileId || '없음'}`), ...p.assets.filter(confirmed).map(a => `${a.value}: ${a.availability}; 방식 ${a.method}; 용도 ${a.purpose}; 규칙 ${a.rules}; 출처 ${a.sourceUrl || '미정'}; 사용 조건 ${a.usage}; 파일 ${a.fileId || '미확보'}; 확인 ${a.review}`)].join('\n'), [...p.contents.filter(confirmed), ...p.assets.filter(confirmed)].map(a => a.id), 'style');
        push('자연스러운 연결과 검토·수정', `시작·빈 상태·완료·실패·대기에서 현재 상황과 가능한 다음 행동을 설명한다. 뒤로 이동하거나 복구할 때 입력과 선택을 유지한다. 버튼은 실제 행동과 결과를 표현한다. 제공하지 않는 동작과 성과를 만들지 않는다. 여러 행동이 필요한 편집기와 게임의 선택 자유를 유지한다.\n\n생성 전 고객과 제공 결과·의문·경험·분위기의 연결을 설명한다. 생성 후 실제 결과를 아래 기준과 비교한다. 각 항목에 기대, 실제 관찰, 화면 또는 영역, 근거와 판정을 기록한다. 색상 하나로 전체 스타일 일치를 판정하지 않는다. 자료가 없으면 확인 불가다.\n${reviewCriteria(p).map(c => `- ${c.id} / ${c.label}: ${c.expected}`).join('\n')}\n\n불일치 시 원인·수정 범위·유지할 조건을 정한다. 수정본을 같은 기준과 비교하고 영향받는 기존 일치 항목도 다시 확인한다. 결과와 근거 없이 해결을 선언하지 않는다. 시각 검토와 실제 동작 검토는 구분한다. 의도가 바뀌면 이유와 새 기준 버전을 기록한다.`, [], 'review');
        const undecided = allDecisions(p).filter(d => ['unknown', 'proposed'].includes(d.status) && d.value).map(d => `- ${d.value} (${statusNames[d.status]}; ${sourceNames[d.source]}): 확정 요구가 아니다.`);
        push('미정·가정과 추가 지시', `${undecided.join('\n') || '별도 미정 문장 없음. 실제 자료가 없으면 확보를 먼저 확인한다.'}\n\n사용자 추가 지시 (원문):\n${p.output.extra || '없음'}\n추가 지시와 구조화된 결정의 의미 충돌은 사용자 확인 대상으로 남긴다.`, [], 'prompt');
        if (plan)
            push('이번 수정의 맥락과 재검토', `대상 결과: ${plan.resultId}; 원본 프롬프트: ${plan.snapshotId}\n문제와 근거: ${plan.problem}\n원인 가설: ${plan.cause}\n수정 대상: ${plan.target}\n변경 목표: ${plan.change}\n범위: ${plan.scope}\n유지할 조건: ${plan.keep}\n필요 자료: ${plan.materials}\n재검토 기준: ${plan.check}\n선택 기준: ${plan.itemIds.join(', ')}\n영향받는 기존 일치 항목도 같은 기준으로 확인한다. 수정 결과를 등록하기 전에는 해결 상태로 바꾸지 않는다.`, plan.itemIds, 'review');
        const text = `# ${p.name} — ${draft ? '설계 초안' : plan ? '수정 통합 프롬프트' : '통합 디자인 프롬프트'}\n\n템플릿 ${TEMPLATE_VERSION} · 가이드 ${GUIDE_VERSION}\n\n` + sections.map(s => `## ${s.title}\n\n${s.body}`).join('\n\n');
        return { text, sections };
    }
    function buildSnapshot(p: Project, { draft = false, plan = null }: SnapshotOptions = {}): SnapshotData {
        if (!draft && !plan && !ready(p))
            throw new Error('필수 결정과 사용자 의도 확인을 먼저 완료해 주세요.');
        if (plan && !plan.confirmed)
            throw new Error('수정 계획을 먼저 확정해 주세요.');
        const source = clone({ ...p, snapshots: [], results: [], reviews: [], plans: [] });
        if (plan?.selection) {
            source.output.selection = clone(plan.selection);
            const parent = p.snapshots.find(s => s.id === plan.snapshotId);
            source.output.scope = parent?.output.scope || plan.scope || '';
            source.output.format = parent?.output.format || source.output.format;
            source.output.purpose = '기존 디자인 조정';
            const failures = selectionIssues(source);
            if (failures.length)
                throw new Error(failures.map(i => i.message).join(' / '));
        }
        const scoped = selectScope(source), view = scoped.project;
        const assembled = assemble(source, { draft, plan });
        const snap: SnapshotData = { id: uid('snap'), number: p.snapshots.length + 1, createdAt: context.now(), revision: p.revision, templateVersion: TEMPLATE_VERSION, guideVersion: GUIDE_VERSION, commonVersion: p.output.commonVersion, selection: clone(scoped.selection), scopeContexts: clone(scoped.contexts), decisions: [...allDecisions(view), ...(view.scopeBasis || [])].filter(confirmed).map(d => ({ id: d.id, version: d.version })), referenceFileIds: attachmentIds(view), input: currentInput(view), criteria: reviewCriteria(view), intent: clone(p.intent), output: clone(view.output), ...assembled, draft, planId: plan?.id || null };
        return snap;
    }
    function baseline(p: Project, reason: string) {
        if (!reason.trim())
            throw new Error('현재 기준을 고정하는 이유를 적어 주세요.');
        const s = buildSnapshot(p, { draft: true });
        s.baselineReason = reason;
        s.text = '기존 결과 진단용 기준. 확정되지 않은 항목은 확인 필요.\n\n' + s.text;
        p.snapshots.push(freeze(s));
        return freeze(s);
    }
    function beginReview(p: Project, result: ManualResult) {
        const snap = p.snapshots.find(s => s.id === result.snapshotId);
        if (!snap)
            throw new Error('연결할 기준 버전이 없습니다.');
        const plan = snap.planId ? p.plans.find(x => x.id === snap.planId) : null;
        const parent = plan ? p.reviews.find(r => r.id === plan.reviewId) : null;
        const criteria = parent ? parent.items.map(i => ({ id: i.id, label: i.label, expected: i.expected, scope: i.scope, decisionIds: i.decisionIds || [] })) : snap.criteria;
        const r: Review = { id: uid('review'), resultId: result.id, snapshotId: snap.id, parentReviewId: parent?.id || null, planId: plan?.id || null, createdAt: context.now(), state: 'reviewing', scope: 'visual', screen: result.screen, intent: 'unknown', intentReason: '', holdReason: '', learning: '', externalFeedback: '', feedbackSource: '', items: criteria.map(c => ({ ...editable<Criterion>(c), verdict: 'unverifiable', observation: '', evidence: '', target: '', keep: '', cause: '', resolution: 'unverifiable', regression: !!parent?.items.some(i => i.id === c.id && i.verdict === 'match'), selected: false })) };
        p.reviews.push(r);
        p.handoff = null;
        return r;
    }
    function reviewProblems(p: Project, r: Review) {
        const result = p.results.find(x => x.id === r.resultId);
        const out = [];
        if (r.recheck?.criterionIds?.length)
            out.push('기준 변경으로 재검토가 필요합니다. 변경 이유를 남겨 새 기준·결과 회차로 확인하세요.');
        if (!result || (!result.fileId && !result.execution?.trim()))
            out.push('결과 이미지 또는 직접 확인한 실행 기록이 필요합니다.');
        if (r.intent !== 'match' || !r.intentReason.trim())
            out.push('실제 결과가 의도와 맞는지 이유와 함께 확인하세요.');
        if (r.scope === 'behavior' && (!result?.execution?.trim() || result.executionSource === 'runtime' && !result.behaviorEvidence?.trim()))
            out.push('동작을 포함한 검토에는 직접 실행한 기록이 필요합니다.');
        for (const i of r.items) {
            if (r.scope === 'visual' && i.scope === 'behavior')
                continue;
            if (!['match', 'na'].includes(i.verdict))
                out.push(`${i.label}: ${i.verdict === 'unverifiable' ? '확인 불가' : '불일치 또는 부분 일치'}`);
            if (!i.observation.trim() || !i.evidence.trim())
                out.push(`${i.label}: 관찰과 근거가 필요합니다.`);
            if (r.parentReviewId && i.verdict === 'match' && i.resolution !== 'resolved')
                out.push(`${i.label}: 새 결과에서 재검토 판정을 남겨 주세요.`);
        }
        return out;
    }
    function finishReview(p: Project, r: Review) { const failures = reviewProblems(p, r); if (failures.length)
        throw new Error(failures.join('\n')); r.state = 'completed'; r.completedAt = context.now(); return r; }
    function createPlan(p: Project, r: Review, fields: PlanFields) { const result = p.results.find(x => x.id === r.resultId); if (!result)
        throw new Error('연결할 결과가 없습니다.'); const ids = r.items.filter(i => i.selected).map(i => i.id); if (!ids.length)
        throw new Error('수정할 진단 항목을 하나 이상 선택하세요.'); if (!fields.change?.trim() || !fields.keep?.trim() || !fields.check?.trim())
        throw new Error('변경 목표·유지할 조건·재검토 기준을 적어 주세요.'); const plan: RevisionPlan = { id: uid('plan'), reviewId: r.id, resultId: result.id, snapshotId: r.snapshotId, selection: editable<OutputSelection>(p.snapshots.find(s => s.id === r.snapshotId)?.output.selection || { mode: 'all', ids: [] }), itemIds: ids, createdAt: context.now(), confirmed: false, ...fields }; p.plans.push(plan); r.state = 'needs-revision'; return plan; }
    function editGraph(p: Project, flow: Flow, mutate: (graph: FlowGraph) => void) { const graph = clone(flow.graph || createGraph(flow)); mutate(graph); graph.version++; updateDecision(p, flow, { graph, reviewNeeded: flow.status === 'confirmed' }); return graph; }
    function acknowledgeGraph(p: Project, flow: Flow) {
        const graph = clone(flow.graph || createGraph(flow));
        graph.reviewedVersion = graph.version;
        const errors = graphIssues(p, { ...flow, graph });
        if (errors.length)
            throw new Error(errors.map(i => i.message).join('\n'));
        updateDecision(p, flow, { graph, status: 'confirmed', reviewNeeded: false }, undefined, { propagate: false });
        return flow;
    }
    function makeSnapshot(p: Project, options: SnapshotOptions = {}) { const snap = freeze(buildSnapshot(p, options)); p.snapshots.push(snap); return snap; }
    return { ...structure, uid, clone, confirmed, sourceNames, statusNames, decision, newProject, allDecisions, touch, markDependents, updateDecision, exampleInto, addFlowExample, addConcepts, chooseConcept, applyPalette, makeSample, fileIds, issues, ready, nextAction, reviewCriteria, assemble, makeSnapshot, baseline, beginReview, reviewProblems, finishReview, createPlan, editGraph, acknowledgeGraph };
}

