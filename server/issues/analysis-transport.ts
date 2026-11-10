import type { ProtocolNotification, ProtocolServerRequest } from "../codex-app-server.js";
import { AnalysisTurnCapture, isSafeAnalysisItem } from "./analysis-turn.js";
import { buildSegmentAnalysisRequest } from "./analysis-request.js";
import type { SegmentEvidence } from "./analysis-output.js";

type Input = SegmentEvidence & { instruction: string };
type Server = { request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T>; respondError(id: string | number, code: number, message: string): void; stopAndWait(): Promise<void> };
export type AnalysisCommandApprovalHandler = { request(request: ProtocolServerRequest): boolean; cancel(threadId: string): void };
type Options = { cwd: string | (() => Promise<string>); model: string; config: Record<string, boolean | string>; disabledPluginIds: string[]; canRun(): boolean; acquire(): (() => void) | null; timeoutMs?: number; commandApprovals?: AnalysisCommandApprovalHandler; commandEnvironmentId?: string; buildRequest?: (input: Input) => { input: { type: "text"; text: string; text_elements: never[] }[]; outputSchema: object } };
type Active = { capture: AnalysisTurnCapture | null; threadId: string | null; turnId: string | null; wake: () => void; cancel: () => void; denied: boolean; cancelled: boolean; approvalCleanupFailed: boolean };

function isCommandApproval(request: ProtocolServerRequest, expectedEnvironmentId?: string): boolean {
  const params = request.params;
  return request.method === "item/commandExecution/requestApproval" && Boolean(params)
    && typeof params?.command === "string" && params.command.trim().length > 0 && params.command.length <= 8192 && !params.command.includes("\0")
    && typeof params.cwd === "string" && params.cwd.length > 0 && params.cwd.length <= 32768 && !params.cwd.includes("\0")
    && (params.kind === undefined || params.kind === "command")
    && (expectedEnvironmentId ? params.environmentId === expectedEnvironmentId : params.environmentId === undefined || params.environmentId === null)
    && (params.networkApprovalContext === undefined || params.networkApprovalContext === null)
    && (params.proposedNetworkPolicyAmendments === undefined || params.proposedNetworkPolicyAmendments === null);
}

/**
 * Internal transport only: caller must supply a verified policy, a dedicated
 * thread, a live grant and shared admission; no browser input can grant them.
 * Route App Server events exclusively through notification/serverRequest while
 * busy. A failed stop latches admission until bridge restart.
 */
export class AnalysisTransport {
  private active: Active | null = null;
  private stuck = false;
  private readonly ownedThreads = new Set<string>();
  constructor(private readonly server: Server, private readonly options: Options) {}
  get busy(): boolean { return this.active !== null || this.stuck; }
  notification(event: ProtocolNotification): boolean {
    const a = this.active;
    const thread = event.params?.threadId;
    // During thread creation the ID is unknown: no event may reach the public
    // timeline until its ownership is known. Admission must be exclusive.
    if (a && !a.threadId) {
      if ((event.method === "item/started" || event.method === "item/completed") && !isSafeAnalysisItem(event.params?.item)) { a.denied = true; a.cancel(); a.wake(); }
      return true;
    }
    if (typeof thread !== "string" || !this.ownedThreads.has(thread)) return false;
    if (a?.capture && a.threadId === thread) {
      // An unexpected turn on this ephemeral thread must not hide tool activity.
      if ((event.method === "item/started" || event.method === "item/completed") && !isSafeAnalysisItem(event.params?.item, Boolean(this.options.commandApprovals) && a.turnId !== null && event.params?.turnId === a.turnId)) { a.denied = true; a.cancel(); }
      a.capture.receive(event);
      if (a.capture.result()?.status === "invalid") { a.denied = true; a.cancel(); }
      a.wake();
    }
    // Retain ownership after completion so late output cannot enter another UI.
    return true;
  }
  serverRequest(request: ProtocolServerRequest): boolean {
    const a = this.active;
    const thread = request.params?.threadId;
    const belongs = typeof thread === "string" && this.ownedThreads.has(thread);
    if (!belongs && (!a || typeof thread === "string" && a.threadId && thread !== a.threadId)) return false;
    if (a && this.options.commandApprovals && !a.denied && !a.cancelled && this.options.canRun() && a.threadId === thread && a.turnId !== null && request.params?.turnId === a.turnId && isCommandApproval(request, this.options.commandEnvironmentId)) {
      try { if (this.options.commandApprovals.request(request)) return true; } catch { /* A failed handoff must deny the request. */ }
    }
    if (a && (belongs && a.threadId === thread || !a.threadId || typeof thread !== "string")) { a.denied = true; a.cancel(); a.wake(); }
    try { this.server.respondError(request.id, -32003, "Analysis does not permit tool or interactive requests."); } catch { /* Failure to reply never turns a denied request into success. */ }
    return true;
  }
  async run(input: Input, signal: AbortSignal): Promise<string> {
    if (this.busy || this.ownedThreads.size >= 4096 || signal.aborted || !this.options.canRun()) throw new Error("Analysis is unavailable");
    const release = this.options.acquire();
    if (!release) throw new Error("Analysis is busy");
    const a: Active = { capture: null, threadId: null, turnId: null, denied: false, cancelled: false, approvalCleanupFailed: false, wake: () => {}, cancel: () => {} }; this.active = a;
    let dispatched = false, terminal = false, releaseSafe = true, timer: ReturnType<typeof setTimeout> | undefined;
    let wake!: () => void; let waiting = new Promise<void>(resolve => { wake = resolve; });
    a.wake = () => { wake(); waiting = new Promise<void>(resolve => { wake = resolve; }); };
    let cancel!: () => void; const cancellation = new Promise<void>(resolve => { cancel = resolve; });
    const cancelApprovals = () => { if (a.threadId && this.options.commandApprovals) { try { this.options.commandApprovals.cancel(a.threadId); } catch { a.approvalCleanupFailed = true; } } };
    a.cancel = () => { if (a.cancelled) return; a.cancelled = true; cancelApprovals(); cancel(); };
    const aborted = () => { a.cancel(); a.wake(); }; signal.addEventListener("abort", aborted);
    let expired = false;
    timer = setTimeout(() => { expired = true; a.cancel(); a.wake(); }, this.options.timeoutMs ?? 120_000); timer.unref();
    const valid = () => !signal.aborted && !expired && !a.denied && this.options.canRun();
    const check = () => { if (!valid()) throw new Error("Analysis cancelled or unavailable"); };
    const awaitRequest = async <T>(request: Promise<T>): Promise<T> => {
      const result = await Promise.race([request.then(value => ({ kind: "reply" as const, value })), cancellation.then(() => ({ kind: "cancelled" as const }))]);
      if (result.kind === "cancelled") throw new Error("Analysis cancelled or unavailable");
      return result.value;
    };
    try {
      check(); const request = this.options.buildRequest ? this.options.buildRequest(input) : buildSegmentAnalysisRequest(input);
      const cwd = typeof this.options.cwd === "string" ? this.options.cwd : await awaitRequest(this.options.cwd()); check();
      const environmentId = this.options.commandApprovals ? this.options.commandEnvironmentId : undefined;
      if (environmentId !== undefined && (typeof environmentId !== "string" || !environmentId || environmentId.length > 1024 || /[\x00-\x1f\x7f]/.test(environmentId))) throw new Error("Invalid analysis environment");
      const environments = environmentId ? [{ environmentId, cwd }] : [];
      dispatched = true;
      const approvalPolicy = this.options.commandApprovals ? "on-request" : "never";
      const thread = await awaitRequest(this.server.request<{ thread?: { id?: string; environments?: unknown } }>("thread/start", { cwd, model: this.options.model, sandbox: "read-only", approvalPolicy, ephemeral: true, environments, config: this.options.config }));
      check();
      if (!thread.thread?.id) throw new Error("Missing thread ID");
      if (environmentId) {
        const selected = thread.thread.environments;
        if (!Array.isArray(selected) || selected.length !== 1 || !selected[0] || typeof selected[0] !== "object" || selected[0].environmentId !== environmentId || typeof selected[0].cwd !== "string" || (process.platform === "win32" ? selected[0].cwd.toLowerCase() !== cwd.toLowerCase() : selected[0].cwd !== cwd)) throw new Error("Analysis environment changed");
      }
      a.threadId = thread.thread.id; a.capture = new AnalysisTurnCapture(a.threadId, Boolean(this.options.commandApprovals)); this.ownedThreads.add(a.threadId);
      const started = await awaitRequest(this.server.request<{ turn?: { id?: string } }>("turn/start", { threadId: a.threadId, ...request, model: this.options.model, sandboxPolicy: { type: "readOnly", networkAccess: false }, approvalPolicy, environments, disabledPluginIds: this.options.disabledPluginIds }));
      if (!started.turn?.id) throw new Error("Missing turn ID");
      a.turnId = started.turn.id; a.capture.bind(started.turn.id); check();
      while (true) {
        const result = a.capture.result();
        if (result) {
          check();
          // A terminal notification must not suppress shutdown after a denial,
          // cancellation, timeout, or policy revocation raced with completion.
          if (result.status !== "invalid") terminal = true;
          if (result.status !== "completed") throw new Error("Analysis turn did not complete");
          return result.text;
        }
        check(); await waiting;
      }
    } catch {
      // A rejected/lost start response, policy request, cancellation or timeout
      // is not proof of termination. Stop the exclusively admitted server.
      if (dispatched && !terminal) {
        try { await this.server.stopAndWait(); } catch { releaseSafe = false; this.stuck = true; }
      }
      throw new Error(releaseSafe ? "Analysis failed or was interrupted" : "Analysis termination could not be confirmed");
    } finally {
      if (timer) clearTimeout(timer); signal.removeEventListener("abort", aborted); a.wake = () => {}; a.cancel = () => {};
      if (!a.cancelled) cancelApprovals();
      if (a.approvalCleanupFailed) { releaseSafe = false; this.stuck = true; try { await this.server.stopAndWait(); } catch { /* Keep admission latched even if termination also fails. */ } }
      if (this.active === a) this.active = null;
      if (releaseSafe) release();
      if (a.approvalCleanupFailed) throw new Error("Analysis approval cleanup could not be confirmed");
    }
  }
}
