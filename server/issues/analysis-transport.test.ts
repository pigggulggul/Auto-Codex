import { describe, expect, it, vi } from "vitest";
import { AnalysisTransport } from "./analysis-transport.js";
import type { ProtocolServerRequest } from "../codex-app-server.js";

const input = { snapshotId: "snapshot", projectRevision: 1, sourceId: "source", sourcePath: "secret-path.md", sourceSha256: "a".repeat(64), segmentId: "segment", offset: 0, text: "synthetic source", instruction: "synthetic request" };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function setup(commandApprovals?: { request(request: ProtocolServerRequest): boolean; cancel(threadId: string): void }, commandEnvironmentId?: string) {
  let allowed = true, releaseCount = 0;
  const started = deferred<void>();
  const server = { request: vi.fn(async (method: string, params: unknown): Promise<{ thread?: { id: string; environments?: unknown }; turn?: { id: string } }> => { if (method === "thread/start") return { thread: { id: "thread", environments: (params as { environments?: unknown }).environments } }; if (method === "turn/start") { started.resolve(); return { turn: { id: "turn" } }; } throw new Error("unknown"); }), respondError: vi.fn(), stopAndWait: vi.fn(async () => {}) };
  const transport = new AnalysisTransport(server as never, { cwd: "synthetic-workspace", model: "synthetic-model", config: { "features.shell_tool": false }, disabledPluginIds: [], canRun: () => allowed, acquire: () => () => { releaseCount++; }, commandApprovals, commandEnvironmentId });
  const completed = (text: string) => { transport.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text } } }); transport.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } }); };
  return { server, transport, started, completed, setAllowed: (value: boolean) => { allowed = value; }, releaseCount: () => releaseCount };
}
describe("internal analysis transport", () => {
  it("binds an approval to the server-selected environment", async () => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals, "synthetic-local");
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = { id: 13, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "synthetic-workspace", environmentId: "synthetic-local" } };
    expect(t.transport.serverRequest(request)).toBe(true); expect(approvals.request).toHaveBeenCalledWith(request);
    t.completed('{"requirements":[]}'); expect(await run).toBe('{"requirements":[]}');
    expect(t.server.request.mock.calls[0][1]).toMatchObject({ environments: [{ environmentId: "synthetic-local", cwd: "synthetic-workspace" }] });
  });
  it("stops before the turn when the server selects a different environment", async () => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals, "synthetic-local");
    t.server.request.mockImplementation(async () => ({ thread: { id: "thread", environments: [{ environmentId: "other", cwd: "synthetic-workspace" }] } }));
    await expect(t.transport.run(input, new AbortController().signal)).rejects.toThrow();
    expect(t.server.request).toHaveBeenCalledOnce(); expect(t.server.stopAndWait).toHaveBeenCalledOnce(); expect(approvals.request).not.toHaveBeenCalled();
  });
  it("rejects an approval for another environment", async () => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals, "synthetic-local");
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    t.transport.serverRequest({ id: 14, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "synthetic-workspace", environmentId: "other" } });
    await expect(run).rejects.toThrow(); expect(approvals.request).not.toHaveBeenCalled(); expect(t.server.respondError).toHaveBeenCalledOnce();
  });
  it("forwards only an active turn's command approval and cleans it up on completion", async () => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals);
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = { id: 7, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "synthetic-workspace" } };
    expect(t.transport.serverRequest(request)).toBe(true); expect(approvals.request).toHaveBeenCalledWith(request);
    t.transport.notification({ method: "item/started", params: { threadId: "thread", turnId: "turn", item: { type: "commandExecution" } } });
    t.completed('{"requirements":[]}'); expect(await run).toBe('{"requirements":[]}');
    expect(approvals.cancel).toHaveBeenCalledExactlyOnceWith("thread");
    expect(t.server.request.mock.calls[0][1]).toMatchObject({ approvalPolicy: "on-request", sandbox: "read-only" });
    expect(t.server.request.mock.calls[1][1]).toMatchObject({ approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } });
  });
  it("denies a command approval from another turn and stops the server", async () => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals);
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    t.transport.serverRequest({ id: 8, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "other", command: "synthetic", cwd: "synthetic-workspace" } });
    await expect(run).rejects.toThrow(); expect(approvals.request).not.toHaveBeenCalled(); expect(t.server.respondError).toHaveBeenCalledOnce(); expect(t.server.stopAndWait).toHaveBeenCalledOnce(); expect(approvals.cancel).toHaveBeenCalledExactlyOnceWith("thread");
  });
  it("does not forward a late approval after cancellation", async () => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals), controller = new AbortController();
    const run = t.transport.run(input, controller.signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
    t.transport.serverRequest({ id: 9, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "synthetic-workspace" } });
    await expect(run).rejects.toThrow(); expect(approvals.request).not.toHaveBeenCalled(); expect(approvals.cancel).toHaveBeenCalledExactlyOnceWith("thread");
  });
  it("invalidates pending approvals immediately on interrupt before shutdown completes", async () => {
    const stopped = deferred<void>(), approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals), controller = new AbortController();
    t.server.stopAndWait.mockImplementationOnce(() => stopped.promise);
    const run = t.transport.run(input, controller.signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    t.transport.serverRequest({ id: 10, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "synthetic-workspace" } });
    expect(approvals.request).toHaveBeenCalledOnce(); controller.abort();
    expect(approvals.cancel).toHaveBeenCalledExactlyOnceWith("thread");
    await vi.waitFor(() => expect(t.server.stopAndWait).toHaveBeenCalledOnce()); expect(t.releaseCount()).toBe(0);
    stopped.resolve(); await expect(run).rejects.toThrow(); expect(t.releaseCount()).toBe(1);
  });
  it("denies and stops when the owning approval handler rejects a request", async () => {
    const approvals = { request: vi.fn(() => false), cancel: vi.fn() }, t = setup(approvals);
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    t.transport.serverRequest({ id: 11, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "synthetic-workspace" } });
    await expect(run).rejects.toThrow(); expect(t.server.respondError).toHaveBeenCalledOnce(); expect(t.server.stopAndWait).toHaveBeenCalledOnce();
  });
  it.each([{ networkApprovalContext: { host: "synthetic.invalid" } }, { proposedNetworkPolicyAmendments: [] }, { kind: "network" }, { environmentId: "remote" }, { command: "" }, { cwd: "" }])("rejects an unsafe or incomplete approval request %#", async extra => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn() }, t = setup(approvals);
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    t.transport.serverRequest({ id: 12, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn", command: "synthetic", cwd: "synthetic-workspace", ...extra } });
    await expect(run).rejects.toThrow(); expect(approvals.request).not.toHaveBeenCalled(); expect(t.server.respondError).toHaveBeenCalledOnce();
  });
  it("retains admission if approval cleanup fails", async () => {
    const approvals = { request: vi.fn(() => true), cancel: vi.fn(() => { throw new Error("synthetic failure"); }) }, t = setup(approvals);
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    t.completed('{"requirements":[]}'); await expect(run).rejects.toThrow(/approval cleanup/);
    expect(t.releaseCount()).toBe(0); expect(t.transport.busy).toBe(true); expect(t.server.stopAndWait).toHaveBeenCalledOnce();
  });
  it("dispatches a bounded input and correlates a synthetic completed turn", async () => {
    const t = setup(), signal = new AbortController(); const run = t.transport.run(input, signal.signal); await t.started.promise;
    t.completed('{"requirements":[]}'); expect(await run).toBe('{"requirements":[]}');
    const turn = t.server.request.mock.calls.find(call => call[0] === "turn/start")![1];
    expect(JSON.stringify(turn)).toContain("synthetic source"); expect(JSON.stringify(turn)).not.toContain("secret-path.md");
    expect(t.releaseCount()).toBe(1); expect(t.server.stopAndWait).not.toHaveBeenCalled();
    expect(t.transport.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", text: "late private result" } } })).toBe(true);
    expect(t.transport.serverRequest({ id: 9, method: "item/tool/requestUserInput", params: { threadId: "thread" } })).toBe(true);
    expect(t.server.respondError).toHaveBeenCalledOnce();
    expect(t.transport.notification({ method: "item/completed", params: { threadId: "other" } })).toBe(false);
  });
  it("does not dispatch without an authorized policy", async () => {
    const t = setup(); t.setAllowed(false); await expect(t.transport.run(input, new AbortController().signal)).rejects.toThrow(); expect(t.server.request).not.toHaveBeenCalled();
  });
  it("cancels pending project validation before dispatch and ignores a late path", async () => {
    const entered = deferred<void>(), path = deferred<string>(), signal = new AbortController(); let released = 0;
    const server = { request: vi.fn(), respondError: vi.fn(), stopAndWait: vi.fn(async () => {}) };
    const transport = new AnalysisTransport(server as never, { cwd: async () => { entered.resolve(); return path.promise; }, model: "synthetic-model", config: {}, disabledPluginIds: [], canRun: () => true, acquire: () => () => { released++; } });
    const run = transport.run(input, signal.signal); await entered.promise; signal.abort();
    await expect(run).rejects.toThrow();
    expect(released).toBe(1); expect(transport.busy).toBe(false); expect(server.request).not.toHaveBeenCalled(); expect(server.stopAndWait).not.toHaveBeenCalled();
    path.resolve("synthetic-workspace"); await Promise.resolve(); expect(server.request).not.toHaveBeenCalled();
  });
  it("keeps late analysis notifications and requests out of fallback routing", async () => {
    const t = setup(), fallback = vi.fn();
    const notify = (event: Parameters<typeof t.transport.notification>[0]) => { if (!t.transport.notification(event)) fallback(event); };
    const request = (event: Parameters<typeof t.transport.serverRequest>[0]) => { if (!t.transport.serverRequest(event)) fallback(event); };
    const pending = t.transport.run(input, new AbortController().signal); await t.started.promise;
    t.completed('{"requirements":[]}'); await pending;
    notify({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", text: "synthetic private text" } } });
    request({ id: 5, method: "item/tool/requestUserInput", params: { threadId: "thread" } });
    expect(fallback).not.toHaveBeenCalled();
    notify({ method: "turn/started", params: { threadId: "unrelated" } }); expect(fallback).toHaveBeenCalledOnce();
  });
  it("denies interactive requests and stops the server before releasing admission", async () => {
    const t = setup(), signal = new AbortController(); const run = t.transport.run(input, signal.signal); await t.started.promise;
    expect(t.transport.serverRequest({ id: 1, method: "item/tool/requestUserInput", params: { threadId: "thread" } })).toBe(true);
    await expect(run).rejects.toThrow(); expect(t.server.respondError).toHaveBeenCalledOnce(); expect(t.server.stopAndWait).toHaveBeenCalledOnce(); expect(t.releaseCount()).toBe(1);
  });
  it.each(["denial", "cancellation", "policy revocation"])("confirms shutdown when %s races with a completed turn", async cause => {
    const t = setup(), stopped = deferred<void>(), controller = new AbortController();
    t.server.stopAndWait.mockImplementationOnce(() => stopped.promise);
    const run = t.transport.run(input, controller.signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    const rejected = expect(run).rejects.toThrow();
    if (cause === "denial") t.transport.serverRequest({ id: 1, method: "item/tool/requestUserInput", params: { threadId: "thread" } });
    else if (cause === "cancellation") controller.abort();
    else t.setAllowed(false);
    t.completed('{"requirements":[]}');
    await vi.waitFor(() => expect(t.server.stopAndWait).toHaveBeenCalledOnce());
    expect(t.releaseCount()).toBe(0);
    stopped.resolve(); await rejected; expect(t.releaseCount()).toBe(1);
  });
  it("retains admission when shutdown cannot be confirmed after a denied request races with completion", async () => {
    const t = setup(); t.server.stopAndWait.mockRejectedValueOnce(new Error("synthetic termination failure"));
    const run = t.transport.run(input, new AbortController().signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    const rejected = expect(run).rejects.toThrow(/termination/);
    t.transport.serverRequest({ id: 1, method: "item/tool/requestUserInput", params: { threadId: "thread" } });
    t.completed('{"requirements":[]}'); await rejected;
    expect(t.server.stopAndWait).toHaveBeenCalledOnce(); expect(t.releaseCount()).toBe(0); expect(t.transport.busy).toBe(true);
  });
  it("discards analysis and stops the server when a tool item is observed", async () => {
    const t = setup(), signal = new AbortController(); const run = t.transport.run(input, signal.signal); await t.started.promise;
    t.transport.notification({ method: "item/started", params: { threadId: "thread", turnId: "turn", item: { type: "mcpToolCall" } } });
    await expect(run).rejects.toThrow(); expect(t.server.stopAndWait).toHaveBeenCalledOnce(); expect(t.releaseCount()).toBe(1);
  });
  it("stops on a tool item from an unexpected turn on the active analysis thread", async () => {
    const t = setup(), signal = new AbortController(); const run = t.transport.run(input, signal.signal); await t.started.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    const rejected = expect(run).rejects.toThrow();
    t.transport.notification({ method: "item/started", params: { threadId: "thread", turnId: "unexpected-turn", item: { type: "mcpToolCall" } } });
    await vi.waitFor(() => expect(t.server.stopAndWait).toHaveBeenCalledOnce());
    await rejected; expect(t.releaseCount()).toBe(1);
  });
  it("stops an uncertain thread start if a tool item is observed before its ID is known", async () => {
    const t = setup(), entered = deferred<void>(), late = deferred<{ thread: { id: string } }>(), stopped = deferred<void>();
    t.server.request.mockImplementation(async () => { entered.resolve(); return late.promise; });
    t.server.stopAndWait.mockImplementationOnce(() => stopped.promise);
    const run = t.transport.run(input, new AbortController().signal); await entered.promise;
    expect(t.transport.notification({ method: "item/started", params: { threadId: "unknown", turnId: "synthetic", item: { type: "mcpToolCall" } } })).toBe(true);
    await vi.waitFor(() => expect(t.server.stopAndWait).toHaveBeenCalledOnce());
    expect(t.releaseCount()).toBe(0); stopped.resolve(); await expect(run).rejects.toThrow(); expect(t.releaseCount()).toBe(1);
    late.resolve({ thread: { id: "late-thread" } }); await Promise.resolve();
    expect(t.server.request.mock.calls.filter(call => call[0] === "turn/start")).toHaveLength(0);
  });
  it("starts shutdown on an invalid item while the turn-start response is pending", async () => {
    const t = setup(), entered = deferred<void>(), late = deferred<{ turn: { id: string } }>(), stopped = deferred<void>();
    t.server.request.mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "thread" } };
      entered.resolve(); return late.promise;
    });
    t.server.stopAndWait.mockImplementationOnce(() => stopped.promise);
    const run = t.transport.run(input, new AbortController().signal); await entered.promise;
    t.transport.notification({ method: "item/started", params: { threadId: "thread", turnId: "turn", item: { type: "mcpToolCall" } } });
    await vi.waitFor(() => expect(t.server.stopAndWait).toHaveBeenCalledOnce());
    expect(t.releaseCount()).toBe(0); stopped.resolve(); await expect(run).rejects.toThrow(); expect(t.releaseCount()).toBe(1);
    late.resolve({ turn: { id: "turn" } }); await Promise.resolve();
    expect(t.server.request.mock.calls).toHaveLength(2);
  });
  it("retains admission if shutdown fails after an early unsafe item", async () => {
    const t = setup(), entered = deferred<void>(), late = deferred<{ turn: { id: string } }>();
    t.server.request.mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "thread" } };
      entered.resolve(); return late.promise;
    });
    t.server.stopAndWait.mockRejectedValueOnce(new Error("synthetic termination failure"));
    const run = t.transport.run(input, new AbortController().signal); await entered.promise;
    const rejected = expect(run).rejects.toThrow(/termination/);
    t.transport.notification({ method: "item/started", params: { threadId: "thread", turnId: "turn", item: { type: "mcpToolCall" } } });
    await rejected; expect(t.server.stopAndWait).toHaveBeenCalledOnce(); expect(t.releaseCount()).toBe(0); expect(t.transport.busy).toBe(true);
    late.resolve({ turn: { id: "turn" } }); await Promise.resolve();
    await expect(t.transport.run(input, new AbortController().signal)).rejects.toThrow();
    expect(t.server.request.mock.calls).toHaveLength(2);
  });
  it("treats an unsuccessful denial response as a failed turn", async () => {
    const t = setup(), signal = new AbortController(); t.server.respondError.mockImplementationOnce(() => { throw new Error("disconnected"); });
    const run = t.transport.run(input, signal.signal); await t.started.promise;
    expect(t.transport.serverRequest({ id: 1, method: "item/tool/requestUserInput", params: { threadId: "thread" } })).toBe(true);
    await expect(run).rejects.toThrow(); expect(t.server.stopAndWait).toHaveBeenCalledOnce();
  });
  it("holds admission when a cancelled turn cannot be confirmed stopped", async () => {
    const t = setup(), signal = new AbortController(); t.server.stopAndWait.mockRejectedValueOnce(new Error("synthetic"));
    const run = t.transport.run(input, signal.signal); await t.started.promise; signal.abort();
    await expect(run).rejects.toThrow(/termination/); expect(t.transport.busy).toBe(true); expect(t.releaseCount()).toBe(0);
    await expect(t.transport.run(input, new AbortController().signal)).rejects.toThrow();
  });
  it.each(["thread/start", "turn/start"])("begins confirmed shutdown immediately when %s is pending", async pendingMethod => {
    const t = setup(), signal = new AbortController(), entered = deferred<void>(), late = deferred<{ thread: { id: string } } | { turn: { id: string } }>(), stopped = deferred<void>();
    t.server.request.mockImplementation(async (method: string) => {
      if (method === pendingMethod) { entered.resolve(); return late.promise; }
      return { thread: { id: "thread" } };
    });
    t.server.stopAndWait.mockImplementationOnce(() => stopped.promise);
    const run = t.transport.run(input, signal.signal); await entered.promise; signal.abort();
    await vi.waitFor(() => expect(t.server.stopAndWait).toHaveBeenCalledOnce());
    expect(t.transport.busy).toBe(true); expect(t.releaseCount()).toBe(0);
    stopped.resolve(); await expect(run).rejects.toThrow(); expect(t.releaseCount()).toBe(1);
    late.resolve(pendingMethod === "thread/start" ? { thread: { id: "late-thread" } } : { turn: { id: "late-turn" } });
    await Promise.resolve(); expect(t.server.request.mock.calls.filter(call => call[0] === "turn/start").length).toBe(pendingMethod === "turn/start" ? 1 : 0);
  });
  it("stops after a lost turn-start response before releasing admission", async () => {
    const t = setup(); t.server.request.mockImplementation(async (method: string) => { if (method === "thread/start") return { thread: { id: "thread" } }; throw new Error("lost response"); });
    await expect(t.transport.run(input, new AbortController().signal)).rejects.toThrow(); expect(t.server.stopAndWait).toHaveBeenCalledOnce(); expect(t.releaseCount()).toBe(1);
  });
});
