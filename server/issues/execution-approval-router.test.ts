import { describe, expect, it, vi } from "vitest";
import { ExecutionApprovalRouter } from "./execution-approval-router.js";
import type { ProtocolServerRequest } from "../codex-app-server.js";

function setup() {
  const owner = new AbortController(), actions: string[] = [], shown: string[] = []; let unsafe = 0;
  const handlers = { show: (_owner: AbortSignal, id: string) => { shown.push(id); actions.push("show"); }, write: async (_request: ProtocolServerRequest) => { actions.push("write"); }, deny: () => { actions.push("deny"); }, resolved: () => { actions.push("resolved"); } };
  const router = new ExecutionApprovalRouter(handlers);
  const session = { owner: owner.signal, projectId: "project-a", attemptId: "attempt-a", threadId: "thread-a", turnId: "turn-a", valid: () => true, persist: async (_binding: unknown, action: { type: string }) => { actions.push(action.type); }, unsafe: () => { unsafe++; } };
  const request: ProtocolServerRequest = { id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "thread-a", turnId: "turn-a", command: "synthetic" } };
  return { owner, actions, shown, handlers, router, session, request, unsafe: () => unsafe };
}

describe("issue execution approval registration", () => {
  it("passes through when no issue runtime is registered", () => {
    const t = setup(); expect(t.router.serverRequest(t.request)).toBe(false); expect(t.actions).toEqual([]);
  });
  it("rejects malformed runtime identities before reserving the router", () => {
    const t = setup();
    for (const change of [{ projectId: "../other" }, { attemptId: "" }, { threadId: "thread\nforged" }, { turnId: "x".repeat(1025) }]) expect(() => t.router.register({ ...t.session, ...change })).toThrow();
    expect(t.router.serverRequest(t.request)).toBe(false);
  });
  it("reserves the channel before turn start and denies early approvals", () => {
    const t = setup();
    const starting = t.router.registerStarting({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, threadId: t.session.threadId, valid: t.session.valid, persist: t.session.persist, unsafe: t.session.unsafe });
    expect(t.router.serverRequest(t.request)).toBe(true);
    expect(t.actions).toEqual(["deny"]); expect(t.unsafe()).toBe(1);
    expect(() => starting.bindTurn("turn-a")).toThrow(); starting.close();
  });
  it("denies server requests before thread identity is available", () => {
    const t = setup();
    const launch = t.router.registerLaunching({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, valid: t.session.valid, persist: t.session.persist, unsafe: t.session.unsafe });
    expect(t.router.serverRequest(t.request)).toBe(true); expect(t.actions).toEqual(["deny"]); expect(t.unsafe()).toBe(1);
    expect(() => launch.bindThread("thread-a")).toThrow(); launch.close();
  });
  it("binds thread before turn and routes only the confirmed pair", async () => {
    const t = setup();
    const launch = t.router.registerLaunching({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, valid: t.session.valid, persist: t.session.persist, unsafe: t.session.unsafe });
    launch.bindThread("thread-a"); launch.bindTurn("turn-a");
    expect(t.router.serverRequest(t.request)).toBe(true); await vi.waitFor(() => expect(t.shown).toHaveLength(1));
    await t.router.resolve(t.shown[0], t.owner.signal, "decline"); launch.close(); expect(t.unsafe()).toBe(0);
  });
  it("stops on an attempt to bind a turn before its thread", () => {
    const t = setup();
    const launch = t.router.registerLaunching({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, valid: t.session.valid, persist: t.session.persist, unsafe: t.session.unsafe });
    expect(() => launch.bindTurn("turn-a")).toThrow(); expect(t.unsafe()).toBe(1); expect(() => launch.bindThread("thread-a")).toThrow(); launch.close();
  });
  it("stops when the owner disconnects while thread start is still pending", () => {
    const t = setup();
    const launch = t.router.registerLaunching({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, valid: t.session.valid, persist: t.session.persist, unsafe: t.session.unsafe });
    t.owner.abort(); expect(t.unsafe()).toBe(1);
    expect(() => launch.bindThread("thread-a")).toThrow(); launch.close(); expect(t.unsafe()).toBe(1);
  });
  it("does not silently release a registration with an unconfirmed start", () => {
    const t = setup();
    const launch = t.router.registerLaunching({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, valid: t.session.valid, persist: t.session.persist, unsafe: t.session.unsafe });
    launch.bindThread("thread-a"); launch.close(); expect(t.unsafe()).toBe(1);
    expect(t.router.serverRequest(t.request)).toBe(true); expect(t.actions).toContain("deny");
    expect(() => t.router.register(t.session)).toThrow();
    t.router.resetAfterConfirmedStop(); expect(t.router.serverRequest(t.request)).toBe(false);
  });
  it("binds an identified turn once and routes only after binding", async () => {
    const t = setup();
    const starting = t.router.registerStarting({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, threadId: t.session.threadId, valid: t.session.valid, persist: t.session.persist, unsafe: t.session.unsafe });
    starting.bindTurn("turn-a");
    expect(t.router.serverRequest(t.request)).toBe(true); await vi.waitFor(() => expect(t.shown).toHaveLength(1));
    await t.router.resolve(t.shown[0], t.owner.signal, "decline"); starting.close(); expect(t.unsafe()).toBe(0);
  });
  it("stops the runtime when binding is invalid or the admission is withdrawn", () => {
    const t = setup(); let valid = true;
    const starting = t.router.registerStarting({ owner: t.session.owner, projectId: t.session.projectId, attemptId: t.session.attemptId, threadId: t.session.threadId, valid: () => valid, persist: t.session.persist, unsafe: t.session.unsafe });
    valid = false; expect(() => starting.bindTurn("turn-a")).toThrow(); expect(t.unsafe()).toBe(1);
    valid = true; expect(() => starting.bindTurn("turn-a")).toThrow(); starting.close();
  });
  it("routes only an owned live request and persists before showing and writing", async () => {
    const t = setup(), close = t.router.register(t.session);
    expect(t.router.serverRequest(t.request)).toBe(true);
    await vi.waitFor(() => expect(t.shown).toHaveLength(1));
    await expect(t.router.resolve(t.shown[0], new AbortController().signal, "accept")).rejects.toThrow();
    await t.router.resolve(t.shown[0], t.owner.signal, "decline");
    expect(t.actions).toEqual(["request", "show", "respond", "write", "finish", "resolved"]);
    expect(t.router.has(t.shown[0])).toBe(false); close(); expect(t.unsafe()).toBe(0);
  });
  it("consumes and denies foreign or malformed requests without displaying them", () => {
    const t = setup(), close = t.router.register(t.session);
    expect(t.router.serverRequest({ ...t.request, params: { threadId: "thread-a", turnId: "other" } })).toBe(true);
    expect(t.actions).toEqual(["deny"]); expect(t.unsafe()).toBe(1); expect(t.shown).toHaveLength(0);
    close();
  });
  it("stops if the owner disconnects before an approval is resolved", async () => {
    const t = setup(), close = t.router.register(t.session); t.router.serverRequest(t.request);
    await vi.waitFor(() => expect(t.shown).toHaveLength(1)); t.owner.abort();
    expect(t.unsafe()).toBe(1); await expect(t.router.resolve(t.shown[0], t.owner.signal, "accept")).rejects.toThrow();
    expect(t.actions).not.toContain("write"); close();
  });
  it("denies and stops if recording the actual request fails", async () => {
    const t = setup(); t.session.persist = async () => { throw new Error("synthetic store failure"); };
    const close = t.router.register(t.session);
    expect(t.router.serverRequest(t.request)).toBe(true);
    await vi.waitFor(() => expect(t.actions).toContain("deny"));
    expect(t.unsafe()).toBe(1); expect(t.shown).toHaveLength(0); expect(t.actions).not.toContain("write"); close();
  });
  it("stops rather than discarding an owned approval after a stale decision", async () => {
    const t = setup(); let valid = true; t.session.valid = () => valid;
    const close = t.router.register(t.session); t.router.serverRequest(t.request);
    await vi.waitFor(() => expect(t.shown).toHaveLength(1)); valid = false;
    await expect(t.router.resolve(t.shown[0], t.owner.signal, "accept")).rejects.toThrow();
    expect(t.unsafe()).toBe(1); expect(t.actions).not.toContain("write"); close();
  });
  it("does not register twice or keep a mutable caller-owned identity", async () => {
    const t = setup(), close = t.router.register(t.session);
    expect(() => t.router.register(t.session)).toThrow(); t.session.threadId = "other";
    expect(t.router.serverRequest(t.request)).toBe(true); await vi.waitFor(() => expect(t.shown).toHaveLength(1));
    close(); expect(t.unsafe()).toBe(1);
  });
});
