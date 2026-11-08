import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ExecutionJournal, EXECUTION_JOURNAL_SCHEMA } from "./execution-journal.js";
import { ExecutionApprovalJournal } from "./execution-approval-journal.js";
import { ExecutionApprovalRelay } from "./execution-approval-relay.js";

function fixture() {
  const db = new DatabaseSync(":memory:"); db.exec(EXECUTION_JOURNAL_SCHEMA);
  const attempts = new ExecutionJournal(db), approvals = new ExecutionApprovalJournal(db);
  const record = attempts.prepare({ projectId: "project-a", issueId: "issue-a", idempotencyKey: "key", projectRevision: 1, requestDigest: "a".repeat(64) }).record;
  attempts.beginDispatch("project-a", record.attemptId); attempts.markRunning("project-a", record.attemptId, "thread", "turn");
  const binding = { projectId: "project-a", attemptId: record.attemptId, threadId: "thread", turnId: "turn", requestId: 1 };
  return { db, approvals, binding, owner: new AbortController() };
}

describe("issue approval relay", () => {
  it("persists the correlated request and decision before the local protocol write", async () => {
    const { db, approvals, binding, owner } = fixture(), events: string[] = [];
    try {
      const relay = new ExecutionApprovalRelay({ valid: () => true, persist: async (b, action) => { events.push(action.type); if (action.type === "request") approvals.recordRequest(b, action.kind); else if (action.type === "respond") approvals.beginResponse(b, action.decision); else approvals.finishResponse(b, action.result); }, show: () => { expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("pending"); events.push("show"); }, send: () => { expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("responding"); events.push("send"); }, unsafe: () => events.push("unsafe") });
      const approvalId = await relay.request(binding, "command", owner.signal);
      await expect(relay.respond(approvalId, new AbortController().signal, "accept")).rejects.toThrow();
      await relay.respond(approvalId, owner.signal, "decline");
      await expect(relay.respond(approvalId, owner.signal, "accept")).rejects.toThrow();
      expect(events).toEqual(["request", "show", "respond", "send", "finish"]);
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "sent", decision: "decline" });
    } finally { db.close(); }
  });
  it("does not send an approval after ownership is withdrawn during storage", async () => {
    const { db, approvals, binding, owner } = fixture(); let release!: () => void, sent = 0, unsafe = 0;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    try {
      const relay = new ExecutionApprovalRelay({ valid: () => true, persist: async (b, action) => { if (action.type === "request") approvals.recordRequest(b, action.kind); if (action.type === "respond") { approvals.beginResponse(b, action.decision); await delayed; } }, show: () => {}, send: () => { sent++; }, unsafe: () => { unsafe++; } });
      const approvalId = await relay.request(binding, "command", owner.signal);
      const response = relay.respond(approvalId, owner.signal, "accept"); owner.abort(); release();
      await expect(response).rejects.toThrow(); expect(sent).toBe(0); expect(unsafe).toBe(1);
      expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("responding");
    } finally { db.close(); }
  });
  it("latches unsafe and preserves an uncertain delivery if the local write throws", async () => {
    const { db, approvals, binding, owner } = fixture(); let unsafe = 0;
    try {
      const relay = new ExecutionApprovalRelay({ valid: () => true, persist: async (b, action) => { if (action.type === "request") approvals.recordRequest(b, action.kind); else if (action.type === "respond") approvals.beginResponse(b, action.decision); else approvals.finishResponse(b, action.result); }, show: () => {}, send: () => { throw new Error("synthetic write failure"); }, unsafe: () => { unsafe++; } });
      const approvalId = await relay.request(binding, "file", owner.signal);
      await expect(relay.respond(approvalId, owner.signal, "accept")).rejects.toThrow();
      expect(unsafe).toBe(1); expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("outcome_unknown");
    } finally { db.close(); }
  });
  it("does not mark a response sent before an asynchronous write settles", async () => {
    const { db, approvals, binding, owner } = fixture(); let rejectWrite!: (error: Error) => void, unsafe = 0;
    const write = new Promise<void>((_, reject) => { rejectWrite = reject; });
    try {
      const relay = new ExecutionApprovalRelay({ valid: () => true, persist: async (b, action) => { if (action.type === "request") approvals.recordRequest(b, action.kind); else if (action.type === "respond") approvals.beginResponse(b, action.decision); else approvals.finishResponse(b, action.result); }, show: () => {}, send: () => write, unsafe: () => { unsafe++; } });
      const approvalId = await relay.request(binding, "command", owner.signal);
      const response = relay.respond(approvalId, owner.signal, "accept");
      await Promise.resolve();
      expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("responding");
      rejectWrite(new Error("synthetic asynchronous failure"));
      await expect(response).rejects.toThrow();
      expect(unsafe).toBe(1); expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("outcome_unknown");
    } finally { db.close(); }
  });
  it("stops on owner disconnect and refuses later requests", async () => {
    const { db, approvals, binding, owner } = fixture(); let stopped = 0;
    try {
      const relay = new ExecutionApprovalRelay({ valid: () => true, persist: async (b, action) => { if (action.type === "request") approvals.recordRequest(b, action.kind); }, show: () => {}, send: () => { throw new Error("must not send"); }, unsafe: () => { stopped++; } });
      await relay.request(binding, "command", owner.signal);
      owner.abort(); expect(stopped).toBe(1);
      await expect(relay.request({ ...binding, requestId: 2 }, "command", new AbortController().signal)).rejects.toThrow();
    } finally { db.close(); }
  });
});
