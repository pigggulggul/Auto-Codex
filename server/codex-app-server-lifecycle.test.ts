import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ExecutionJournal, EXECUTION_JOURNAL_SCHEMA } from "./issues/execution-journal.js";
import { ExecutionApprovalJournal } from "./issues/execution-approval-journal.js";
import { ExecutionApprovalRelay } from "./issues/execution-approval-relay.js";
import { ExecutionApprovalRouter } from "./issues/execution-approval-router.js";
import { IssueAppServerTransport } from "./issues/execution-app-server.js";
import { IssueExecutionRuntime } from "./issues/execution-runtime.js";
import { freezeExecutionIntent } from "./issues/execution-intent.js";
import type { IssueProjectContext } from "./issues/project-context.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { CodexAppServer } from "./codex-app-server.js";

function child(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid, killed: false, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn().mockReturnValue(true),
  });
}
function reply(target: ReturnType<typeof child>, id: number, result: unknown) {
  target.stdout.write(`${JSON.stringify({ id, result })}\n`);
}
function useChildren(...children: ReturnType<typeof child>[]) {
  const killers: EventEmitter[] = [];
  for (const item of children) {
    mocks.spawn.mockReturnValueOnce(item);
    if (process.platform === "win32") { const killer = new EventEmitter(); killers.push(killer); mocks.spawn.mockReturnValueOnce(killer); }
  }
  return killers;
}

describe("App Server lifecycle isolation", () => {
  beforeEach(() => mocks.spawn.mockReset());

  it("waits for the local approval response write and rejects an exited child", async () => {
    const first = child(100), server = new CodexAppServer(); useChildren(first);
    const starting = server.start(); reply(first, 1, {}); await starting;
    let complete!: (error?: Error | null) => void;
    const write = vi.fn((_data: string, callback: (error?: Error | null) => void) => { complete = callback; return true; });
    Object.defineProperty(first.stdin, "write", { value: write, configurable: true });
    let settled = false;
    const sent = server.respondAndWait(7, { decision: "decline" }).then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ id: 7, result: { decision: "decline" } });
    complete(); await sent; expect(settled).toBe(true);
    const uncertain = server.respondAndWait(8, { decision: "accept" });
    const rejected = expect(uncertain).rejects.toThrow(/unconfirmed/);
    first.emit("exit", 1, null); await rejected;
    complete();
    await expect(server.respondAndWait(9, {})).rejects.toThrow(/unavailable/);
  });

  it("reports a failed local response write without exposing its error contents", async () => {
    const first = child(99), server = new CodexAppServer(); useChildren(first);
    const starting = server.start(); reply(first, 1, {}); await starting;
    let complete!: (error?: Error | null) => void;
    Object.defineProperty(first.stdin, "write", { value: (_data: string, callback: (error?: Error | null) => void) => { complete = callback; return true; }, configurable: true });
    const result = server.respondAndWait(1, {});
    complete(new Error("sensitive synthetic detail"));
    await expect(result).rejects.toThrow("App Server response delivery is unconfirmed.");
    first.emit("exit", 0, null);
  });

  it("routes a synthetic App Server approval through durable recording before responding", async () => {
    const first = child(98), server = new CodexAppServer(), db = new DatabaseSync(":memory:"); useChildren(first); db.exec(EXECUTION_JOURNAL_SCHEMA);
    try {
      const journal = new ExecutionJournal(db), approvals = new ExecutionApprovalJournal(db), owner = new AbortController();
      const record = journal.prepare({ projectId: "project-a", issueId: "issue-a", idempotencyKey: "key", projectRevision: 1, requestDigest: "a".repeat(64) }).record;
      journal.beginDispatch("project-a", record.attemptId); journal.markRunning("project-a", record.attemptId, "thread-a", "turn-a");
      const started = server.start(); reply(first, 1, {}); await started;
      const writes: string[] = []; first.stdin.on("data", (value: Buffer) => writes.push(value.toString()));
      const relay = new ExecutionApprovalRelay({
        valid: (binding, signal) => signal === owner.signal && binding.projectId === "project-a" && binding.attemptId === record.attemptId && binding.threadId === "thread-a" && binding.turnId === "turn-a" && binding.requestId === 17,
        persist: async (binding, action) => { if (action.type === "request") approvals.recordRequest(binding, action.kind); else if (action.type === "respond") approvals.beginResponse(binding, action.decision); else approvals.finishResponse(binding, action.result); },
        show: () => { expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("pending"); },
        send: (binding, decision) => { expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("responding"); return server.respondAndWait(binding.requestId, { decision }); },
        unsafe: () => { throw new Error("unexpected unsafe fixture"); },
      });
      let request: Promise<string> | null = null;
      server.on("request", message => { request = relay.request({ projectId: "project-a", attemptId: record.attemptId, threadId: String(message.params?.threadId), turnId: String(message.params?.turnId), requestId: message.id }, "command", owner.signal); });
      first.stdout.write(`${JSON.stringify({ id: 17, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId: "turn-a" } })}\n`);
      await vi.waitFor(() => expect(request).not.toBeNull());
      const approvalId = await request!;
      await relay.respond(approvalId, owner.signal, "decline");
      expect(writes.some(value => value.includes('"id":17') && value.includes('"decision":"decline"'))).toBe(true);
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "sent", decision: "decline" });
      first.emit("exit", 0, null);
    } finally { db.close(); }
  });
  it("routes a registered issue request from App Server through its owner and journal", async () => {
    const first = child(97), server = new CodexAppServer(), db = new DatabaseSync(":memory:"); useChildren(first); db.exec(EXECUTION_JOURNAL_SCHEMA);
    try {
      const journal = new ExecutionJournal(db), approvals = new ExecutionApprovalJournal(db), owner = new AbortController();
      const record = journal.prepare({ projectId: "project-a", issueId: "issue-a", idempotencyKey: "key", projectRevision: 1, requestDigest: "a".repeat(64) }).record;
      journal.beginDispatch("project-a", record.attemptId); journal.markRunning("project-a", record.attemptId, "thread-a", "turn-a");
      const started = server.start(); reply(first, 1, {}); await started;
      const writes: string[] = []; first.stdin.on("data", (value: Buffer) => writes.push(value.toString()));
      let shown = "", unsafe = 0;
      const router = new ExecutionApprovalRouter({
        show: (signal, approvalId) => { expect(signal).toBe(owner.signal); expect(db.prepare("SELECT state FROM issue_approval_journal").get()?.state).toBe("pending"); shown = approvalId; },
        write: (request, decision) => server.respondAndWait(request.id, { decision }), deny: () => { throw new Error("unexpected denial"); }, resolved: () => {},
      });
      const close = router.register({ owner: owner.signal, projectId: "project-a", attemptId: record.attemptId, threadId: "thread-a", turnId: "turn-a", valid: () => true, persist: async (binding, action) => { if (action.type === "request") approvals.recordRequest(binding, action.kind); else if (action.type === "respond") approvals.beginResponse(binding, action.decision); else approvals.finishResponse(binding, action.result); }, unsafe: () => { unsafe++; } });
      server.on("request", request => { expect(router.serverRequest(request)).toBe(true); });
      first.stdout.write(`${JSON.stringify({ id: 17, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId: "turn-a" } })}\n`);
      await vi.waitFor(() => expect(shown).not.toBe(""));
      await expect(router.resolve(shown, new AbortController().signal, "accept")).rejects.toThrow();
      await router.resolve(shown, owner.signal, "decline");
      expect(writes.some(value => value.includes('"id":17') && value.includes('"decision":"decline"'))).toBe(true);
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "sent", decision: "decline" });
      close(); expect(unsafe).toBe(0); first.emit("exit", 0, null);
    } finally { db.close(); }
  });
  it("reserves issue approvals before thread and turn start in a synthetic protocol flow", async () => {
    const first = child(96), server = new CodexAppServer(), db = new DatabaseSync(":memory:"); useChildren(first); db.exec(EXECUTION_JOURNAL_SCHEMA);
    try {
      const journal = new ExecutionJournal(db), approvals = new ExecutionApprovalJournal(db), owner = new AbortController();
      const record = journal.prepare({ projectId: "project-a", issueId: "issue-a", idempotencyKey: "key", projectRevision: 1, requestDigest: "a".repeat(64) }).record;
      const started = server.start(); reply(first, 1, {}); await started;
      first.stdin.on("data", () => {}); let shown = "", unsafe = 0;
      const router = new ExecutionApprovalRouter({ show: (_owner, id) => { shown = id; }, write: (request, decision) => server.respondAndWait(request.id, { decision }), deny: () => {}, resolved: () => {} });
      const launch = router.registerLaunching({ owner: owner.signal, projectId: "project-a", attemptId: record.attemptId, valid: () => true, persist: async (binding, action) => { if (action.type === "request") approvals.recordRequest(binding, action.kind); else if (action.type === "respond") approvals.beginResponse(binding, action.decision); else approvals.finishResponse(binding, action.result); }, unsafe: () => { unsafe++; } });
      server.on("request", request => { expect(router.serverRequest(request)).toBe(true); });
      journal.beginDispatch("project-a", record.attemptId);
      const thread = server.request<{ thread: { id: string } }>("thread/start", {}); reply(first, 2, { thread: { id: "thread-a" } });
      launch.bindThread((await thread).thread.id);
      const turn = server.request<{ turn: { id: string } }>("turn/start", {}); reply(first, 3, { turn: { id: "turn-a" } });
      const turnId = (await turn).turn.id; journal.markRunning("project-a", record.attemptId, "thread-a", turnId); launch.bindTurn(turnId);
      first.stdout.write(`${JSON.stringify({ id: 17, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId } })}\n`);
      await vi.waitFor(() => expect(shown).not.toBe("")); await router.resolve(shown, owner.signal, "decline");
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "sent", decision: "decline" });
      launch.close(); expect(unsafe).toBe(0); first.emit("exit", 0, null);
    } finally { db.close(); }
  });

  it("runs the issue coordinator through the real App Server parser and journal", async () => {
    const first = child(95), server = new CodexAppServer(), db = new DatabaseSync(":memory:"), [killer] = useChildren(first); db.exec(EXECUTION_JOURNAL_SCHEMA);
    try {
      const journal = new ExecutionJournal(db), approvals = new ExecutionApprovalJournal(db), owner = new AbortController();
      const started = server.start(); reply(first, 1, {}); await started;
      const writes: string[] = []; first.stdin.on("data", (value: Buffer) => writes.push(value.toString()));
      const intent = freezeExecutionIntent({ projectId: "project-a", documentId: "doc-a", issueId: "issue-a", projectRevision: 1, documentRevision: 1, instruction: "synthetic issue", policy: { sandbox: "workspace-write", networkAccess: false, approval: "manual", revision: 1 } }).intent;
      let shown = "", held = false;
      const router = new ExecutionApprovalRouter({ show: (_signal, id) => { shown = id; }, write: (request, decision) => server.respondAndWait(request.id, { decision }), deny: () => { throw new Error("unexpected denial"); }, resolved: () => {} });
      server.on("request", request => { expect(router.serverRequest(request)).toBe(true); });
      server.on("terminationConfirmed", () => router.resetAfterConfirmedStop());
      const context = {
        prepareExecution: async () => ({ intent, ...journal.prepare({ projectId: "project-a", issueId: "issue-a", idempotencyKey: "key", projectRevision: 1, requestDigest: "a".repeat(64) }) }),
        transitionExecution: async (input: Parameters<IssueProjectContext["transitionExecution"]>[0]) => {
          const a = input.action;
          if (a.type === "dispatch") return journal.beginDispatch("project-a", input.attemptId);
          if (a.type === "running") return journal.markRunning("project-a", input.attemptId, a.threadId, a.turnId);
          if (a.type === "verifying") return journal.beginVerification("project-a", input.attemptId);
          if (a.type === "unknown") return journal.markOutcomeUnknown("project-a", input.attemptId);
          if (a.type === "settle") return journal.settle("project-a", input.attemptId, a.outcome);
          throw new Error("unexpected transition");
        },
        registerExecutionApprovals: async (_router: ExecutionApprovalRouter, input: { owner: AbortSignal; projectId: string; attemptId: string }, valid: () => boolean, unsafe: () => void) => router.registerLaunching({ ...input, valid, unsafe, persist: async (binding, action) => { if (action.type === "request") approvals.recordRequest(binding, action.kind); else if (action.type === "respond") approvals.beginResponse(binding, action.decision); else approvals.finishResponse(binding, action.result); } }),
      } as unknown as Pick<IssueProjectContext, "prepareExecution" | "transitionExecution" | "registerExecutionApprovals">;
      const transport = new IssueAppServerTransport(server, { projectPath: "C:/synthetic/project", model: "test-model", validateProject: async value => value, canRun: () => held });
      const runtime = new IssueExecutionRuntime({ context, router, transport, permitted: () => true, acquire: () => { held = true; return () => { held = false; }; } });
      const run = runtime.run({ projectId: "project-a", documentId: "doc-a", issueId: "issue-a", expectedRevision: 1, idempotencyKey: "key", owner: owner.signal });
      await vi.waitFor(() => expect(writes.some(line => line.includes('"method":"thread/start"'))).toBe(true)); reply(first, 2, { thread: { id: "thread-a" } });
      await vi.waitFor(() => expect(writes.some(line => line.includes('"method":"turn/start"'))).toBe(true)); reply(first, 3, { turn: { id: "turn-a" } });
      await vi.waitFor(() => expect(db.prepare("SELECT phase FROM issue_dispatch_journal").get()?.phase).toBe("running"));
      first.stdout.write(`${JSON.stringify({ id: 17, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId: "turn-a" } })}\n`);
      await vi.waitFor(() => expect(shown).not.toBe("")); await router.resolve(shown, owner.signal, "decline");
      first.stdout.write(`${JSON.stringify({ method: "turn/completed", params: { threadId: "thread-a", turn: { id: "turn-a", status: "completed" } } })}\n`);
      if (process.platform === "win32") await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
      else await vi.waitFor(() => expect(first.kill).toHaveBeenCalled());
      first.emit("exit", 0, null); if (process.platform === "win32") killer.emit("exit", 0, null);
      expect((await run).phase).toBe("verifying"); expect(held).toBe(false);
      expect(db.prepare("SELECT state,decision FROM issue_approval_journal").get()).toMatchObject({ state: "sent", decision: "decline" });
      expect(writes.some(line => line.includes('"id":17') && line.includes('"decision":"decline"'))).toBe(true);
    } finally { db.close(); }
  });

  it("ignores output and exit from an old child after a new child starts", async () => {
    const first = child(101), second = child(102);
    const [killer] = useChildren(first, second);
    const server = new CodexAppServer(), exits = vi.fn(); server.on("exit", exits);
    const firstStart = server.start(); reply(first, 1, {}); await firstStart;
    const abandoned = server.request("synthetic/old", {}); const rejected = expect(abandoned).rejects.toThrow(/stopped/);
    server.stop(); await rejected;
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
    const stopped = server.stopAndWait(); first.emit("exit", 0, null); if (process.platform === "win32") killer.emit("exit", 0, null); await stopped;
    expect(exits).toHaveBeenCalledTimes(1); exits.mockClear();
    const secondStart = server.start(); reply(second, 3, {}); await secondStart;
    first.emit("exit", 0, null);
    expect(server.ready).toBe(true); expect(exits).not.toHaveBeenCalled();
    const pending = server.request<{ source: string }>("synthetic/new", {});
    reply(first, 4, { source: "old" }); reply(second, 4, { source: "new" });
    await expect(pending).resolves.toEqual({ source: "new" });
    expect(server.ready).toBe(true);
    second.emit("exit", 0, null);
  });

  it("shares termination confirmation and rejects new starts while an old child may run", async () => {
    const first = child(201);
    const [killer] = useChildren(first);
    const server = new CodexAppServer(), exits = vi.fn(); server.on("exit", exits);
    const starting = server.start(); reply(first, 1, {}); await starting;
    const firstStop = server.stopAndWait(), secondStop = server.stopAndWait();
    expect(firstStop).toBe(secondStop);
    if (process.platform === "win32") expect(mocks.spawn).toHaveBeenLastCalledWith("taskkill.exe", ["/PID", "201", "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
    let settled = false; void firstStop.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    first.emit("exit", 0, null);
    if (process.platform === "win32") { await Promise.resolve(); expect(settled).toBe(false); killer.emit("exit", 0, null); }
    await Promise.all([firstStop, secondStop]);
    expect(exits).toHaveBeenCalledTimes(1);
  });

  it("does not confirm Windows tree termination when taskkill reports failure after the wrapper exits", async () => {
    if (process.platform !== "win32") return;
    const first = child(251), [killer] = useChildren(first);
    const server = new CodexAppServer(), confirmed = vi.fn(); server.on("terminationConfirmed", confirmed);
    const starting = server.start(); reply(first, 1, {}); await starting;
    const stopping = server.stopAndWait();
    const rejected = expect(stopping).rejects.toThrow(/termination was not confirmed/);
    first.emit("exit", 0, null); killer.emit("exit", 1, null); await rejected;
    expect(confirmed).not.toHaveBeenCalled();
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
  });

  it("keeps admission blocked if the Windows termination helper cannot start", async () => {
    if (process.platform !== "win32") return;
    const first = child(252), [killer] = useChildren(first);
    const server = new CodexAppServer();
    const starting = server.start(); reply(first, 1, {}); await starting;
    const stopping = server.stopAndWait();
    const rejected = expect(stopping).rejects.toThrow(/termination was not confirmed/);
    killer.emit("error", new Error("synthetic helper failure")); await rejected;
    expect(first.kill).toHaveBeenCalledTimes(1);
    first.emit("exit", 0, null);
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
  });

  it("does not let a stopped initialization clear a newer start", async () => {
    const first = child(301), second = child(302);
    const [killer] = useChildren(first, second);
    const server = new CodexAppServer();
    const oldStart = server.start(); const rejected = expect(oldStart).rejects.toThrow(/stopped/);
    server.stop();
    await rejected; const stopped = server.stopAndWait(); first.emit("exit", 0, null); if (process.platform === "win32") killer.emit("exit", 0, null); await stopped;
    const newStart = server.start();
    expect(server.start()).toBe(newStart);
    reply(second, 2, {}); await newStart;
    expect(server.ready).toBe(true);
    second.emit("exit", 0, null);
  });

  it("does not claim termination after a best-effort stop fails", async () => {
    if (process.platform !== "win32") return;
    const first = child(351), [killer] = useChildren(first);
    const server = new CodexAppServer();
    const started = server.start(); reply(first, 1, {}); await started;
    server.stop(); const stopped = server.stopAndWait();
    const rejected = expect(stopped).rejects.toThrow(/termination was not confirmed/);
    first.emit("exit", 0, null); killer.emit("exit", 1, null); await rejected;
    await expect(server.stopAndWait()).rejects.toThrow(/termination was not confirmed/);
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
  });
  it("waits for an intentional restart without reporting a failure", async () => {
    const first = child(352), [killer] = useChildren(first), exits = vi.fn(), confirmed = vi.fn();
    const server = new CodexAppServer(); server.on("exit", exits); server.on("terminationConfirmed", confirmed);
    const started = server.start(); reply(first, 1, {}); await started;
    const stopped = server.stopAndWait(true);
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
    first.emit("exit", 0, null); if (process.platform === "win32") killer.emit("exit", 0, null); await stopped;
    expect(exits).not.toHaveBeenCalled(); expect(confirmed).toHaveBeenCalledOnce();
  });

  it("keeps termination failure latched when the child has not exited in time", async () => {
    vi.useFakeTimers();
    try {
      const first = child(401);
      useChildren(first);
      const server = new CodexAppServer();
      const starting = server.start(); reply(first, 1, {}); await starting;
      const stopping = server.stopAndWait();
      const rejected = expect(stopping).rejects.toThrow(/termination was not confirmed/);
      await vi.advanceTimersByTimeAsync(10_000); await rejected;
      first.emit("exit", 0, null);
      await expect(server.stopAndWait()).rejects.toThrow(/termination was not confirmed/);
      await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
    } finally { vi.useRealTimers(); }
  });
  it("blocks restart and exclusive stop after an unexpected wrapper exit", async () => {
    const first = child(501); useChildren(first); const server = new CodexAppServer();
    const started = server.start(); reply(first, 1, {}); await started;
    const pending = server.request("synthetic/held", {}); const rejected = expect(pending).rejects.toThrow(/exited/);
    first.emit("exit", 1, null); await rejected;
    await expect(server.stopAndWait()).rejects.toThrow(/termination was not confirmed/);
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
  });
  it("allows retry after a spawn error without a process ID", async () => {
    const first = child(0); first.pid = undefined as unknown as number;
    const second = child(502); mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const server = new CodexAppServer(); const starting = server.start();
    const rejected = expect(starting).rejects.toThrow(); first.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })); await rejected;
    const retry = server.start(); reply(second, 2, {}); await retry; expect(server.ready).toBe(true);
    second.emit("exit", 0, null);
  });
  it("does not leak malformed protocol content or crash on non-object JSON", async () => {
    const first = child(503); useChildren(first); const diagnostics = vi.fn(); const server = new CodexAppServer(); server.on("diagnostic", diagnostics);
    const started = server.start(); reply(first, 1, {}); await started;
    first.stdout.write('synthetic-private-data\nnull\n[]\n42\n');
    expect(diagnostics).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("synthetic-private-data");
    const pending = server.request("synthetic/valid", {}); reply(first, 2, { ok: true }); await expect(pending).resolves.toEqual({ ok: true });
    first.emit("exit", 0, null);
  });
  it("clears request timers immediately when writing fails", async () => {
    const first = child(504); useChildren(first); const server = new CodexAppServer();
    const started = server.start(); reply(first, 1, {}); await started;
    first.stdin.destroy(); await expect(server.request("synthetic/write", {}, 60000)).rejects.toThrow(/stdin is unavailable/);
    expect((server as unknown as { pending: Map<unknown, unknown> }).pending.size).toBe(0);
    first.emit("exit", 0, null);
  });
  it("terminates a spawned server after initialization fails before allowing restart", async () => {
    const first = child(505), [killer] = useChildren(first); const server = new CodexAppServer();
    const starting = server.start(); const rejected = expect(starting).rejects.toThrow(/synthetic initialize failure/);
    first.stdout.write(`${JSON.stringify({ id: 1, error: { message: "synthetic initialize failure" } })}\n`);
    await vi.waitFor(() => expect(first.stdin.writable).toBe(true));
    await vi.waitFor(() => expect(server.ready).toBe(false));
    await expect(server.start()).rejects.toThrow(/termination is not confirmed/);
    first.emit("exit", 0, null); if (process.platform === "win32") killer.emit("exit", 0, null); await rejected;
  });
});
