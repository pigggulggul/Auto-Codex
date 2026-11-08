import { describe, expect, it, vi } from "vitest";
import { AnalysisBatch } from "./analysis-batch.js";
import { AnalysisDraft } from "./analysis-draft.js";
import { AnalysisRouter } from "./analysis-router.js";
import { createAnalysisRuntimeFactory, type VerifiedAnalysisPolicy } from "./analysis-runtime-factory.js";
import type { ProtocolServerRequest } from "../codex-app-server.js";

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const input = { snapshotId: "snapshot", projectRevision: 1, sourceId: "source", sourcePath: "private-path.md", sourceSha256: "a".repeat(64), segmentId: "segment", offset: 0, text: "synthetic source", instruction: "" };
const makeBatch = async () => new AnalysisBatch(new AnalysisDraft("snapshot", 1, 1, async () => input));
function setup(commandApprovals?: (owner: AbortSignal) => { request(request: ProtocolServerRequest): boolean; cancel(threadId: string): void }, commandApprovalContainment?: () => boolean, commandApprovalCoverage?: () => boolean) {
  const router = new AnalysisRouter(), started = deferred<void>(); let policy: VerifiedAnalysisPolicy | null = null, active = false, released = 0, pathValid = true, selected = { workspaceMode: "project" as "project" | "research", projectPath: "C:/synthetic", generation: 1 };
  const server = { request: vi.fn(async (method: string, params: unknown) => { if (method === "thread/start") return { thread: { id: "thread", environments: (params as { environments?: unknown }).environments } }; if (method === "turn/start") { started.resolve(); return { turn: { id: "turn" } }; } throw new Error("unexpected"); }), respondError: vi.fn(), stopAndWait: vi.fn(async () => {}) };
  const factory = createAnalysisRuntimeFactory({ server: server as never, router, policy: () => policy, policyCurrent: value => value === policy, selection: () => selected, model: () => "synthetic-model", ready: () => true, validateProject: async value => { if (!pathValid) throw new Error("missing synthetic path"); return value; }, acquire: () => { if (active) return null; active = true; return () => { active = false; released++; }; }, commandApprovals, commandApprovalContainment, commandApprovalCoverage });
  return { factory, server, router, started, setPolicy: (value: VerifiedAnalysisPolicy | null) => { policy = value; }, select: (generation: number) => { selected = { ...selected, generation }; }, setPathValid: (value: boolean) => { pathValid = value; }, released: () => released };
}
const policy = (): VerifiedAnalysisPolicy => ({ verified: true, config: { "features.shell_tool": false }, disabledPluginIds: [] });
describe("analysis runtime factory", () => {
  it("requires a live owner and trusted handler for command approvals", () => {
    const t = setup(); t.setPolicy({ ...policy(), allowCommandApprovals: true });
    expect(t.factory(makeBatch)).toBeNull(); expect(t.factory(makeBatch, new AbortController().signal)).toBeNull();
    const missingBoundary = setup(() => ({ request: () => true, cancel: () => {} })); missingBoundary.setPolicy({ ...policy(), allowCommandApprovals: true, commandEnvironmentId: "synthetic-local" });
    expect(missingBoundary.factory(makeBatch, new AbortController().signal)).toBeNull();
    const missingCoverage = setup(() => ({ request: () => true, cancel: () => {} }), () => true); missingCoverage.setPolicy({ ...policy(), allowCommandApprovals: true, commandEnvironmentId: "synthetic-local" });
    expect(missingCoverage.factory(makeBatch, new AbortController().signal)).toBeNull();
    const u = setup(() => ({ request: () => true, cancel: () => {} }), () => true, () => true); u.setPolicy({ ...policy(), allowCommandApprovals: true, commandEnvironmentId: "synthetic-local" });
    const owner = new AbortController(); owner.abort(); expect(u.factory(makeBatch, owner.signal)).toBeNull();
    const failedBoundary = setup(() => ({ request: () => true, cancel: () => {} }), () => { throw new Error("synthetic verification error"); });
    failedBoundary.setPolicy({ ...policy(), allowCommandApprovals: true, commandEnvironmentId: "synthetic-local" }); expect(failedBoundary.factory(makeBatch, new AbortController().signal)).toBeNull();
  });
  it("does not dispatch if the command containment evidence is revoked", async () => {
    let contained = true;
    const t = setup(() => ({ request: () => true, cancel: () => {} }), () => contained, () => true);
    t.setPolicy({ ...policy(), allowCommandApprovals: true, commandEnvironmentId: "synthetic-local" });
    const execution = t.factory(makeBatch, new AbortController().signal); if (!execution) throw new Error("missing synthetic runtime");
    contained = false; await expect(execution.start(1)).rejects.toThrow(); expect(t.server.request).not.toHaveBeenCalled();
  });
  it("does not dispatch when the every-command approval guarantee is revoked", async () => {
    let covered = true;
    const t = setup(() => ({ request: () => true, cancel: () => {} }), () => true, () => covered);
    t.setPolicy({ ...policy(), allowCommandApprovals: true, commandEnvironmentId: "synthetic-local" });
    const execution = t.factory(makeBatch, new AbortController().signal); if (!execution) throw new Error("missing synthetic runtime");
    covered = false; await expect(execution.start(1)).rejects.toThrow(); expect(t.server.request).not.toHaveBeenCalled();
  });
  it("routes a synthetic command approval through the execution owner's handler", async () => {
    const owner = new AbortController(), handler = { request: vi.fn(() => true), cancel: vi.fn() }, handlerFor = vi.fn(() => handler);
    const t = setup(handlerFor, () => true, () => true); t.setPolicy({ ...policy(), allowCommandApprovals: true, commandEnvironmentId: "synthetic-local" });
    const execution = t.factory(makeBatch, owner.signal); if (!execution) throw new Error("missing synthetic runtime");
    const run = execution.start(1); await t.started.promise; await new Promise(resolve => setTimeout(resolve, 0));
    const request = { id: 3, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "C:/synthetic", environmentId: "synthetic-local" } };
    expect(t.router.serverRequest(request)).toBe(true); expect(handlerFor).toHaveBeenCalledWith(owner.signal); expect(handler.request).toHaveBeenCalledWith(request);
    t.router.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text: '{"requirements":[]}' } } });
    t.router.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
    await run; expect(execution.status().state).toBe("complete"); expect(handler.cancel).toHaveBeenCalledExactlyOnceWith("thread");
  });
  it("does not register or dispatch when no verified server policy exists", () => {
    const t = setup(); expect(t.factory(makeBatch)).toBeNull(); expect(t.server.request).not.toHaveBeenCalled();
    expect(t.router.notification({ method: "turn/started", params: { threadId: "foreign" } })).toBe(false);
  });
  it("routes a synthetic authorized run through the shared admission and App Server", async () => {
    const t = setup(); t.setPolicy(policy()); const execution = t.factory(makeBatch); if (!execution) throw new Error("missing synthetic runtime");
    const run = execution.start(1); await t.started.promise;
    expect(t.router.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text: '{"requirements":[]}' } } })).toBe(true);
    expect(t.router.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } })).toBe(true);
    await run; expect(execution.status().state).toBe("complete"); expect(t.released()).toBe(1);
    const turn = t.server.request.mock.calls.find(call => call[0] === "turn/start"); expect(JSON.stringify(turn)).not.toContain("private-path.md");
    expect(t.router.notification({ method: "item/completed", params: { threadId: "thread" } })).toBe(true);
  });
  it("rejects a changed selection or revoked policy before dispatch", async () => {
    const t = setup(); t.setPolicy(policy()); const execution = t.factory(makeBatch); if (!execution) throw new Error("missing synthetic runtime");
    t.select(2); await expect(execution.start(1)).rejects.toThrow(); expect(t.server.request).not.toHaveBeenCalled();
    const u = setup(); u.setPolicy(policy()); const revoked = u.factory(makeBatch); if (!revoked) throw new Error("missing synthetic runtime");
    u.setPolicy(null); await expect(revoked.start(1)).rejects.toThrow(); expect(u.server.request).not.toHaveBeenCalled();
  });
  it("rejects a missing project path before any App Server request", async () => {
    const t = setup(); t.setPolicy(policy()); const execution = t.factory(makeBatch); if (!execution) throw new Error("missing synthetic runtime");
    t.setPathValid(false); await execution.start(1); expect(execution.status().state).toBe("blocked"); expect(t.server.request).not.toHaveBeenCalled(); expect(t.released()).toBe(1);
  });
  it("prevents a second session from starting while the shared admission is held", async () => {
    const t = setup(); t.setPolicy(policy()); const first = t.factory(makeBatch), second = t.factory(makeBatch); if (!first || !second) throw new Error("missing synthetic runtime");
    const run = first.start(1); await t.started.promise; await expect(second.start(1)).rejects.toThrow(/busy/);
    t.router.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text: '{"requirements":[]}' } } });
    t.router.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
    await run; expect(first.status().state).toBe("complete"); expect(t.released()).toBe(1);
  });
  it("does not exhaust the late-event router with starts that cannot acquire admission", async () => {
    const t = setup(); t.setPolicy(policy()); const first = t.factory(makeBatch); if (!first) throw new Error("missing synthetic runtime");
    const run = first.start(1); await t.started.promise;
    for (let index = 0; index < 140; index++) {
      const rejected = t.factory(makeBatch); if (!rejected) throw new Error("missing synthetic runtime");
      await expect(rejected.start(1)).rejects.toThrow(/busy/);
    }
    t.router.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text: '{"requirements":[]}' } } });
    t.router.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
    await run;
    const next = t.factory(makeBatch); if (!next) throw new Error("missing synthetic runtime");
    const pending = next.start(1); await vi.waitFor(() => expect(t.server.request).toHaveBeenCalledTimes(4));
    t.router.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text: '{"requirements":[]}' } } });
    t.router.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
    await pending; expect(next.status().state).toBe("complete"); expect(t.released()).toBe(2);
  });
  it("releases admission when the late-event router is full", async () => {
    const t = setup(); t.setPolicy(policy());
    for (let index = 0; index < 128; index++) t.router.register({} as never);
    const execution = t.factory(makeBatch); if (!execution) throw new Error("missing synthetic runtime");
    await execution.start(1); expect(execution.status().state).toBe("blocked");
    expect(t.released()).toBe(1); expect(t.server.request).not.toHaveBeenCalled();
  });
  it("does not consume router entries when batch preparation fails", async () => {
    const t = setup(); t.setPolicy(policy());
    for (let index = 0; index < 140; index++) {
      const failed = t.factory(async () => { throw new Error("synthetic preparation failure"); });
      if (!failed) throw new Error("missing synthetic runtime");
      await failed.start(1); expect(failed.status().state).toBe("failed");
    }
    const next = t.factory(makeBatch); if (!next) throw new Error("missing synthetic runtime");
    const run = next.start(1); await t.started.promise;
    t.router.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text: '{"requirements":[]}' } } });
    t.router.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
    await run; expect(next.status().state).toBe("complete"); expect(t.released()).toBe(141);
  });
  it("registers a retained transport again after the owner resets the router", async () => {
    const t = setup(); t.setPolicy(policy()); const execution = t.factory(makeBatch); if (!execution) throw new Error("missing synthetic runtime");
    const first = execution.start(1); await t.started.promise;
    t.router.notification({ method: "item/started", params: { threadId: "thread", turnId: "turn", item: { type: "mcpToolCall" } } });
    await first; expect(execution.status().state).toBe("blocked"); expect(t.server.stopAndWait).toHaveBeenCalledOnce();
    t.router.resetAfterConfirmedStop();
    const retry = execution.retry(0); await vi.waitFor(() => expect(t.server.request).toHaveBeenCalledTimes(4));
    expect(t.router.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text: '{"requirements":[]}' } } })).toBe(true);
    t.router.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
    await retry; expect(execution.status().state).toBe("complete");
  });
});
