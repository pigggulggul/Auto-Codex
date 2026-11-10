import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IssueStore } from "./store.js";
import { MAX_DOCUMENT_BYTES } from "./document.js";
import { dispatchIssueWorkerRequest, safeIssueWorkerError, validateIssueWorkerRequest } from "./worker-service.js";
import { ExecutionApprovalRelay } from "./execution-approval-relay.js";
import { ExecutionJournalError } from "./execution-journal.js";
import { StoredIntentError } from "./execution-stored-intent.js";
import { PlanningDraft } from "./planning-draft.js";

const scratch = path.resolve(".cache"), roots: string[] = [], stores: IssueStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) { expect(path.dirname(await realpath(root))).toBe(await realpath(scratch)); await rm(root, { recursive: true, force: true }); }
});
async function setup() {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, "issue-worker-service-")); roots.push(root);
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  const store = await IssueStore.open(root); stores.push(store); return { root, workspace, store };
}
const project = "project_12345678-1234-4123-8123-123456789abc";

describe("issue worker internal contract", () => {
  it("validates and isolates persisted draft requests by project", async () => {
    const { store, workspace, root } = await setup(), other = path.join(root, "other"); await mkdir(other);
    const first = await store.createProject(workspace), second = await store.createProject(other);
    const draft = new PlanningDraft({ format: "auto-codex-issues", formatVersion: 1, documentId: "draft", revision: 1, sources: [], categories: [], requirements: [], issues: [] }, 1).read();
    expect(await dispatchIssueWorkerRequest(store, { operation: "planning.save", projectId: first.id, expectedRevision: 1, expectedGeneration: 0, snapshot: draft })).toMatchObject({ kind: "planning.save", generation: 1 });
    expect(await dispatchIssueWorkerRequest(store, { operation: "planning.read", projectId: second.id, expectedRevision: 1 })).toEqual({ kind: "planning.read", draft: null });
    expect(await dispatchIssueWorkerRequest(store, { operation: "planning.read", projectId: first.id, expectedRevision: 1 })).toMatchObject({ draft: { generation: 1, stale: false } });
    expect(() => validateIssueWorkerRequest({ operation: "planning.save", projectId: first.id, expectedRevision: 1, expectedGeneration: 1, snapshot: draft, extra: true })).toThrow();
    expect(() => validateIssueWorkerRequest({ operation: "planning.save", projectId: first.id, expectedRevision: 2, expectedGeneration: 1, snapshot: draft })).toThrow();
  });
  it("blocks a different project while any prior execution is unresolved", async () => {
    const { store, workspace, root } = await setup(), other = path.join(root, "other"); await mkdir(other);
    const first = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    const second = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: other });
    if (first.kind !== "project" || second.kind !== "project") throw new Error("wrong response");
    const doc = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc", revision: 1, sources: [], categories: [], requirements: [], issues: [{ id: "issue", categoryId: null, requirementIds: [], version: "1.0.0", order: 0, title: "synthetic", description: "", acceptanceCriteria: ["test"], dependencyIds: [], status: "ready" }] };
    const bytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(doc)}\n\`\`\``);
    for (const projectId of [first.id, second.id]) await dispatchIssueWorkerRequest(store, { operation: "document.import", projectId, expectedRevision: 1, bytes });
    const request = (projectId: string) => ({ operation: "execution.prepare", projectId, documentId: "doc", issueId: "issue", expectedRevision: 2, idempotencyKey: "key", policy: { sandbox: "workspace-write", networkAccess: false, approval: "manual", revision: 1 } });
    const created = await dispatchIssueWorkerRequest(store, request(first.id));
    if (created.kind !== "execution.prepare") throw new Error("wrong response");
    await expect(dispatchIssueWorkerRequest(store, request(second.id))).rejects.toMatchObject({ code: "PROJECT_BUSY" });
    const reopened = await IssueStore.open(root);
    try { await expect(dispatchIssueWorkerRequest(reopened, request(second.id))).rejects.toMatchObject({ code: "PROJECT_BUSY" }); }
    finally { reopened.close(); }
    expect(await dispatchIssueWorkerRequest(store, request(first.id))).toMatchObject({ created: false, record: { attemptId: created.record.attemptId } });
    const transition = { operation: "execution.transition", projectId: first.id, attemptId: created.record.attemptId, expectedRevision: 2 };
    for (const action of [{ type: "dispatch" }, { type: "running", threadId: "thread", turnId: "turn" }, { type: "unknown" }]) {
      await dispatchIssueWorkerRequest(store, { ...transition, action });
      await expect(dispatchIssueWorkerRequest(store, request(second.id))).rejects.toMatchObject({ code: "PROJECT_BUSY" });
    }
    // The worker itself is internal and trusts its caller to have established
    // process termination and explicit user review before this operation.
    await dispatchIssueWorkerRequest(store, { operation: "execution.reconcile", projectId: first.id, attemptId: created.record.attemptId, expectedRevision: 2, reason: "synthetic review" });
    const secondAttempt = await dispatchIssueWorkerRequest(store, request(second.id));
    if (secondAttempt.kind !== "execution.prepare") throw new Error("wrong response");
    await dispatchIssueWorkerRequest(store, { operation: "execution.transition", projectId: second.id, attemptId: secondAttempt.record.attemptId, expectedRevision: 2, action: { type: "settle", outcome: "interrupted" } });
    const concurrentStore = await IssueStore.open(root);
    try {
      const results = await Promise.allSettled([
        dispatchIssueWorkerRequest(store, { ...request(first.id), idempotencyKey: "new-key" }),
        dispatchIssueWorkerRequest(concurrentStore, { ...request(second.id), idempotencyKey: "new-key" }),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toMatchObject([{ reason: { code: "PROJECT_BUSY" } }]);
    } finally { concurrentStore.close(); }
  });
  it("journals a synthetic issue attempt and correlated approval through the store", async () => {
    const { store, workspace } = await setup();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    if (created.kind !== "project") throw new Error("wrong response");
    const doc = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc", revision: 1, sources: [], categories: [], requirements: [], issues: [{ id: "issue-a", categoryId: null, requirementIds: [], version: "1.0.0", order: 0, title: "합성", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] };
    const bytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(doc)}\n\`\`\``);
    await dispatchIssueWorkerRequest(store, { operation: "document.import", projectId: created.id, expectedRevision: 1, bytes });
    const prepare = { operation: "execution.prepare", projectId: created.id, documentId: "doc", issueId: "issue-a", expectedRevision: 2, idempotencyKey: "key-a", policy: { sandbox: "workspace-write", networkAccess: false, approval: "manual", revision: 1 } };
    const prepared = await dispatchIssueWorkerRequest(store, prepare);
    if (prepared.kind !== "execution.prepare") throw new Error("wrong response");
    expect(prepared).toMatchObject({ created: true, record: { phase: "prepared" } });
    expect(await dispatchIssueWorkerRequest(store, prepare)).toMatchObject({ created: false, record: { attemptId: prepared.record.attemptId } });
    const transition = { operation: "execution.transition", projectId: created.id, expectedRevision: 2, attemptId: prepared.record.attemptId };
    await expect(dispatchIssueWorkerRequest(store, { ...transition, expectedRevision: 1, action: { type: "dispatch" } })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await dispatchIssueWorkerRequest(store, { ...transition, action: { type: "dispatch" } })).toMatchObject({ record: { phase: "dispatching" } });
    await dispatchIssueWorkerRequest(store, { ...transition, action: { type: "running", threadId: "thread", turnId: "turn" } });
    const binding = { projectId: created.id, attemptId: prepared.record.attemptId, threadId: "thread", turnId: "turn", requestId: 8 };
    const approval = { operation: "execution.approval", binding, expectedRevision: 2 };
    await dispatchIssueWorkerRequest(store, { ...approval, action: { type: "request", kind: "command" } });
    await expect(dispatchIssueWorkerRequest(store, { ...transition, action: { type: "verifying" } })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await dispatchIssueWorkerRequest(store, { ...transition, action: { type: "unknown" } })).toMatchObject({ record: { phase: "outcome_unknown" } });
    const history = await dispatchIssueWorkerRequest(store, { operation: "execution.history", projectId: created.id, expectedRevision: 2, afterId: null });
    expect(history).toMatchObject({ kind: "execution.history", page: { items: [{ phase: "outcome_unknown", approvals: { expired: 1 } }] } });
    const recovery = { operation: "execution.reconcile", projectId: created.id, attemptId: prepared.record.attemptId, expectedRevision: 2, reason: "synthetic review" };
    await expect(dispatchIssueWorkerRequest(store, { ...recovery, expectedRevision: 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await dispatchIssueWorkerRequest(store, recovery)).toMatchObject({ kind: "execution.reconcile", record: { phase: "settled", outcome: "reconciled_unknown" } });
    await expect(dispatchIssueWorkerRequest(store, recovery)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
  it("persists an owned approval through the relay and store before the synthetic write", async () => {
    const { store, workspace, root } = await setup(), owner = new AbortController();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    if (created.kind !== "project") throw new Error("wrong response");
    const db = new DatabaseSync(path.join(root, ".local-data", "issues", "issues.sqlite"));
    try {
      db.prepare("INSERT INTO issue_dispatch_journal(attempt_id,project_id,idempotency_key,issue_id,project_revision,request_digest,phase,thread_id,turn_id) VALUES(?,?,?,?,?,?,?,?,?)").run("attempt-a", created.id, "key", "issue-a", 1, "a".repeat(64), "running", "thread", "turn");
      const binding = { projectId: created.id, attemptId: "attempt-a", threadId: "thread", turnId: "turn", requestId: 8 };
      const events: string[] = [];
      const relay = new ExecutionApprovalRelay({
        valid: (b, signal) => signal === owner.signal && b.projectId === created.id && b.attemptId === "attempt-a" && b.threadId === "thread" && b.turnId === "turn" && b.requestId === 8,
        persist: async (b, action) => { await dispatchIssueWorkerRequest(store, { operation: "execution.approval", binding: b, expectedRevision: 1, action }); events.push(action.type); },
        show: () => { expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("pending"); events.push("show"); },
        send: () => { expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("responding"); events.push("send"); },
        unsafe: () => { events.push("unsafe"); },
      });
      const approvalId = await relay.request(binding, "command", owner.signal);
      await relay.respond(approvalId, owner.signal, "decline");
      expect(events).toEqual(["request", "show", "respond", "send", "finish"]);
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "sent", decision: "decline" });
    } finally { db.close(); }
  });
  it("records a correlated approval through the worker and rejects stale revisions", async () => {
    const { store, workspace, root } = await setup();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    if (created.kind !== "project") throw new Error("wrong response");
    const db = new DatabaseSync(path.join(root, ".local-data", "issues", "issues.sqlite"));
    try {
      db.prepare("INSERT INTO issue_dispatch_journal(attempt_id,project_id,idempotency_key,issue_id,project_revision,request_digest,phase,thread_id,turn_id) VALUES(?,?,?,?,?,?,?,?,?)").run("attempt-a", created.id, "key", "issue-a", 1, "a".repeat(64), "running", "thread", "turn");
      const binding = { projectId: created.id, attemptId: "attempt-a", threadId: "thread", turnId: "turn", requestId: 5 };
      const request = { operation: "execution.approval", binding, expectedRevision: 1, action: { type: "request", kind: "command" } };
      expect(await dispatchIssueWorkerRequest(store, request)).toEqual({ kind: "execution.approval" });
      await expect(dispatchIssueWorkerRequest(store, { ...request, expectedRevision: 2, action: { type: "respond", decision: "accept" } })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await expect(dispatchIssueWorkerRequest(store, { ...request, binding: { ...binding, turnId: "other" }, action: { type: "respond", decision: "accept" } })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      expect(await dispatchIssueWorkerRequest(store, { ...request, action: { type: "respond", decision: "decline" } })).toEqual({ kind: "execution.approval" });
      expect(await dispatchIssueWorkerRequest(store, { ...request, action: { type: "finish", result: "sent" } })).toEqual({ kind: "execution.approval" });
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "sent", decision: "decline" });
      const pending = { ...request, binding: { ...binding, requestId: 6 } };
      await dispatchIssueWorkerRequest(store, pending);
      const inFlight = { ...request, binding: { ...binding, requestId: 7 } };
      await dispatchIssueWorkerRequest(store, inFlight);
      await dispatchIssueWorkerRequest(store, { ...inFlight, action: { type: "respond", decision: "accept" } });
      db.prepare("UPDATE issue_dispatch_journal SET phase='outcome_unknown' WHERE attempt_id=?").run("attempt-a");
      await expect(dispatchIssueWorkerRequest(store, { operation: "execution.invalidateApprovals", projectId: created.id, attemptId: "attempt-a", expectedRevision: 2 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      expect(await dispatchIssueWorkerRequest(store, { operation: "execution.invalidateApprovals", projectId: created.id, attemptId: "attempt-a", expectedRevision: 1 })).toEqual({ kind: "execution.invalidateApprovals", expired: 1, unknown: 1 });
      expect(db.prepare("SELECT phase FROM issue_dispatch_journal WHERE attempt_id=?").get("attempt-a")?.phase).toBe("outcome_unknown");
    } finally { db.close(); }
  });
  it("rejects unknown operations, permission fields, malformed IDs and oversized documents", () => {
    for (const request of [
      null, [], { operation: "shell.run" },
      { operation: "project.create", selectedPath: "test", network: true },
      { operation: "project.read", projectId: "wrong" },
      { operation: "execution.approval", binding: { projectId: project, attemptId: "attempt", threadId: "thread", turnId: "turn", requestId: 1, permission: "all" }, expectedRevision: 1, action: { type: "request", kind: "command" } },
      { operation: "execution.approval", binding: { projectId: project, attemptId: "attempt", threadId: "thread", turnId: "turn", requestId: 1 }, expectedRevision: 1, action: { type: "respond", decision: "acceptForSession" } },
      ...["", " ", "x\0y", "x".repeat(2001)].map(reason => ({ operation: "execution.reconcile", projectId: project, attemptId: "attempt", expectedRevision: 1, reason })),
      { operation: "execution.reconcile", projectId: project, attemptId: "attempt", expectedRevision: 1, reason: "reviewed", confirmed: true },
      { operation: "document.read", projectId: project, documentId: "../outside" },
      { operation: "document.import", projectId: project, expectedRevision: 1, bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1) },
      { operation: "document.list", projectId: project, expectedRevision: 1, limit: 101 },
      { operation: "issue.list", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, filters: { status: ["ready"] } },
      { operation: "issue.list", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, filters: { version: "1.2.3", path: "elsewhere" } },
      { operation: "document.diagnostics", projectId: project, documentId: "doc", expectedRevision: 1, offset: -1 },
      { operation: "document.diagnostics", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, path: "elsewhere" },
      { operation: "document.sourceTrace", projectId: project, documentId: "../outside", expectedRevision: 1, offset: 0 },
      { operation: "document.sourceTrace", projectId: project, documentId: "doc", expectedRevision: 1, offset: -1 },
      { operation: "document.sourceTrace", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, path: "elsewhere" },
      ...[[], ["a", "a"], ["../outside"], Array.from({ length: 9 }, (_, i) => `i-${i}`)].map(issueIds => ({ operation: "issue.candidatePreview", projectId: project, documentId: "doc", expectedRevision: 1, issueIds })),
      { operation: "issue.candidatePreview", projectId: project, documentId: "doc", expectedRevision: 1, issueIds: ["issue"], permission: "all" },
      ...[{ includeRetryable: 1, includeFailed: false }, { includeRetryable: true }, { includeRetryable: false, includeFailed: false, permissions: "all" }].map(options => ({ operation: "issue.candidatePreview", projectId: project, documentId: "doc", expectedRevision: 1, issueIds: ["issue"], options })),
      { operation: "requirement.detail", projectId: project, documentId: "doc", expectedRevision: 1, requirementId: "../outside", offset: 0 },
      { operation: "requirement.detail", projectId: project, documentId: "doc", expectedRevision: 1, requirementId: "req", offset: -1 },
      { operation: "requirement.detail", projectId: project, documentId: "doc", expectedRevision: 1, requirementId: "req", offset: 0, network: true },
      { operation: "category.list", projectId: project, documentId: "doc", expectedRevision: 1, parentId: "../outside", offset: 0 },
      { operation: "category.list", projectId: project, documentId: "doc", expectedRevision: 1, parentId: null, offset: -1 },
      { operation: "issue.projectSearch", projectId: project, expectedRevision: 1, cursor: { issueOffset: -1 } },
      { operation: "issue.projectSearch", projectId: project, expectedRevision: 1, cursor: { issueOffset: 0 }, filters: { categoryId: "foreign" } },
    ]) expect(() => validateIssueWorkerRequest(request)).toThrow();
  });
  it("dispatches only valid requests against the internal store", async () => {
    const { store, workspace } = await setup();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    expect(created.kind).toBe("project"); if (created.kind !== "project") throw new Error("wrong response");
    expect(await dispatchIssueWorkerRequest(store, { operation: "project.read", projectId: created.id })).toEqual(created);
    expect(await dispatchIssueWorkerRequest(store, { operation: "document.list", projectId: created.id, expectedRevision: 1 })).toMatchObject({ kind: "documents", documents: [] });
    await expect(dispatchIssueWorkerRequest(store, { operation: "document.read", projectId: created.id, documentId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("dispatches requirement detail against a real store at the expected revision", async () => {
    const { store, workspace } = await setup();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    if (created.kind !== "project") throw new Error("wrong response");
    const doc = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc", revision: 1, sources: [], categories: [], requirements: [{ id: "req", categoryId: null, text: "합성", origin: "user" }], issues: [{ id: "issue", categoryId: null, requirementIds: ["req"], version: "1.0.0", order: 0, title: "이슈", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] };
    const bytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(doc)}\n\`\`\``);
    await dispatchIssueWorkerRequest(store, { operation: "document.import", projectId: created.id, expectedRevision: 1, bytes });
    const request = { operation: "requirement.detail", projectId: created.id, documentId: "doc", expectedRevision: 2, requirementId: "req", offset: 0 };
    expect(await dispatchIssueWorkerRequest(store, request)).toMatchObject({ kind: "requirement.detail", requirement: { id: "req", linkedIssueCount: 1 }, page: { items: [{ id: "issue" }], nextOffset: null } });
    await expect(dispatchIssueWorkerRequest(store, { ...request, expectedRevision: 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("passes explicit retry and failed preview options through the worker without changing state", async () => {
    const { store, workspace } = await setup();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    if (created.kind !== "project") throw new Error("wrong response");
    const issues = ["retryable", "failed"].map((status, order) => ({ id: `issue-${status}`, categoryId: null, requirementIds: [], version: "1.0.0", order, title: status, description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status }));
    const doc = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc", revision: 1, sources: [], categories: [], requirements: [], issues };
    const bytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(doc)}\n\`\`\``);
    await dispatchIssueWorkerRequest(store, { operation: "document.import", projectId: created.id, expectedRevision: 1, bytes });
    const request = { operation: "issue.candidatePreview", projectId: created.id, documentId: "doc", expectedRevision: 2, issueIds: issues.map(item => item.id) };
    const basic = await dispatchIssueWorkerRequest(store, request);
    if (basic.kind !== "issue.candidatePreview") throw new Error("wrong response");
    expect(basic.items.map(item => item.candidateReasons)).toEqual([["state"], ["state"]]);
    const selected = await dispatchIssueWorkerRequest(store, { ...request, options: { includeRetryable: true, includeFailed: true } });
    if (selected.kind !== "issue.candidatePreview") throw new Error("wrong response");
    expect(selected.items.map(item => item.candidateReasons)).toEqual([[], []]);
    expect((await store.readProject(created.id)).revision).toBe(2);
  });
  it("does not expose unknown exception messages or stack data", () => {
    expect(safeIssueWorkerError(new Error("private synthetic value"))).toEqual({ code: "STORAGE_FAILED", message: "이슈 저장소 작업에 실패했습니다. 기존 데이터를 확인하세요." });
    expect(safeIssueWorkerError(null).message).not.toContain("private synthetic value");
  });
  it("returns bounded actionable errors for internal execution failures", () => {
    expect(safeIssueWorkerError(new StoredIntentError("NOT_ELIGIBLE"))).toMatchObject({ code: "NOT_ELIGIBLE", message: "이 이슈는 현재 실행 조건을 충족하지 않습니다." });
    expect(safeIssueWorkerError(new ExecutionJournalError("PROJECT_BUSY"))).toMatchObject({ code: "PROJECT_BUSY" });
    const corrupted = new ExecutionJournalError("CORRUPT_RECORD"); corrupted.message = "private synthetic detail";
    expect(safeIssueWorkerError(corrupted).message).not.toContain("private synthetic detail");
  });
});
