import { describe, expect, it, vi } from "vitest";
import { AnalysisTransport } from "./analysis-transport.js";

const input = { snapshotId: "snapshot", projectRevision: 1, sourceId: "source", sourcePath: "secret-path.md", sourceSha256: "a".repeat(64), segmentId: "segment", offset: 0, text: "synthetic source", instruction: "synthetic request" };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function setup() {
  let allowed = true, releaseCount = 0;
  const started = deferred<void>();
  const server = { request: vi.fn(async (method: string, _params: unknown) => { if (method === "thread/start") return { thread: { id: "thread" } }; if (method === "turn/start") { started.resolve(); return { turn: { id: "turn" } }; } throw new Error("unknown"); }), respondError: vi.fn(), stopAndWait: vi.fn(async () => {}) };
  const transport = new AnalysisTransport(server as never, { cwd: "synthetic-workspace", model: "synthetic-model", config: { "features.shell_tool": false }, disabledPluginIds: [], canRun: () => allowed, acquire: () => () => { releaseCount++; } });
  const completed = (text: string) => { transport.notification({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase: "final_answer", text } } }); transport.notification({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } }); };
  return { server, transport, started, completed, setAllowed: (value: boolean) => { allowed = value; }, releaseCount: () => releaseCount };
}
describe("internal analysis transport", () => {
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
