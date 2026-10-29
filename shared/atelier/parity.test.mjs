import {afterEach, describe, expect, test, vi} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {createDomain} from './domain.js';
import * as portGuide from './guide.js';
import * as original from '../../atelier/atelier/public/domain.js';
import * as originalStructure from '../../atelier/atelier/public/structure.js';
import * as originalGuide from '../../atelier/atelier/public/guide.js';

const examples = new URL('../../atelier/atelier/examples/', import.meta.url);
const fixtures = readdirSync(examples).filter(name => name.endsWith('.atelier.json'));
const time = '2026-10-29T00:00:00.000Z';
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
function evaluate(ported, scenario) {
  let sequence = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(time));
  vi.stubGlobal('crypto', {randomUUID: uuid});
  const api = ported ? createDomain({id: prefix => `${prefix}_${uuid()}`, now: () => time}) : {...original, ...originalStructure};
  // Legacy persistence omits undefined properties; compare actual serialized data as well as text.
  return JSON.parse(JSON.stringify(scenario(api)));
}
function parity(scenario) {
  expect(evaluate(true, scenario)).toEqual(evaluate(false, scenario));
}

test('all seven original example backups are exercised (not synthetic product results)', () => {
  expect(fixtures).toHaveLength(7);
});
test('guide questions, entry paths, examples and template material are preserved', () => {
  for (const [key, value] of Object.entries(originalGuide)) {
    if (typeof value !== 'function') expect(portGuide[key]).toEqual(value);
  }
  for (const type of originalGuide.TYPES) {
    expect(portGuide.conceptExamples(type)).toEqual(originalGuide.conceptExamples(type));
    expect(portGuide.flowExample(type)).toEqual(originalGuide.flowExample(type));
  }
});

describe.each(fixtures)('original fixture %s', name => {
  function load(api) {
    const p = JSON.parse(readFileSync(new URL(name, examples), 'utf8')).project;
    api.upgradeProject(p);
    return p;
  }
  test('whole/flow/screen/asset scopes, criteria and attachments match original byte for byte', () => {
    parity(api => {
      const p = load(api);
      const historical = JSON.stringify(p.snapshots);
      const outputs = [];
      for (const mode of ['all', 'flows', 'screens', 'assets']) {
        p.output.selection = {mode, ids: mode === 'all' ? [] : p[mode].slice(0, 1).map(d => d.id)};
        const before = JSON.stringify(p);
        const scope = api.selectScope(p);
        const first = api.assemble(p, {draft: true});
        expect(api.assemble(p, {draft: true})).toEqual(first);
        expect(JSON.stringify(p)).toBe(before);
        outputs.push({first, scope, issues: api.issues(p), files: api.attachmentIds(scope.project), criteria: api.reviewCriteria(p)});
      }
      expect(JSON.stringify(p.snapshots)).toBe(historical);
      return outputs;
    });
  });
  test('new snapshot, review, revision and impact preserve original links and historical bytes', () => {
    parity(api => {
      const p = load(api);
      const historical = JSON.stringify(p.snapshots);
      const s = api.makeSnapshot(p, {draft: true});
      const result = {id: 'result_parity', snapshotId: s.id, fileId: null, execution: '도메인 회귀용 합성 관찰 기록', source: '원본 픽스처 검증', screen: '검증 화면'};
      p.results.push(result);
      const review = api.beginReview(p, result);
      review.items[0].selected = true;
      review.items[1].verdict = 'match';
      const plan = api.createPlan(p, review, {change: '범위 조정', keep: '기존 내용', check: '같은 기준', scope: p.output.scope});
      plan.confirmed = true;
      const next = api.makeSnapshot(p, {plan});
      const nextResult = {...result, id: 'result_next', snapshotId: next.id};
      p.results.push(nextResult);
      const recheck = api.beginReview(p, nextResult);
      expect(recheck.items.every(i => i.verdict === 'unverifiable')).toBe(true);
      expect(recheck.items[1].regression).toBe(true);
      api.updateDecision(p, p.fields.user, {value: '픽스처의 변경된 고객'}, 'user');
      expect(JSON.stringify(p.snapshots.slice(0, -2))).toBe(historical);
      return {p, s, next, recheck};
    });
  });
});

test('constructors, proposals, explicit selection and graph edits match original', () => {
  parity(api => originalGuide.ENTRIES.map(([entry]) => {
    const p = api.newProject({name: '검증', idea: '원문', entry, type: '게임'});
    api.exampleInto(p, 'user');
    api.addConcepts(p);
    api.chooseConcept(p, p.concepts[0].id);
    const f = api.addFlowExample(p);
    api.editGraph(p, f, g => {g.transitions[0].condition = '직접 확인';});
    api.acknowledgeGraph(p, f);
    return {p, issues: api.issues(p), next: api.nextAction(p)};
  }));
});

test('new snapshots and review dependency arrays never alias mutable editor data', () => {
  const api = createDomain({id: prefix => `${prefix}_frozen`, now: () => time});
  const p = api.makeSample('photo');
  const s = api.makeSnapshot(p, {draft: true});
  const bytes = JSON.stringify(s);
  expect(() => {s.input.fields.user.value = 'tampered';}).toThrow(TypeError);
  expect(() => {s.criteria[0].decisionIds.push('tampered');}).toThrow(TypeError);
  expect(() => {s.text = 'tampered';}).toThrow(TypeError);
  const result = {id: 'result_frozen', snapshotId: s.id, execution: '합성 관찰', screen: '검증'};
  p.results.push(result);
  const review = api.beginReview(p, result);
  review.items[0].decisionIds.push('editable-review');
  p.fields.user.value = '현재 편집';
  expect(JSON.stringify(s)).toBe(bytes);
  const baseline = api.baseline(p, '직접 입력한 진단 기준');
  expect(Object.isFrozen(baseline)).toBe(true);
  expect(baseline.draft).toBe(true);
  expect(baseline.baselineReason).toBe('직접 입력한 진단 기준');
});

test('domain modules have no DOM, storage, Node, network or execution dependencies', () => {
  for (const name of ['domain.ts', 'structure.ts', 'guide.ts', 'types.ts', 'value.ts']) {
    const text = readFileSync(new URL(name, import.meta.url), 'utf8');
    expect(text).not.toMatch(/\b(?:window|document|localStorage|fetch|XMLHttpRequest|WebSocket|process|Date|crypto)\s*[.(]/);
    expect(text).not.toMatch(/from\s+['"](?:node:|react|.*server\/|.*atelier\/atelier\/)/);
  }
});
