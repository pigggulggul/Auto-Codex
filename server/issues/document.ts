import { normalizeVersion, validateIssuePlan } from "../../shared/issues/planning.js";

/** Per-document resource ceiling. Reaching it is an error, never a partial import. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 32_768;
const MAX_ID = 128;

export class IssueDocumentError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "UNSUPPORTED_FORMAT" | "LIMIT_EXCEEDED", message: string) { super(message); }
}

export type IssueDocument = {
  format: "auto-codex-issues"; formatVersion: 1; documentId: string; revision: number;
  sources: { id: string; name: string; contentHash: string }[];
  categories: { id: string; parentId: string | null; title: string; order: number }[];
  requirements: { id: string; categoryId: string | null; text: string; origin: "source" | "user" | "ai-proposal"; sourceId?: string; locator?: string }[];
  issues: { id: string; categoryId: string | null; requirementIds: string[]; version: string; order: number; title: string; description: string; acceptanceCriteria: string[]; dependencyIds: string[]; status: "ready" | "retryable" | "failed" | "needs_review" | "completed" }[];
};

const invalid = (message: string): never => { throw new IssueDocumentError("INVALID_INPUT", message); };
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(`${label}: 객체가 필요합니다.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) return invalid(`${label}: 알 수 없는 필드가 있습니다.`);
  return result;
}
function text(value: unknown, label: string, max = MAX_TEXT, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) return invalid(`${label}: 문자열이 필요합니다.`);
  if (value.length > max) throw new IssueDocumentError("LIMIT_EXCEEDED", `${label}: 길이 제한을 초과했습니다.`);
  return value;
}
function id(value: unknown, label: string): string {
  const result = text(value, label, MAX_ID);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) return invalid(`${label}: 식별자 형식이 올바르지 않습니다.`);
  return result;
}
function nullableId(value: unknown, label: string): string | null { return value === null ? null : id(value, label); }
function natural(value: unknown, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) return invalid(`${label}: 안전한 정수가 필요합니다.`);
  return value as number;
}
function list<T>(value: unknown, label: string, parse: (item: unknown, label: string) => T): T[] {
  if (!Array.isArray(value)) return invalid(`${label}: 배열이 필요합니다.`);
  return value.map((entry, index) => parse(entry, `${label}[${index}]`));
}
function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`${label}: 중복된 식별자가 있습니다.`);
}

/** JSON.parse accepts repeated object keys; reject them before parsing the document. */
function rejectDuplicateKeys(json: string): void {
  let pos = 0;
  const valueToken = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(json[pos] ?? "\0")) pos++; };
  const string = (): string => {
    if (json[pos] !== '"') return invalid("JSON 문자열이 올바르지 않습니다.");
    const start = pos++;
    while (pos < json.length) {
      const char = json[pos++];
      if (char === "\\") { if (pos >= json.length) return invalid("JSON 이스케이프가 올바르지 않습니다."); pos++; }
      else if (char === '"') { try { return JSON.parse(json.slice(start, pos)) as string; } catch { return invalid("JSON 문자열이 올바르지 않습니다."); } }
    }
    return invalid("JSON 문자열이 끝나지 않았습니다.");
  };
  const value = (depth: number): void => {
    if (depth > 64) throw new IssueDocumentError("LIMIT_EXCEEDED", "JSON 중첩 제한을 초과했습니다.");
    whitespace();
    if (json[pos] === '"') { string(); return; }
    if (json[pos] === "{") {
      pos++; whitespace(); const keys = new Set<string>();
      if (json[pos] === "}") { pos++; return; }
      while (true) {
        whitespace(); const key = string(); if (keys.has(key)) invalid("JSON 객체의 필드가 중복되었습니다."); keys.add(key);
        whitespace(); if (json[pos++] !== ":") invalid("JSON 객체 구분자가 올바르지 않습니다.");
        value(depth + 1); whitespace(); const end = json[pos++];
        if (end === "}") return; if (end !== ",") invalid("JSON 객체가 올바르지 않습니다.");
      }
    }
    if (json[pos] === "[") {
      pos++; whitespace(); if (json[pos] === "]") { pos++; return; }
      while (true) { value(depth + 1); whitespace(); const end = json[pos++]; if (end === "]") return; if (end !== ",") invalid("JSON 배열이 올바르지 않습니다."); }
    }
    valueToken.lastIndex = pos;
    const token = valueToken.exec(json);
    if (!token) return invalid("JSON 값이 올바르지 않습니다."); pos += token[0].length;
  };
  value(0); whitespace(); if (pos !== json.length) invalid("JSON 뒤에 추가 데이터가 있습니다.");
}

function extractBlock(markdown: string): string {
  const lines = markdown.split(/\r\n|\n|\r/);
  let fence: { char: string; length: number; target: boolean; content: string[] } | null = null;
  const blocks: string[] = [];
  let unsupportedVersion = false;
  for (const line of lines) {
    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
      if (!opening) continue;
      const info = opening[2].trim();
      if (opening[1][0] === "`" && info.includes("`")) continue;
      if (/^auto-codex-issues-v\d+$/.test(info) && info !== "auto-codex-issues-v1") unsupportedVersion = true;
      fence = { char: opening[1][0], length: opening[1].length, target: info === "auto-codex-issues-v1", content: [] };
    } else {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        if (fence.target) blocks.push(fence.content.join("\n"));
        fence = null;
      } else if (fence.target) fence.content.push(line);
    }
  }
  if (fence?.target) invalid("이슈 데이터 블록이 끝나지 않았습니다.");
  if (unsupportedVersion) throw new IssueDocumentError("UNSUPPORTED_FORMAT", "지원하지 않는 이슈 문서 버전입니다.");
  if (!blocks.length) throw new IssueDocumentError("UNSUPPORTED_FORMAT", "v1 이슈 데이터 블록이 없습니다. 일반 문서는 별도로 분석하세요.");
  if (blocks.length !== 1) invalid("v1 이슈 데이터 블록은 정확히 하나여야 합니다.");
  return blocks[0];
}

export function parseIssueDocument(bytes: Uint8Array): IssueDocument {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new IssueDocumentError("LIMIT_EXCEEDED", "문서 크기 제한을 초과했습니다.");
  let markdown: string;
  try { markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return invalid("유효한 UTF-8 문서가 아닙니다."); }
  const json = extractBlock(markdown);
  rejectDuplicateKeys(json);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return invalid("JSON을 읽을 수 없습니다."); }
  const root = object(parsed, ["format", "formatVersion", "documentId", "revision", "sources", "categories", "requirements", "issues"], "문서");
  if (root.format !== "auto-codex-issues" || root.formatVersion !== 1) throw new IssueDocumentError("UNSUPPORTED_FORMAT", "지원하지 않는 이슈 문서 형식입니다.");
  const sources = list(root.sources, "sources", (v, label) => {
    const s = object(v, ["id", "name", "contentHash"], label), hash = text(s.contentHash, `${label}.contentHash`, 71);
    if (!/^sha256:[0-9a-f]{64}$/.test(hash)) invalid(`${label}: 유효한 SHA-256 해시가 필요합니다.`);
    return { id: id(s.id, label), name: text(s.name, label, 255), contentHash: hash };
  });
  const categories = list(root.categories, "categories", (v, label) => {
    const c = object(v, ["id", "parentId", "title", "order"], label);
    return { id: id(c.id, label), parentId: nullableId(c.parentId, label), title: text(c.title, label, 255), order: natural(c.order, label) };
  });
  const requirements: IssueDocument["requirements"] = list(root.requirements, "requirements", (v, label) => {
    const r = object(v, ["id", "categoryId", "text", "origin", "sourceId", "locator"], label);
    if (r.origin !== "source" && r.origin !== "user" && r.origin !== "ai-proposal") return invalid(`${label}: 출처 유형이 올바르지 않습니다.`);
    const sourceId = r.sourceId === undefined ? undefined : id(r.sourceId, label);
    if (r.origin === "source" && !sourceId) invalid(`${label}: 원본 자료 연결이 필요합니다.`);
    const locator = r.locator === undefined ? undefined : text(r.locator, label, 1024);
    return { id: id(r.id, label), categoryId: nullableId(r.categoryId, label), text: text(r.text, label), origin: r.origin, ...(sourceId ? { sourceId } : {}), ...(locator ? { locator } : {}) };
  });
  const issues: IssueDocument["issues"] = list(root.issues, "issues", (v, label) => {
    const i = object(v, ["id", "categoryId", "requirementIds", "version", "order", "title", "description", "acceptanceCriteria", "dependencyIds", "status"], label);
    if (i.status !== "ready" && i.status !== "retryable" && i.status !== "failed" && i.status !== "needs_review" && i.status !== "completed") return invalid(`${label}: 가져올 수 없는 이슈 상태입니다.`);
    const versionInput = text(i.version, label, 1024);
    let version: string; try { version = normalizeVersion(versionInput); } catch { return invalid(`${label}: 개발 버전이 올바르지 않습니다.`); }
    const requirementIds = list(i.requirementIds, `${label}.requirementIds`, id), dependencyIds = list(i.dependencyIds, `${label}.dependencyIds`, id);
    unique(requirementIds, label); unique(dependencyIds, label);
    return { id: id(i.id, label), categoryId: nullableId(i.categoryId, label), requirementIds, version, order: natural(i.order, label), title: text(i.title, label, 255), description: text(i.description, label, MAX_TEXT, true), acceptanceCriteria: list(i.acceptanceCriteria, `${label}.acceptanceCriteria`, (v, l) => text(v, l)), dependencyIds, status: i.status };
  });
  const documentId = id(root.documentId, "documentId"), revision = natural(root.revision, "revision", 1);
  unique([documentId, ...sources.map(x => x.id), ...categories.map(x => x.id), ...requirements.map(x => x.id), ...issues.map(x => x.id)], "문서 전체");
  const sourceIds = new Set(sources.map(s => s.id)), categoryIds = new Set(categories.map(c => c.id)), requirementIds = new Set(requirements.map(r => r.id));
  for (const c of categories) if (c.parentId && !categoryIds.has(c.parentId)) invalid("분류의 상위 항목이 없습니다.");
  // Visit each category chain once without recursion, including arbitrary-depth hierarchies.
  const categoryById = new Map(categories.map(c => [c.id, c])), complete = new Set<string>();
  for (const c of categories) {
    const path = new Set<string>(); let current: string | null = c.id;
    while (current && !complete.has(current)) { if (path.has(current)) invalid("분류에 순환이 있습니다."); path.add(current); current = categoryById.get(current)!.parentId; }
    for (const entry of path) complete.add(entry);
  }
  for (const r of requirements) if (r.categoryId && !categoryIds.has(r.categoryId) || r.sourceId && !sourceIds.has(r.sourceId)) invalid("요구사항의 연결 대상이 없습니다.");
  for (const i of issues) if (i.categoryId && !categoryIds.has(i.categoryId) || i.requirementIds.some(ref => !requirementIds.has(ref))) invalid("이슈의 연결 대상이 없습니다.");
  if (validateIssuePlan(issues).length) invalid("이슈 버전 또는 선행 관계가 올바르지 않습니다.");
  return { format: "auto-codex-issues", formatVersion: 1, documentId, revision, sources, categories, requirements, issues };
}

/** Produce an exchange snapshot only; writing a file requires a separate authorized operation. */
export function serializeIssueDocument(document: IssueDocument): Uint8Array {
  const render = (value: IssueDocument) => new TextEncoder().encode(`# 이슈 계획\n\n이 문서의 이슈 데이터는 아래 JSON 블록에 있습니다.\n\n\`\`\`auto-codex-issues-v1\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`);
  // Revalidate all data and references even if the caller supplied a TypeScript value.
  const normalized = parseIssueDocument(render(document));
  const result = render(normalized);
  if (result.byteLength > MAX_DOCUMENT_BYTES) throw new IssueDocumentError("LIMIT_EXCEEDED", "문서 크기 제한을 초과했습니다.");
  return result;
}
