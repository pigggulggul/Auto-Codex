import type { ProtocolNotification, ProtocolServerRequest } from "../codex-app-server.js";
import { AnalysisTurnCapture } from "./analysis-turn.js";
import { buildSegmentAnalysisRequest } from "./analysis-request.js";
import type { SegmentEvidence } from "./analysis-output.js";

type Input = SegmentEvidence & { instruction: string };
type Server = { request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T>; respondError(id: string | number, code: number, message: string): void; stopAndWait(): Promise<void> };
type Options = { cwd: string | (() => Promise<string>); model: string; config: Record<string, boolean | string>; disabledPluginIds: string[]; canRun(): boolean; acquire(): (() => void) | null; timeoutMs?: number };
type Active = { capture: AnalysisTurnCapture | null; threadId: string | null; wake: () => void; cancel: () => void; denied: boolean };

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
    if (a && !a.threadId) return true;
    if (typeof thread !== "string" || !this.ownedThreads.has(thread)) return false;
    if (a?.capture && a.threadId === thread) { a.capture.receive(event); a.wake(); }
    // Retain ownership after completion so late output cannot enter another UI.
    return true;
  }
  serverRequest(request: ProtocolServerRequest): boolean {
    const a = this.active;
    const thread = request.params?.threadId;
    const belongs = typeof thread === "string" && this.ownedThreads.has(thread);
    if (!belongs && (!a || typeof thread === "string" && a.threadId && thread !== a.threadId)) return false;
    if (a && (belongs && a.threadId === thread || !a.threadId || typeof thread !== "string")) { a.denied = true; a.cancel(); a.wake(); }
    try { this.server.respondError(request.id, -32003, "Analysis does not permit tool or interactive requests."); } catch { /* Failure to reply never turns a denied request into success. */ }
    return true;
  }
  async run(input: Input, signal: AbortSignal): Promise<string> {
    if (this.busy || this.ownedThreads.size >= 4096 || signal.aborted || !this.options.canRun()) throw new Error("Analysis is unavailable");
    const release = this.options.acquire();
    if (!release) throw new Error("Analysis is busy");
    const a: Active = { capture: null, threadId: null, denied: false, wake: () => {}, cancel: () => {} }; this.active = a;
    let dispatched = false, terminal = false, releaseSafe = true, timer: ReturnType<typeof setTimeout> | undefined;
    let wake!: () => void; let waiting = new Promise<void>(resolve => { wake = resolve; });
    a.wake = () => { wake(); waiting = new Promise<void>(resolve => { wake = resolve; }); };
    let cancel!: () => void; const cancellation = new Promise<void>(resolve => { cancel = resolve; }); a.cancel = cancel;
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
      check(); const request = buildSegmentAnalysisRequest(input);
      const cwd = typeof this.options.cwd === "string" ? this.options.cwd : await this.options.cwd(); check();
      dispatched = true;
      const thread = await awaitRequest(this.server.request<{ thread?: { id?: string } }>("thread/start", { cwd, model: this.options.model, sandbox: "read-only", approvalPolicy: "never", ephemeral: true, environments: [], config: this.options.config }));
      check();
      if (!thread.thread?.id) throw new Error("Missing thread ID");
      a.threadId = thread.thread.id; a.capture = new AnalysisTurnCapture(a.threadId); this.ownedThreads.add(a.threadId);
      const started = await awaitRequest(this.server.request<{ turn?: { id?: string } }>("turn/start", { threadId: a.threadId, ...request, model: this.options.model, sandboxPolicy: { type: "readOnly", networkAccess: false }, approvalPolicy: "never", environments: [], disabledPluginIds: this.options.disabledPluginIds }));
      if (!started.turn?.id) throw new Error("Missing turn ID");
      a.capture.bind(started.turn.id); check();
      while (true) {
        const result = a.capture.result();
        if (result) {
          if (result.status !== "invalid") terminal = true;
          check();
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
      if (this.active === a) this.active = null;
      if (releaseSafe) release();
    }
  }
}
