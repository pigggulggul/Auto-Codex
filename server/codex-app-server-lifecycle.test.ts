import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("ignores output and exit from an old child after a new child starts", async () => {
    const first = child(101), second = child(102);
    useChildren(first, second);
    const server = new CodexAppServer(), exits = vi.fn(); server.on("exit", exits);
    const firstStart = server.start(); reply(first, 1, {}); await firstStart;
    const abandoned = server.request("synthetic/old", {}); const rejected = expect(abandoned).rejects.toThrow(/stopped/);
    server.stop(); await rejected;
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
    const server = new CodexAppServer();
    const starting = server.start(); reply(first, 1, {}); await starting;
    const stopping = server.stopAndWait();
    const rejected = expect(stopping).rejects.toThrow(/termination was not confirmed/);
    first.emit("exit", 0, null); killer.emit("exit", 1, null); await rejected;
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
    useChildren(first, second);
    const server = new CodexAppServer();
    const oldStart = server.start(); const rejected = expect(oldStart).rejects.toThrow(/stopped/);
    server.stop();
    const newStart = server.start(); await rejected;
    expect(server.start()).toBe(newStart);
    reply(second, 2, {}); await newStart;
    expect(server.ready).toBe(true);
    second.emit("exit", 0, null);
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
});
