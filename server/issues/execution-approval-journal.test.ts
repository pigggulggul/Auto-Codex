import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { EXECUTION_JOURNAL_SCHEMA, ExecutionJournal } from "./execution-journal.js";
import { ExecutionApprovalJournal } from "./execution-approval-journal.js";

function setup() {
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); db.exec(EXECUTION_JOURNAL_SCHEMA);
  const attempts = new ExecutionJournal(db);
  const record = attempts.prepare({ projectId: "project-a", issueId: "issue-a", idempotencyKey: "key-a", projectRevision: 1, requestDigest: "a".repeat(64) }).record;
  attempts.beginDispatch("project-a", record.attemptId); attempts.markRunning("project-a", record.attemptId, "thread-a", "turn-a");
  return { db, attempts, approvals: new ExecutionApprovalJournal(db), binding: { projectId: "project-a", attemptId: record.attemptId, threadId: "thread-a", turnId: "turn-a", requestId: 42 } };
}

describe("issue approval journal", () => {
  it("records only an owned request and rejects duplicates and foreign turns", () => {
    const { db, approvals, binding } = setup();
    try {
      expect(() => approvals.recordRequest({ ...binding, turnId: "foreign" }, "command")).toThrow();
      expect(() => approvals.recordRequest({ ...binding, projectId: "project-b" }, "command")).toThrow();
      approvals.recordRequest(binding, "command");
      expect(() => approvals.recordRequest(binding, "command")).toThrow();
      expect(db.prepare("SELECT kind,state,decision FROM issue_approval_journal").get()).toMatchObject({ kind: "command", state: "pending", decision: null });
      expect(JSON.stringify(db.prepare("SELECT * FROM issue_approval_journal").get())).not.toContain("thread-a");
    } finally { db.close(); }
  });
  it("persists the response boundary and rejects forged, repeated and late decisions", () => {
    const { db, attempts, approvals, binding } = setup();
    try {
      approvals.recordRequest(binding, "permission");
      expect(attempts.history(binding.projectId).items[0].approvals).toMatchObject({ pending: 1, responding: 0, outcome_unknown: 0 });
      expect(() => approvals.beginResponse({ ...binding, requestId: "42" }, "accept")).toThrow();
      approvals.beginResponse(binding, "decline");
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "responding", decision: "decline" });
      expect(() => approvals.beginResponse(binding, "accept")).toThrow();
      approvals.finishResponse(binding, "outcome_unknown");
      expect(attempts.history(binding.projectId).items[0].approvals).toMatchObject({ pending: 0, responding: 0, outcome_unknown: 1 });
      expect(() => approvals.finishResponse(binding, "sent")).toThrow();
      attempts.markOutcomeUnknown(binding.projectId, binding.attemptId);
      expect(() => approvals.recordRequest({ ...binding, requestId: 43 }, "file")).toThrow();
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "outcome_unknown", decision: "decline" });
    } finally { db.close(); }
  });
  it("keeps a response in flight when its delivery is not confirmed", () => {
    const { db, approvals, binding } = setup();
    try {
      approvals.recordRequest(binding, "file"); approvals.beginResponse(binding, "accept");
      expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("responding");
      expect(() => approvals.recordRequest({ ...binding, requestId: Number.NaN }, "file")).toThrow();
      expect(() => approvals.beginResponse({ ...binding, threadId: "other" }, "accept")).toThrow();
    } finally { db.close(); }
  });
  it("invalidates pending requests and preserves uncertain delivery after an unknown attempt", () => {
    const { db, attempts, approvals, binding } = setup();
    try {
      approvals.recordRequest(binding, "command");
      approvals.recordRequest({ ...binding, requestId: 43 }, "permission");
      approvals.beginResponse(binding, "accept");
      expect(() => approvals.invalidateUnknownAttempt(binding.projectId, binding.attemptId)).toThrow();
      attempts.markOutcomeUnknown(binding.projectId, binding.attemptId);
      expect(() => approvals.invalidateUnknownAttempt("project-other", binding.attemptId)).toThrow();
      expect(approvals.invalidateUnknownAttempt(binding.projectId, binding.attemptId)).toEqual({ expired: 0, unknown: 0 });
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal ORDER BY state").all()).toMatchObject([{ state: "expired", decision: null }, { state: "outcome_unknown", decision: "accept" }]);
      expect(approvals.invalidateUnknownAttempt(binding.projectId, binding.attemptId)).toEqual({ expired: 0, unknown: 0 });
    } finally { db.close(); }
  });
  it("prevents terminal transitions while an approval is pending or delivery is unknown", () => {
    const { db, attempts, approvals, binding } = setup();
    try {
      approvals.recordRequest(binding, "command");
      expect(() => attempts.beginVerification(binding.projectId, binding.attemptId)).toThrow();
      expect(() => attempts.settle(binding.projectId, binding.attemptId, "failed")).toThrow();
      approvals.beginResponse(binding, "accept");
      expect(() => attempts.beginVerification(binding.projectId, binding.attemptId)).toThrow();
      approvals.finishResponse(binding, "outcome_unknown");
      expect(() => attempts.settle(binding.projectId, binding.attemptId, "interrupted")).toThrow();
      attempts.markOutcomeUnknown(binding.projectId, binding.attemptId);
      expect(attempts.get(binding.projectId, binding.attemptId).phase).toBe("outcome_unknown");
    } finally { db.close(); }
  });
  it("rolls back approval invalidation when marking the attempt unknown fails", () => {
    const { db, attempts, approvals, binding } = setup();
    try {
      approvals.recordRequest(binding, "command");
      db.exec("CREATE TRIGGER reject_expiry BEFORE UPDATE ON issue_approval_journal BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
      expect(() => attempts.markOutcomeUnknown(binding.projectId, binding.attemptId)).toThrow();
      expect(attempts.get(binding.projectId, binding.attemptId).phase).toBe("running");
      expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("pending");
    } finally { db.close(); }
  });
});
