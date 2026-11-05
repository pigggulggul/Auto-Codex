import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { EXECUTION_JOURNAL_SCHEMA, ExecutionJournal } from "./execution-journal.js";
import { freezeExecutionIntent, prepareExecutionIntent } from "./execution-intent.js";

const input = () => ({ projectId: "project-a", documentId: "doc-a", issueId: "issue-a", projectRevision: 2, documentRevision: 3, instruction: "합성 이슈를 확인합니다.", policy: { sandbox: "workspace-write", networkAccess: false, approval: "manual", revision: 4 } });

describe("execution intent identity", () => {
  it("freezes copied input and hashes canonical fields independent of property order", () => {
    const source = input(), first = freezeExecutionIntent(source);
    const reordered = { instruction: source.instruction, documentRevision: 3, issueId: "issue-a", projectId: "project-a", policy: { revision: 4, approval: "manual", networkAccess: false, sandbox: "workspace-write" }, documentId: "doc-a", projectRevision: 2 };
    expect(freezeExecutionIntent(reordered).digest).toBe(first.digest);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/); expect(Object.isFrozen(first.intent)).toBe(true); expect(Object.isFrozen(first.intent.policy)).toBe(true);
    source.instruction = "변경된 입력"; source.policy.sandbox = "read-only";
    expect(first.intent.instruction).toBe("합성 이슈를 확인합니다."); expect(first.intent.policy.sandbox).toBe("workspace-write");
  });
  it("changes identity when any declared input or policy changes", () => {
    const original = input(), first = freezeExecutionIntent(original).digest;
    const changes = [{ projectId: "project-b" }, { documentId: "doc-b" }, { issueId: "issue-b" }, { projectRevision: 3 }, { documentRevision: 4 }, { instruction: "합성 지시문 변경" }, { policy: { ...original.policy, sandbox: "read-only" } }, { policy: { ...original.policy, revision: 5 } }];
    for (const change of changes) expect(freezeExecutionIntent({ ...original, ...change }).digest).not.toBe(first);
  });
  it("rejects missing, unknown, malformed and permission-expanding fields", () => {
    const original = input();
    for (const change of [{ projectId: "../outside" }, { projectRevision: 0 }, { documentRevision: 1.5 }, { instruction: " " }, { instruction: "hello\0world" }, { instruction: "가".repeat(21846) }, { policy: { ...original.policy, networkAccess: true } }, { policy: { ...original.policy, approval: "automatic" } }, { policy: { ...original.policy, revision: 0 } }, { policy: { ...original.policy, cwd: "outside" } }, { cwd: "outside" }]) expect(() => freezeExecutionIntent({ ...original, ...change })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(freezeExecutionIntent({ ...original, instruction: "a".repeat(65536) }).intent.instruction).toHaveLength(65536);
    const getter = vi.fn(() => "side effect");
    const accessor = { ...original }; Object.defineProperty(accessor, "instruction", { get: getter, enumerable: true });
    expect(() => freezeExecutionIntent(accessor)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" })); expect(getter).not.toHaveBeenCalled();
    expect(() => freezeExecutionIntent({ ...original, [Symbol("unknown")]: true })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
  it("binds the journal key to the server-computed snapshot without storing instruction text", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(EXECUTION_JOURNAL_SCHEMA); const journal = new ExecutionJournal(db), first = prepareExecutionIntent(journal, input(), "request-a");
      expect(first.created).toBe(true); expect(prepareExecutionIntent(journal, input(), "request-a")).toMatchObject({ created: false, record: { attemptId: first.record.attemptId } });
      expect(() => prepareExecutionIntent(journal, { ...input(), instruction: "변경된 지시문" }, "request-a")).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
      expect(() => prepareExecutionIntent(journal, { ...input(), documentRevision: 5 }, "request-a")).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
      const row = db.prepare("SELECT * FROM issue_dispatch_journal").get(); expect(JSON.stringify(row)).not.toContain(input().instruction);
      expect(journal.get("project-a", first.record.attemptId).phase).toBe("prepared");
    } finally { db.close(); }
  });
});
