import { check } from './errors.js';
export type Obj = Record<string, unknown>;
export type Rule = (value: unknown) => void;
export const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export function obj(v: unknown): Obj { check(object(v)); return v; }
export const text = (max = 32768, min = 0): Rule => v => check(typeof v === 'string' && Buffer.byteLength(v) <= max && v.trim().length >= min, '문자열 길이 또는 형식이 올바르지 않습니다.');
export const label = (max: number,min=0): Rule => v => check(typeof v==='string' && v.length<=max && v.trim().length>=min,'이름의 길이가 올바르지 않습니다.');
export const integer = (min = 0, max = Number.MAX_SAFE_INTEGER): Rule => v => check(Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max, '정수 범위가 올바르지 않습니다.');
export const bool: Rule = v => check(typeof v === 'boolean');
export const one = (values: readonly unknown[]): Rule => v => check(values.includes(v), '지원하지 않는 값입니다.');
export const optional = (rule: Rule): Rule => v => { if (v !== undefined) rule(v); };
export const nullable = (rule: Rule): Rule => v => { if (v !== null) rule(v); };
export const id: Rule = v => check(typeof v === 'string' && /^[a-z]+_[a-z0-9-]{1,80}$/i.test(v), '식별자 형식이 올바르지 않습니다.');
export const uuid: Rule = v => check(typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v), '요청 UUID가 올바르지 않습니다.');
export const hash: Rule = v => check(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), 'SHA-256 형식이 올바르지 않습니다.');
export const array = (rule: Rule, max = 256): Rule => v => { check(Array.isArray(v) && v.length <= max, '목록 크기를 초과했거나 형식이 올바르지 않습니다.', 'LIMIT_EXCEEDED'); for (const item of v) rule(item); };
export const ids: Rule = v => {array(id)(v);check(new Set(v as string[]).size===(v as string[]).length,'식별자 목록이 중복되었습니다.');};
export const shape = (rules: Record<string, Rule>): Rule => v => {
  const value = obj(v);
  check(Object.keys(value).every(key => Object.hasOwn(rules, key)), '허용되지 않은 필드가 있습니다.');
  for (const [key, rule] of Object.entries(rules)) rule(value[key]);
};
/** JSON drafts are inert data. Bound recursion/counts and reject prototype keys. */
export const json: Rule = value => {
  let nodes = 0;
  const visit = (v: unknown, depth: number) => {
    check(++nodes <= 250000 && depth <= 48, '자료의 중첩 또는 항목 수가 너무 큽니다.', 'LIMIT_EXCEEDED');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { check(Number.isFinite(v)); return; }
    if (typeof v === 'string') return;
    if (Array.isArray(v)) { for (const child of v) visit(child, depth + 1); return; }
    const record = obj(v);
    for (const [key, child] of Object.entries(record)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(key), '허용되지 않은 객체 키입니다.');
      // Trusted domain history constructors include absent optional fields; JSON omits them.
      if(child!==undefined)visit(child, depth + 1);
    }
  };
  visit(value, 0);
};
export function base64(value: unknown): Buffer {
  check(typeof value === 'string' && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), '정규 base64 형식이 아닙니다.');
  const bytes = Buffer.from(value, 'base64');
  check(bytes.toString('base64') === value, '정규 base64 형식이 아닙니다.');
  return bytes;
}
export const P = { designProjectId: id };
export const V = { ...P, expectedVersion: integer(1) };
export const selection = shape({ mode: one(['all', 'flows', 'screens', 'assets']), ids });
export const tabs = ['design', 'flow', 'reference', 'concept', 'style', 'brief', 'prompt', 'review'] as const;
export const progress = shape({tab: optional(one(tabs)), guideStage: optional(integer(0, 20)), returnTo: optional(nullable(json)), easy: optional(json), planDraft: optional(json)});
export const output = shape({ ...Object.fromEntries(['purpose','format','scope','tech','extra','common','procedure','procedureSource','language'].map(k => [k, optional(text())])), selection: optional(selection), commonVersion: optional(integer(1)) });
