import type { ProtocolServerRequest } from "../codex-app-server.js";
import type { ApprovalBinding, ApprovalDecision, ApprovalKind } from "./execution-approval-journal.js";
import { ExecutionApprovalRelay } from "./execution-approval-relay.js";

type Action = { type: "request"; kind: ApprovalKind } | { type: "respond"; decision: ApprovalDecision } | { type: "finish"; result: "sent" | "outcome_unknown" };
type Session = {
  owner: AbortSignal; projectId: string; attemptId: string; threadId: string | null; turnId: string | null;
  /** Must confirm the server-owned grant, current request and shared admission. */
  valid(): boolean;
  persist(binding: ApprovalBinding, action: Action): Promise<void>;
  /** Must stop the owning runtime and retain admission if stop is unconfirmed. */
  unsafe(): void;
};
type Handlers = {
  show(owner: AbortSignal, approvalId: string, request: ProtocolServerRequest): void | Promise<void>;
  write(request: ProtocolServerRequest, decision: ApprovalDecision): void | Promise<void>;
  deny(request: ProtocolServerRequest): void;
  resolved(owner: AbortSignal, approvalId: string): void;
};
type Active = { session: Session; threadId: string | null; turnId: string | null; relay: ExecutionApprovalRelay; live: Map<string, ProtocolServerRequest>; approvals: Map<string, string>; unsafe: () => void; isUnsafe: () => boolean; cleanup: () => void };
const key = (id: string | number) => JSON.stringify([typeof id, id]);
const shortId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const protocolId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
const kind = (method: string): ApprovalKind | null => method === "item/commandExecution/requestApproval" || method === "execCommandApproval" ? "command" : method === "item/fileChange/requestApproval" || method === "applyPatchApproval" ? "file" : method === "item/permissions/requestApproval" ? "permission" : null;

/** Internal registration point. No browser message can register an execution. */
export class ExecutionApprovalRouter {
  private active: Active | null = null;
  constructor(private readonly handlers: Handlers) {}

  register(session: Session): () => void {
    if (!session.threadId || !session.turnId) throw new Error("Issue execution turn is not bound");
    return this.open(session);
  }

  /** Reserve before thread/start so even early requests cannot reach a generic UI. */
  registerLaunching(session: Omit<Session, "threadId" | "turnId">): { bindThread: (threadId: string) => void; bindTurn: (turnId: string) => void; close: () => void } {
    const close = this.open({ ...session, threadId: null, turnId: null });
    const active = this.active!;
    const bind = (field: "threadId" | "turnId", value: string) => {
      let valid = false;
      try { valid = active.session.valid() === true; } catch { /* Default deny. */ }
      if (this.active !== active || active[field] !== null || field === "turnId" && !active.threadId || active.isUnsafe() || active.session.owner.aborted || !valid || !protocolId(value)) { active.unsafe(); throw new Error("Issue execution identity binding unavailable"); }
      active[field] = value;
    };
    return { bindThread: threadId => bind("threadId", threadId), bindTurn: turnId => bind("turnId", turnId), close };
  }

  /** Reserve the request channel before turn/start. Until bindTurn is called,
   * requests are denied and the runtime is stopped; none fall through to the
   * generic approval UI. The caller must persist the bound turn before binding. */
  registerStarting(session: Omit<Session, "turnId">): { bindTurn: (turnId: string) => void; close: () => void } {
    if (!session.threadId) throw new Error("Issue execution thread is not bound");
    const close = this.open({ ...session, turnId: null });
    const active = this.active!;
    return {
      bindTurn: turnId => {
        let valid = false;
        try { valid = active.session.valid() === true; } catch { /* Default deny. */ }
        if (this.active !== active || active.turnId !== null || active.isUnsafe() || active.session.owner.aborted || !valid || !protocolId(turnId)) { active.unsafe(); throw new Error("Issue execution turn binding unavailable"); }
        active.turnId = turnId;
      },
      close,
    };
  }

  private open(session: Session): () => void {
    if (this.active || session.owner.aborted || !shortId(session.projectId) || !shortId(session.attemptId) || session.threadId !== null && !protocolId(session.threadId) || session.turnId !== null && !protocolId(session.turnId) || !session.valid()) throw new Error("Issue execution approval registration unavailable");
    session = Object.freeze({ ...session });
    const live = new Map<string, ProtocolServerRequest>(), approvals = new Map<string, string>();
    let stopped = false;
    const unsafe = () => { if (stopped) return; stopped = true; try { session.unsafe(); } catch { /* The caller must retain admission. */ } };
    let active!: Active;
    const relay = new ExecutionApprovalRelay({
      valid: (binding, owner) => this.active === active && !stopped && owner === session.owner && binding.projectId === session.projectId && binding.attemptId === session.attemptId && binding.threadId === active.threadId && binding.turnId === active.turnId && live.has(key(binding.requestId)) && session.valid(),
      persist: (binding, action) => session.persist(binding, action),
      show: async (approvalId, binding, _kind, owner) => {
        const requestKey = key(binding.requestId), request = live.get(requestKey);
        if (!request || owner !== session.owner) throw new Error("Approval request expired");
        approvals.set(approvalId, requestKey);
        try { await this.handlers.show(owner, approvalId, request); } catch (error) { approvals.delete(approvalId); throw error; }
      },
      send: (binding, decision) => { const request = live.get(key(binding.requestId)); if (!request) throw new Error("Approval request expired"); return this.handlers.write(request, decision); },
      unsafe,
    });
    const onAbort = () => unsafe();
    const cleanup = () => { session.owner.removeEventListener("abort", onAbort); relay.invalidate(); if (this.active === active) this.active = null; };
    active = { session, threadId: session.threadId, turnId: session.turnId, relay, live, approvals, unsafe, isUnsafe: () => stopped, cleanup }; this.active = active;
    session.owner.addEventListener("abort", onAbort, { once: true });
    if (session.owner.aborted) unsafe();
    return () => {
      if (this.active !== active) return;
      if (!active.threadId || !active.turnId || live.size || approvals.size || active.isUnsafe()) { unsafe(); return; }
      cleanup();
    };
  }

  /** Call only for the same App Server after its process termination is confirmed. */
  resetAfterConfirmedStop(): void { this.active?.cleanup(); }

  /** Consumes all requests while exclusively registered, including foreign ones. */
  serverRequest(request: ProtocolServerRequest): boolean {
    const active = this.active; if (!active) return false;
    const { session, live } = active, requestKind = kind(request.method), requestKey = key(request.id);
    const validId = typeof request.id === "string" ? request.id.length > 0 && request.id.length <= 1024 && !/[\x00-\x1f\x7f]/.test(request.id) : typeof request.id === "number" && Number.isSafeInteger(request.id);
    if (!validId || !requestKind || active.isUnsafe() || !active.threadId || !active.turnId || request.params?.threadId !== active.threadId || request.params?.turnId !== active.turnId || live.has(requestKey) || session.owner.aborted) {
      try { this.handlers.deny(request); } catch { /* Stop still required. */ }
      active.unsafe(); return true;
    }
    let fixed: ProtocolServerRequest;
    try { if (Buffer.byteLength(JSON.stringify(request), "utf8") > 64 * 1024) throw new Error("request too large"); fixed = structuredClone(request); }
    catch { try { this.handlers.deny(request); } catch { /* Stop still required. */ } active.unsafe(); return true; }
    live.set(requestKey, fixed);
    const binding: ApprovalBinding = { projectId: session.projectId, attemptId: session.attemptId, threadId: active.threadId, turnId: active.turnId, requestId: request.id };
    void active.relay.request(binding, requestKind, session.owner).catch(() => { live.delete(requestKey); try { this.handlers.deny(fixed); } catch { /* Stop still required. */ } active.unsafe(); });
    return true;
  }

  has(approvalId: string): boolean { return this.active?.approvals.has(approvalId) ?? false; }
  async resolve(approvalId: string, owner: AbortSignal | undefined, decision: ApprovalDecision): Promise<void> {
    const active = this.active, requestKey = active?.approvals.get(approvalId);
    if (!active || !requestKey || !owner || owner !== active.session.owner) throw new Error("이 연결의 승인 요청이 아닙니다.");
    try { await active.relay.respond(approvalId, owner, decision); this.handlers.resolved(owner, approvalId); }
    catch (error) { active.unsafe(); throw error; }
    finally { active.approvals.delete(approvalId); active.live.delete(requestKey); }
  }
}
