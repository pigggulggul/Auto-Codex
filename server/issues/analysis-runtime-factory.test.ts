import { describe, expect, it, vi } from "vitest";
import { AnalysisBatch } from "./analysis-batch.js";
import { AnalysisDraft } from "./analysis-draft.js";
import { AnalysisRouter } from "./analysis-router.js";
import { createAnalysisRuntimeFactory, type VerifiedAnalysisPolicy } from "./analysis-runtime-factory.js";

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const input = { snapshotId: "snapshot", projectRevision: 1, sourceId: "source", sourcePath: "private-path.md", sourceSha256: "a".repeat(64), segmentId: "segment", offset: 0, text: "synthetic source", instruction: "" };
const makeBatch = async () => new AnalysisBatch(new AnalysisDraft("snapshot", 1, 1, async () => input));
function setup() {
  const router = new AnalysisRouter(), started = deferred<void>(); let policy: VerifiedAnalysisPolicy | null = null, active = false, released = 0, pathValid = true, selected = { workspaceMode: "project" as "project" | "research", projectPath: "C:/synthetic", generation: 1 };
  const server = { request: vi.fn(async (method: string, _params: unknown) => { if (method === "thread/start") return { thread: { id: "thread" } }; if (method === "turn/start") { started.resolve(); return { turn: { id: "turn" } }; } throw new Error("unexpected"); }), respondError: vi.fn(), stopAndWait: vi.fn(async () => {}) };
  const factory = createAnalysisRuntimeFactory({ server: server as never, router, policy: () => policy, policyCurrent: value => value === policy, selection: () => selected, model: () => "synthetic-model", ready: () => true, validateProject: async value => { if (!pathValid) throw new Error("missing synthetic path"); return value; }, acquire: () => { if (active) return null; active = true; return () => { active = false; released++; }; } });
  return { factory, server, router, started, setPolicy: (value: VerifiedAnalysisPolicy | null) => { policy = value; }, select: (generation: number) => { selected = { ...selected, generation }; }, setPathValid: (value: boolean) => { pathValid = value; }, released: () => released };
}
const policy = (): VerifiedAnalysisPolicy => ({ verified: true, config: { "features.shell_tool": false }, disabledPluginIds: [] });
describe("analysis runtime factory", () => {
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
});
