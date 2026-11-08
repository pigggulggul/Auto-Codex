import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { IssueAppServerTransport } from "./execution-app-server.js";
import { freezeExecutionIntent } from "./execution-intent.js";

const intent = freezeExecutionIntent({ projectId: "project-a", documentId: "doc-a", issueId: "issue-a", projectRevision: 1, documentRevision: 1, instruction: "synthetic issue", policy: { sandbox: "workspace-write", networkAccess: false, approval: "manual", revision: 1 } }).intent;
class FakeServer extends EventEmitter {
  ready = true;
  requests: { method: string; params: unknown }[] = [];
  earlyCompletion = false;
  async request<T>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-a" } } as T;
    if (this.earlyCompletion) this.emit("notification", { method: "turn/completed", params: { threadId: "thread-a", turn: { id: "turn-a", status: "completed" } } });
    return { turn: { id: "turn-a" } } as T;
  }
  async stopAndWait(): Promise<void> { this.ready = false; this.emit("exit", new Error("synthetic stopped")); }
}
function setup() {
  const server = new FakeServer(); let path = "C:/synthetic/project", allowed = true;
  const transport = new IssueAppServerTransport(server, { projectPath: path, model: "test-model", validateProject: async () => path, canRun: () => allowed, timeoutMs: 100 });
  return { server, transport, changePath: () => { path = "C:/synthetic/other"; }, revoke: () => { allowed = false; } };
}
describe("issue App Server transport", () => {
  it("sends an isolated workspace turn and buffers completion before its reply", async () => {
    const t = setup(); t.server.earlyCompletion = true;
    expect(await t.transport.startThread(intent)).toBe("thread-a");
    expect(await t.transport.startTurn("thread-a", intent)).toBe("turn-a");
    expect(await t.transport.waitForCompletion("thread-a", "turn-a")).toEqual({ threadId: "thread-a", turnId: "turn-a", status: "completed" });
    expect(t.server.requests[0]).toMatchObject({ method: "thread/start", params: { cwd: "C:/synthetic/project", model: "test-model", sandbox: "workspace-write", approvalPolicy: "on-request", ephemeral: true } });
    expect(t.server.requests[1]).toMatchObject({ method: "turn/start", params: { threadId: "thread-a", approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["C:/synthetic/project"], networkAccess: false } } });
    await t.transport.stopAndWait(); expect(t.transport.busy).toBe(false);
  });
  it("rejects a changed project before sending a turn", async () => {
    const t = setup(); await t.transport.startThread(intent); t.changePath();
    await expect(t.transport.startTurn("thread-a", intent)).rejects.toThrow();
    expect(t.server.requests).toHaveLength(1); await t.transport.stopAndWait();
  });
  it("rejects a foreign completion and does not report success", async () => {
    const t = setup(); await t.transport.startThread(intent); await t.transport.startTurn("thread-a", intent);
    t.server.emit("notification", { method: "turn/completed", params: { threadId: "thread-a", turn: { id: "other", status: "completed" } } });
    await expect(t.transport.waitForCompletion("thread-a", "turn-a")).rejects.toThrow(); await t.transport.stopAndWait();
  });
  it("treats an unexpected server exit as unconfirmed process termination", async () => {
    const t = setup(); await t.transport.startThread(intent); t.server.emit("exit", new Error("lost"));
    await expect(t.transport.stopAndWait()).rejects.toThrow("unconfirmed"); expect(t.transport.busy).toBe(true);
  });
  it("does not start with a withdrawn server-owned grant", async () => {
    const t = setup(); t.revoke(); await expect(t.transport.startThread(intent)).rejects.toThrow();
    expect(t.server.requests).toHaveLength(0); await t.transport.stopAndWait();
  });
  it("removes unused listeners without stopping the shared server", () => {
    const t = setup(); expect(t.server.listenerCount("notification")).toBe(1);
    t.transport.disposeUnused();
    expect(t.server.listenerCount("notification")).toBe(0); expect(t.server.listenerCount("exit")).toBe(0); expect(t.server.ready).toBe(true);
  });
  it("cannot dispose a transport while it may own a running thread", async () => {
    const t = setup(); await t.transport.startThread(intent);
    expect(() => t.transport.disposeUnused()).toThrow(); await t.transport.stopAndWait();
  });
});
