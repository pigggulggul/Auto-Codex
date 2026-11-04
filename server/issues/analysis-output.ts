import { randomUUID } from "node:crypto";

/** Structured-output hint; validation below is authoritative even if a model supports schemas. */
export const requirementOutputSchema = {
  type: "object", additionalProperties: false, required: ["requirements"],
  properties: { requirements: { type: "array", maxItems: 32, items: {
    type: "object", additionalProperties: false, required: ["origin", "text", "quote", "uncertainty"],
    properties: { origin: { type: "string", enum: ["source", "ai-proposal"] }, text: { type: "string", minLength: 1, maxLength: 600 }, quote: { type: ["string", "null"], maxLength: 300 }, uncertainty: { type: "string", maxLength: 500 } },
  } } },
} as const;

export type SegmentEvidence = { snapshotId: string; projectRevision: number; sourceId: string; sourcePath: string; sourceSha256: string; segmentId: string; offset: number; text: string };
export type RequirementCandidate = { id: string; text: string; origin: "source" | "ai-proposal"; uncertainty: string; evidence: { sourceId: string; sourcePath: string; sourceSha256: string; segmentId: string; quote: string; start: number; end: number } | null };
export type SegmentRequirements = { snapshotId: string; projectRevision: number; sourceId: string; segmentId: string; requirements: RequirementCandidate[] };
export class AnalysisOutputError extends Error { constructor() { super("분석 결과의 형식 또는 원문 근거를 확인할 수 없습니다."); } }
const invalid = (): never => { throw new AnalysisOutputError(); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max && !value.includes("\0");

/** Parse model output as data; the caller supplies the trusted segment and its provenance. */
export function parseSegmentRequirements(raw: string, segment: SegmentEvidence): SegmentRequirements {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 64 * 1024) return invalid();
  let result: unknown; try { result = JSON.parse(raw); } catch { return invalid(); }
  if (!object(result) || !keys(result, ["requirements"]) || !Array.isArray(result.requirements) || result.requirements.length > 32) return invalid();
  const requirements: RequirementCandidate[] = result.requirements.map(item => {
    if (!object(item) || !keys(item, ["origin", "text", "quote", "uncertainty"]) || !(item.origin === "source" || item.origin === "ai-proposal") || !text(item.text, 600) || typeof item.text !== "string" || !item.text.trim() || !text(item.uncertainty, 500) || typeof item.uncertainty !== "string") return invalid();
    if (item.origin === "ai-proposal") {
      if (item.quote !== null || !item.uncertainty.trim()) return invalid();
      return { id: `requirement_${randomUUID()}`, text: item.text, origin: "ai-proposal", uncertainty: item.uncertainty, evidence: null };
    }
    if (!text(item.quote, 300) || typeof item.quote !== "string" || !item.quote.trim()) return invalid();
    const at = segment.text.indexOf(item.quote);
    const end = at + item.quote.length;
    if (at < 0 || segment.text.indexOf(item.quote, at + 1) >= 0 || at > 0 && /[\uDC00-\uDFFF]/.test(segment.text[at]) && /[\uD800-\uDBFF]/.test(segment.text[at - 1]) || end < segment.text.length && /[\uD800-\uDBFF]/.test(segment.text[end - 1]) && /[\uDC00-\uDFFF]/.test(segment.text[end])) return invalid();
    return { id: `requirement_${randomUUID()}`, text: item.text, origin: "source", uncertainty: item.uncertainty, evidence: { sourceId: segment.sourceId, sourcePath: segment.sourcePath, sourceSha256: segment.sourceSha256, segmentId: segment.segmentId, quote: item.quote, start: segment.offset + at, end: segment.offset + at + item.quote.length } };
  });
  return { snapshotId: segment.snapshotId, projectRevision: segment.projectRevision, sourceId: segment.sourceId, segmentId: segment.segmentId, requirements };
}
