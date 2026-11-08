import { describe, expect, it, vi } from "vitest";
import { ExecutionApprovalRouter } from "./execution-approval-router.js";
import { IssueExecutionRuntime } from "./execution-runtime.js";
import { freezeExecutionIntent } from "./execution-intent.js";
import type { JournalRecord } from "./execution-journal.js";
import type { IssueProjectContext } from "./project-context.js";

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup() {
  const owner = new AbortController(), events: string[] = [], shown: string[] = [], completed = deferred<{ threadId: string; turnId: string; status: "completed" | "failed" | "interrupted" }>();
  let held = false, allowed = true, stopFails = false, created = true, phase: JournalRecord["phase"] = "prepared";
  const intent = freezeExecutionIntent({ projectId: "project-a", documentId: "doc-a", issueId: "issue-a", projectRevision: 1, documentRevision: 1, instruction: "synthetic", policy: { sandbox: "workspace-write", networkAccess: false, approval: "manual", revision: 1 } }).intent;
  const record = (): JournalRecord => ({ projectId: "project-a", issueId: "issue-a", idempotencyKey: "key-a", projectRevision: 1, requestDigest: "0".repeat(64), attemptId: "attempt-a", phase, outcome: phase === "settled" ? "failed" : null, threadId: null, turnId: null });
  const router = new ExecutionApprovalRouter({ show: (_owner, id) => { events.push("show"); shown.push(id); }, write: () => { events.push("write"); }, deny: () => { events.push("deny"); }, resolved: () => { events.push("resolved"); } });
  const context = {
    prepareExecution: async () => { events.push("prepare"); return { intent, record: record(), created }; },
    transitionExecution: async (input: Parameters<IssueProjectContext["transitionExecution"]>[0]) => {
      events.push(input.action.type);
      phase = input.action.type === "dispatch" ? "dispatching" : input.action.type === "running" ? "running" : input.action.type === "verifying" ? "verifying" : input.action.type === "unknown" ? "outcome_unknown" : "settled";
      return record();
    },
    registerExecutionApprovals: async (_router: ExecutionApprovalRouter, input: { owner: AbortSignal; projectId: string; attemptId: string }, valid: () => boolean, unsafe: () => void) => {
      events.push("register"); return router.registerLaunching({ ...input, valid, unsafe, persist: async (_binding, action) => { events.push(`approval:${action.type}`); } });
    },
  } as unknown as Pick<IssueProjectContext, "prepareExecution" | "transitionExecution" | "registerExecutionApprovals">;
  const runtime = new IssueExecutionRuntime({ context, router, acquire: () => { if (held) return null; held = true; return () => { held = false; events.push("release"); }; }, permitted: () => allowed,
    transport: { startThread: async () => { events.push("thread"); return "thread-a"; }, startTurn: async () => { events.push("turn"); return "turn-a"; }, waitForCompletion: () => completed.promise, stopAndWait: async () => { events.push("stop"); if (stopFails) throw new Error("unconfirmed"); router.resetAfterConfirmedStop(); } } });
  return { runtime, router, owner, events, shown, completed, isHeld: () => held, setAllowed: (value: boolean) => { allowed = value; }, failStop: () => { stopFails = true; }, existing: () => { created = false; }, phase: () => phase,
    input: { projectId: "project-a", documentId: "doc-a", issueId: "issue-a", expectedRevision: 1, idempotencyKey: "key-a", owner: owner.signal } };
}

describe("issue execution coordinator", () => {
  it("records dispatch and binds the actual turn before routing approval and verifying", async () => {
    const t = setup(), run = t.runtime.run(t.input);
    await vi.waitFor(() => expect(t.events).toContain("running"));
    expect(t.router.serverRequest({ id: 3, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId: "turn-a" } })).toBe(true);
    await vi.waitFor(() => expect(t.shown).toHaveLength(1));
    await t.router.resolve(t.shown[0], t.owner.signal, "decline");
    t.completed.resolve({ threadId: "thread-a", turnId: "turn-a", status: "completed" });
    expect((await run).phase).toBe("verifying");
    expect(t.events).toEqual(["prepare", "register", "dispatch", "thread", "turn", "running", "approval:request", "show", "approval:respond", "write", "approval:finish", "resolved", "stop", "verifying", "release"]);
    expect(t.isHeld()).toBe(false);
  });
  it("does not dispatch an existing idempotent attempt", async () => {
    const t = setup(); t.existing(); await expect(t.runtime.run(t.input)).rejects.toMatchObject({ code: "EXISTING_ATTEMPT" });
    expect(t.events).toEqual(["prepare", "release"]); expect(t.isHeld()).toBe(false);
  });
  it("keeps admission while an attempt is running", async () => {
    const t = setup(), run = t.runtime.run(t.input); await vi.waitFor(() => expect(t.events).toContain("running"));
    await expect(t.runtime.run(t.input)).rejects.toMatchObject({ code: "BUSY" });
    t.completed.resolve({ threadId: "thread-a", turnId: "turn-a", status: "failed" }); await run;
    expect(t.events).toContain("settle"); expect(t.isHeld()).toBe(false);
  });
  it("records unknown rather than accepting a foreign completion", async () => {
    const t = setup(), run = t.runtime.run(t.input); await vi.waitFor(() => expect(t.events).toContain("running"));
    t.completed.resolve({ threadId: "other", turnId: "turn-a", status: "completed" });
    await expect(run).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(t.phase()).toBe("outcome_unknown"); expect(t.events.slice(-3)).toEqual(["stop", "unknown", "release"]);
  });
  it("retains admission when termination cannot be confirmed", async () => {
    const t = setup(), run = t.runtime.run(t.input); await vi.waitFor(() => expect(t.events).toContain("running"));
    t.failStop(); t.completed.resolve({ threadId: "thread-a", turnId: "turn-a", status: "completed" });
    await expect(run).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(t.isHeld()).toBe(true); expect(t.events).not.toContain("release"); expect(t.events).not.toContain("verifying");
  });
  it("stops after owner disconnect and never reports completion", async () => {
    const t = setup(), run = t.runtime.run(t.input); await vi.waitFor(() => expect(t.events).toContain("running"));
    t.owner.abort(); t.completed.reject(new Error("stopped"));
    await expect(run).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(t.events.filter(event => event === "stop")).toHaveLength(1); expect(t.phase()).toBe("outcome_unknown");
  });
});
