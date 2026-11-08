import { describe, expect, it, vi } from "vitest";
import { IssueProjectContext, type IssueProjectSelection } from "./project-context.js";
import { ExecutionApprovalRouter } from "./execution-approval-router.js";
import { IssueWorkerClientError } from "./worker-client.js";
import type { IssueWorkerRequest, IssueWorkerResult } from "./worker-contract.js";

const project = { id: "project_12345678-1234-4123-8123-123456789abc", revision: 1 };
const initial = (): IssueProjectSelection => ({ workspaceMode: "project", projectPath: "C:/synthetic/one", generation: 1 });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("bridge-owned issue project context", () => {
  it("does not send reconciliation without a current trusted guard", async () => {
    const calls: IssueWorkerRequest[] = [];
    const context = new IssueProjectContext(initial, { request: async input => { calls.push(input); if (input.operation === "project.lookup") return { kind: "project.lookup", project }; throw new Error("must not mutate"); } });
    await expect(context.reconcileExecution({ projectId: project.id, attemptId: "attempt-a", expectedRevision: 1, reason: "synthetic review" }, () => false)).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(calls.map(call => call.operation)).toEqual(["project.lookup"]);
  });
  it("snapshots only recovery fields before an asynchronous project lookup", async () => {
    const waiting = deferred<IssueWorkerResult>(), calls: IssueWorkerRequest[] = [];
    const context = new IssueProjectContext(initial, { request: input => {
      calls.push(input);
      if (input.operation === "project.lookup") return waiting.promise;
      return Promise.reject(new IssueWorkerClientError("WORKER_UNAVAILABLE", "synthetic"));
    } });
    const input = { projectId: project.id, attemptId: "attempt-a", expectedRevision: 1, reason: "reviewed", operation: "project.create" };
    const result = context.reconcileExecution(input, () => true);
    input.attemptId = "attempt-other"; input.reason = "changed";
    waiting.resolve({ kind: "project.lookup", project });
    await expect(result).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
    expect(calls[1]).toEqual({ operation: "execution.reconcile", projectId: project.id, attemptId: "attempt-a", expectedRevision: 1, reason: "reviewed" });
  });
  it("reports uncertain reconciliation if the guard expires after a worker mutation", async () => {
    let allowed = true; const pending = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(initial, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return pending.promise; } });
    const result = context.reconcileExecution({ projectId: project.id, attemptId: "attempt-a", expectedRevision: 1, reason: "synthetic review" }, () => allowed);
    await started.promise; allowed = false;
    pending.resolve({ kind: "execution.reconcile", record: {} as never });
    await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("persists owned approval events through the selected project before sending a decision", async () => {
    const calls: IssueWorkerRequest[] = [], events: string[] = [], shown: string[] = [], owner = new AbortController();
    const context = new IssueProjectContext(initial, { request: async (input, mayStart) => {
      expect(mayStart?.()).toBe(true); calls.push(input);
      if (input.operation === "project.lookup") return { kind: "project.lookup", project };
      if (input.operation === "execution.approval") { events.push(input.action.type); return { kind: "execution.approval" }; }
      throw new Error("unexpected operation");
    } });
    const router = new ExecutionApprovalRouter({ show: (_owner, id) => { events.push("show"); shown.push(id); }, write: () => { events.push("write"); }, deny: () => { events.push("deny"); }, resolved: () => { events.push("resolved"); } });
    const session = await context.registerExecutionApprovals(router, { projectId: project.id, expectedRevision: 1, attemptId: "attempt-a", owner: owner.signal }, () => true, () => { events.push("unsafe"); });
    session.bindThread("thread-a"); session.bindTurn("turn-a");
    expect(router.serverRequest({ id: 7, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId: "turn-a" } })).toBe(true);
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    await expect(router.resolve(shown[0], new AbortController().signal, "accept")).rejects.toThrow();
    await router.resolve(shown[0], owner.signal, "decline"); session.close();
    expect(events).toEqual(["request", "show", "respond", "write", "finish", "resolved"]);
    const entries = calls.filter(input => input.operation === "execution.approval");
    expect(entries).toHaveLength(3);
    for (const entry of entries) expect(entry).toMatchObject({ expectedRevision: 1, binding: { projectId: project.id, attemptId: "attempt-a", threadId: "thread-a", turnId: "turn-a", requestId: 7 } });
  });
  it("refuses registration when the project or admission changed", async () => {
    const context = new IssueProjectContext(initial, { request: async () => ({ kind: "project.lookup", project }) });
    const router = new ExecutionApprovalRouter({ show: () => {}, write: () => {}, deny: () => {}, resolved: () => {} });
    const input = { projectId: project.id, expectedRevision: 1, attemptId: "attempt-a", owner: new AbortController().signal };
    await expect(context.registerExecutionApprovals(router, { ...input, projectId: "other" }, () => true, () => {})).rejects.toMatchObject({ code: "STALE_SELECTION" });
    await expect(context.registerExecutionApprovals(router, input, () => false, () => {})).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(router.serverRequest({ id: 1, method: "item/commandExecution/requestApproval", params: {} })).toBe(false);
  });
  it("does not send an approval after the project selection changes", async () => {
    let selection = initial(), unsafe = 0; const owner = new AbortController(), shown: string[] = [], writes: string[] = [];
    const context = new IssueProjectContext(() => selection, { request: async input => input.operation === "project.lookup" ? { kind: "project.lookup", project } : { kind: "execution.approval" } });
    const router = new ExecutionApprovalRouter({ show: (_owner, id) => { shown.push(id); }, write: () => { writes.push("write"); }, deny: () => {}, resolved: () => {} });
    const session = await context.registerExecutionApprovals(router, { projectId: project.id, expectedRevision: 1, attemptId: "attempt-a", owner: owner.signal }, () => true, () => { unsafe++; });
    session.bindThread("thread-a"); session.bindTurn("turn-a");
    router.serverRequest({ id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId: "turn-a" } });
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    selection = { ...selection, generation: 2 };
    await expect(router.resolve(shown[0], owner.signal, "accept")).rejects.toThrow();
    expect(writes).toEqual([]); expect(unsafe).toBe(1); session.close();
  });
  it("treats malformed replies to issue mutations as uncertain", async () => {
    const context = new IssueProjectContext(initial, { request: async input => input.operation === "project.lookup" ? { kind: "project.lookup", project } : { kind: "project", ...project } });
    const policy = { sandbox: "workspace-write" as const, networkAccess: false as const, approval: "manual" as const, revision: 1 };
    await expect(context.prepareExecution({ documentId: "doc", issueId: "issue", expectedRevision: 1, idempotencyKey: "key", policy }, project.id, () => true)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    await expect(context.transitionExecution({ operation: "execution.transition", projectId: project.id, attemptId: "attempt", expectedRevision: 1, action: { type: "dispatch" } }, project.id, () => true)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    await expect(context.recordExecutionApproval({ operation: "execution.approval", binding: { projectId: project.id, attemptId: "attempt", threadId: "thread", turnId: "turn", requestId: 1 }, expectedRevision: 1, action: { type: "request", kind: "command" } }, project.id, () => true)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("never prepares an issue when its server-owned project or admission differs", async () => {
    const calls: IssueWorkerRequest[] = [];
    const context = new IssueProjectContext(initial, { request: async input => { calls.push(input); if (input.operation === "project.lookup") return { kind: "project.lookup", project }; throw new Error("unexpected"); } });
    const input = { documentId: "doc-a", issueId: "issue-a", expectedRevision: 1, idempotencyKey: "key-a", policy: { sandbox: "workspace-write" as const, networkAccess: false as const, approval: "manual" as const, revision: 1 } };
    await expect(context.prepareExecution(input, "other-project", () => true)).rejects.toMatchObject({ code: "STALE_SELECTION" });
    await expect(context.prepareExecution(input, project.id, () => false)).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(calls.map(item => item.operation)).toEqual(["project.lookup", "project.lookup"]);
  });
  it("reports an uncertain issue transition if the grant expires during a write", async () => {
    const waiting = deferred<IssueWorkerResult>(), started = deferred<void>(); let allowed = true;
    const context = new IssueProjectContext(initial, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return waiting.promise; } });
    const pending = context.transitionExecution({ operation: "execution.transition", projectId: project.id, attemptId: "attempt-a", expectedRevision: 1, action: { type: "dispatch" } }, project.id, () => allowed);
    await started.promise; allowed = false;
    waiting.resolve({ kind: "execution.transition", record: { attemptId: "attempt-a", projectId: project.id, issueId: "issue-a", idempotencyKey: "key-a", projectRevision: 1, requestDigest: "a".repeat(64), phase: "dispatching", outcome: null, threadId: null, turnId: null } });
    await expect(pending).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("does not dispatch approval recording for another project", async () => {
    const calls: IssueWorkerRequest[] = [];
    const context = new IssueProjectContext(initial, { request: async input => { calls.push(input); if (input.operation === "project.lookup") return { kind: "project.lookup", project }; throw new Error("unexpected"); } });
    await expect(context.recordExecutionApproval({ operation: "execution.approval", expectedRevision: 1, binding: { projectId: "project-other", attemptId: "attempt-a", threadId: "thread", turnId: "turn", requestId: 1 }, action: { type: "request", kind: "command" } }, project.id, () => true)).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(calls.map(item => item.operation)).toEqual(["project.lookup"]);
  });
  it("captures issue execution policy before asynchronous project lookup", async () => {
    const lookup = deferred<IssueWorkerResult>(), started = deferred<void>(); const calls: IssueWorkerRequest[] = [];
    const context = new IssueProjectContext(initial, { request: input => { calls.push(input); if (input.operation === "project.lookup") return lookup.promise; started.resolve(); return Promise.reject(new IssueWorkerClientError("WORKER_UNAVAILABLE", "synthetic")); } });
    const input = { documentId: "doc-a", issueId: "issue-a", expectedRevision: 1, idempotencyKey: "key-a", policy: { sandbox: "workspace-write" as "workspace-write" | "read-only", networkAccess: false as const, approval: "manual" as const, revision: 1 } };
    const pending = context.prepareExecution(input, project.id, () => true);
    input.issueId = "changed"; input.policy.sandbox = "read-only";
    lookup.resolve({ kind: "project.lookup", project }); await started.promise;
    await expect(pending).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
    expect(calls[1]).toMatchObject({ operation: "execution.prepare", issueId: "issue-a", policy: { sandbox: "workspace-write" } });
  });
  it("binds history to the selected project and rejects a withdrawn grant", async () => {
    const pendingWorker = deferred<IssueWorkerResult>(), started = deferred<void>(), calls: IssueWorkerRequest[] = []; let allowed = true;
    const context = new IssueProjectContext(initial, { request: input => { calls.push(input); if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return pendingWorker.promise; } });
    const pending = context.view({ kind: "executionHistory", expectedRevision: 1, afterId: null }, () => allowed, project.id);
    await started.promise;
    expect(calls.at(-1)).toEqual({ operation: "execution.history", projectId: project.id, expectedRevision: 1, afterId: null });
    allowed = false; pendingWorker.resolve({ kind: "execution.history", page: { items: [], nextAfterId: null } });
    await expect(pending).rejects.toMatchObject({ code: "STALE_SELECTION" });
  });
  it("uses the selected bridge path and never creates a binding during lookup", async () => {
    const calls: IssueWorkerRequest[] = [], selection = initial();
    const context = new IssueProjectContext(() => selection, { request: async input => { calls.push(input); return { kind: "project.lookup", project: null }; } });
    expect(await context.status()).toEqual({ project: null });
    expect(calls).toEqual([{ operation: "project.lookup", selectedPath: "C:/synthetic/one" }]);
    expect(JSON.stringify(await context.status())).not.toContain("synthetic");
  });
  it("creates only on explicit bind, and returns existing bindings without creating again", async () => {
    let bound = false; const calls: string[] = [];
    const context = new IssueProjectContext(initial, { request: async input => {
      calls.push(input.operation);
      if (input.operation === "project.lookup") return { kind: "project.lookup", project: bound ? project : null };
      if (input.operation === "project.create") { bound = true; return { kind: "project", ...project }; }
      throw new Error("unexpected operation");
    } });
    expect(await context.bind()).toEqual({ project, alreadyBound: false });
    expect(await context.bind()).toEqual({ project, alreadyBound: true });
    expect(calls).toEqual(["project.lookup", "project.create", "project.lookup"]);
  });
  it("rejects old lookup results even if selection switches away and back", async () => {
    let selection = initial(); const waiting = deferred<IssueWorkerResult>();
    const context = new IssueProjectContext(() => selection, { request: () => waiting.promise });
    const result = context.status(); selection = { ...selection, generation: 3 }; waiting.resolve({ kind: "project.lookup", project });
    await expect(result).rejects.toMatchObject({ code: "STALE_SELECTION" });
  });
  it("does not report a created binding as the currently selected project after a switch", async () => {
    let selection = initial(); const creating = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(() => selection, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project: null }); started.resolve(); return creating.promise; } });
    const result = context.bind(); await started.promise;
    selection = { ...selection, projectPath: "C:/synthetic/two", generation: 2 }; creating.resolve({ kind: "project", ...project });
    await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("preserves an unknown mutation outcome when selection changes", async () => {
    let selection = initial(); const creating = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(() => selection, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project: null }); started.resolve(); return creating.promise; } });
    const result = context.bind(); await started.promise;
    selection = { ...selection, generation: 2 };
    creating.reject(new IssueWorkerClientError("OUTCOME_UNKNOWN", "synthetic"));
    await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("resolves simultaneous binding only by rechecking the same selected project", async () => {
    let count = 0;
    const context = new IssueProjectContext(initial, { request: async input => {
      if (input.operation === "project.lookup") return { kind: "project.lookup", project: count++ ? project : null };
      throw new IssueWorkerClientError("BINDING_EXISTS", "synthetic");
    } });
    expect(await context.bind()).toEqual({ project, alreadyBound: true });
  });
  it("requires a selected project and rejects research mode", async () => {
    const context = new IssueProjectContext(() => ({ workspaceMode: "research", projectPath: null, generation: 2 }), { request: async () => { throw new Error("must not call"); } });
    await expect(context.status()).rejects.toMatchObject({ code: "PROJECT_REQUIRED" });
    await expect(context.bind()).rejects.toMatchObject({ code: "PROJECT_REQUIRED" });
  });
  it("does not dispatch an import after the caller withdraws while lookup is pending", async () => {
    const waiting = deferred<IssueWorkerResult>(), operations: string[] = []; let allowed = true;
    const context = new IssueProjectContext(initial, { request: input => { operations.push(input.operation); return waiting.promise; } });
    const result = context.importDocument(new Uint8Array([1]), () => allowed, project);
    allowed = false; waiting.resolve({ kind: "project.lookup", project });
    await expect(result).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(operations).toEqual(["project.lookup"]);
  });
  it.each([{ id: "project_different", revision: 1 }, { id: project.id, revision: 2 }])("does not import after project identity or revision changes", async changed => {
    const operations: string[] = [];
    const context = new IssueProjectContext(initial, { request: async input => { operations.push(input.operation); if (input.operation === "project.lookup") return { kind: "project.lookup", project: changed }; throw new Error("must not import"); } });
    await expect(context.importDocument(new Uint8Array([1]), () => true, project)).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(operations).toEqual(["project.lookup"]);
  });
  it("binds requirement detail to the selected project and discards it if the view grant expires", async () => {
    const waiting = deferred<IssueWorkerResult>(), started = deferred<void>(), calls: IssueWorkerRequest[] = []; let allowed = true;
    const context = new IssueProjectContext(initial, { request: input => { calls.push(input); if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return waiting.promise; } });
    const pending = context.view({ kind: "requirementDetail", documentId: "doc-1", expectedRevision: 1, requirementId: "req-1", offset: 0 }, () => allowed, project.id);
    await started.promise;
    expect(calls[1]).toEqual({ operation: "requirement.detail", projectId: project.id, documentId: "doc-1", expectedRevision: 1, requirementId: "req-1", offset: 0 });
    allowed = false; waiting.resolve({ kind: "requirement.detail", requirement: { id: "req-1", text: "합성", origin: "user", sourceName: null, locator: null, category: null, linkedIssueCount: 0 }, page: { items: [], nextOffset: null } });
    await expect(pending).rejects.toMatchObject({ code: "STALE_SELECTION" });
  });
  it("does not query or export a different project at the same revision", async () => {
    const calls: string[] = [];
    const context = new IssueProjectContext(initial, { request: async input => {
      calls.push(input.operation);
      if (input.operation === "project.lookup") return { kind: "project.lookup", project: { ...project, id: "project_different" } };
      throw new Error("worker operation must not run");
    } });
    await expect(context.view({ kind: "documents" }, () => true, project.id)).rejects.toMatchObject({ code: "STALE_SELECTION" });
    await expect(context.exportDocument("doc", 1, () => true, project.id)).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(calls).toEqual(["project.lookup", "project.lookup"]);
  });
  it("preserves an unknown document import result after project selection changes", async () => {
    let selection = initial(); const importing = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(() => selection, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return importing.promise; } });
    const result = context.importDocument(new Uint8Array([1]), () => true, project); await started.promise;
    selection = { ...selection, generation: 2 }; importing.reject(new IssueWorkerClientError("OUTCOME_UNKNOWN", "synthetic"));
    await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("reports an uncertain import outcome when selection changes after dispatch but the worker succeeds", async () => {
    let selection = initial(); const importing = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(() => selection, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return importing.promise; } });
    const result = context.importDocument(new Uint8Array([1]), () => true, project); await started.promise;
    selection = { ...selection, generation: 2 }; importing.resolve({ kind: "import", documentId: "synthetic-doc", revision: 2, issueCount: 1, alreadyImported: false });
    await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
});
