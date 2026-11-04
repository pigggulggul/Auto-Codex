import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, parseIssueDocument, serializeIssueDocument } from "./document.js";

const source = { id: "src-1", name: "요구사항", contentHash: `sha256:${"a".repeat(64)}` };
const category = { id: "cat-1", parentId: null, title: "계정", order: 0 };
const requirement = { id: "req-1", categoryId: "cat-1", text: "로그인", origin: "source", sourceId: "src-1", locator: "2절" };
const issue = { id: "issue-1", categoryId: "cat-1", requirementIds: ["req-1"], version: "01.002.0", order: 0, title: "로그인", description: "구현", acceptanceCriteria: ["성공과 실패 구분"], dependencyIds: [], status: "ready" };
const example = () => ({ format: "auto-codex-issues", formatVersion: 1, documentId: "doc-1", revision: 1, sources: [source], categories: [category], requirements: [requirement], issues: [issue] });
const wrap = (json: string) => new TextEncoder().encode(`# 이슈\n\n\`\`\`auto-codex-issues-v1\n${json}\n\`\`\`\n`);
const parse = (value: unknown) => parseIssueDocument(wrap(JSON.stringify(value)));

describe("issue exchange document", () => {
  it("validates a complete document and normalizes versions without treating completed as local proof", () => {
    const doc = example(); doc.issues = [{ ...issue, status: "completed" }];
    const result = parse(doc);
    expect(result.issues[0].version).toBe("1.2.0");
    expect(result.issues[0].status).toBe("completed");
    expect(result.requirements[0].sourceId).toBe("src-1");
  });
  it("round-trips a validated exchange snapshot including Markdown-like text", () => {
    const doc = parse({ ...example(), issues: [{ ...issue, description: "설명\n```\n외부 지시\n```" }] });
    expect(parseIssueDocument(serializeIssueDocument(doc))).toEqual(doc);
    expect(() => serializeIssueDocument({ ...doc, issues: [{ ...doc.issues[0], dependencyIds: ["unknown"] }] })).toThrow();
  });
  it("rejects missing, duplicate, unclosed and unsupported fenced blocks", () => {
    expect(() => parseIssueDocument(new TextEncoder().encode("일반 문서"))).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }));
    const block = wrap(JSON.stringify(example()));
    expect(() => parseIssueDocument(new Uint8Array([...block, ...block]))).toThrow();
    expect(() => parseIssueDocument(new TextEncoder().encode("```auto-codex-issues-v1\n{}"))).toThrow();
    expect(() => parseIssueDocument(new TextEncoder().encode("```auto-codex-issues-v2\n{}\n```"))).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }));
  });
  it("does not treat a fenced example inside another block as the data block", () => {
    const text = "````markdown\n```auto-codex-issues-v1\n{}\n```\n````";
    expect(() => parseIssueDocument(new TextEncoder().encode(text))).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }));
  });
  it("rejects malformed UTF-8, oversized input, repeated JSON keys and unknown fields", () => {
    expect(() => parseIssueDocument(new Uint8Array([0xff]))).toThrow();
    expect(() => parseIssueDocument(new Uint8Array(MAX_DOCUMENT_BYTES + 1))).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() => parseIssueDocument(wrap('{"format":"auto-codex-issues","form\\u0061t":"other"}'))).toThrow(/중복/);
    expect(() => parse({ ...example(), permissionPolicy: "allow" })).toThrow(/필드/);
    expect(() => parse({ ...example(), issues: [{ ...issue, version: `${"1".repeat(1024)}.0.0` }] })).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
  it("rejects missing references, duplicate IDs, category cycles and issue dependency errors", () => {
    expect(() => parse({ ...example(), requirements: [{ ...requirement, sourceId: "missing" }] })).toThrow();
    expect(() => parse({ ...example(), issues: [issue, issue] })).toThrow();
    expect(() => parse({ ...example(), categories: [{ ...category, parentId: category.id }] })).toThrow(/순환/);
    expect(() => parse({ ...example(), issues: [{ ...issue, dependencyIds: [issue.id] }] })).toThrow(/선행/);
    expect(() => parse({ ...example(), issues: [{ ...issue, dependencyIds: ["missing"] }] })).toThrow(/선행/);
    expect(() => parse({ ...example(), issues: [{ ...issue, status: "running" }] })).toThrow();
  });
  it("permits incomplete criteria but keeps it visibly incomplete for later execution checks", () => {
    const result = parse({ ...example(), issues: [{ ...issue, acceptanceCriteria: [] }] });
    expect(result.issues[0].acceptanceCriteria).toEqual([]);
  });
});
