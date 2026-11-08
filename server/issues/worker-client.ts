import { Worker } from "node:worker_threads";
import { validateIssueWorkerRequest } from "./worker-service.js";
import type { IssueWorkerErrorCode, IssueWorkerRequest, IssueWorkerResult } from "./worker-contract.js";

export class IssueWorkerClientError extends Error {
  constructor(readonly code: IssueWorkerErrorCode, message: string) { super(message); }
}
type Pending = { resolve: (value: IssueWorkerResult | null) => void; reject: (error: IssueWorkerClientError) => void; timer: ReturnType<typeof setTimeout>; mutating: boolean };
const MAX_IN_FLIGHT = 8;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Bridge-owned adapter. Never forward renderer-supplied project paths or authorization claims here. */
export class IssueWorkerClient {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private failure: IssueWorkerClientError | null = null;
  private sequence = 0;
  private inFlight = 0;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(root: string, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new IssueWorkerClientError("INVALID_INPUT", "worker 시간 제한이 올바르지 않습니다.");
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { workerData: { root }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    this.ready = new Promise(resolve => {
      let settled = false;
      const startupTimer = setTimeout(() => { this.failAll(); markReady(); void this.worker.terminate(); }, this.timeoutMs);
      startupTimer.unref();
      const markReady = () => { if (!settled) { settled = true; clearTimeout(startupTimer); resolve(); } };
      const fail = () => { this.failAll(); markReady(); };
      this.worker.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const m = message as Record<string, unknown>;
        if (m.ready === true) { markReady(); return; }
        if (m.ready === false) { fail(); return; }
        if (!Number.isSafeInteger(m.id)) return;
        const pending = this.pending.get(Number(m.id)); if (!pending) return;
        this.pending.delete(Number(m.id)); clearTimeout(pending.timer);
        if (m.closed === true) { pending.resolve(null); return; }
        if (m.ok === true && m.result && typeof m.result === "object") { pending.resolve(m.result as IssueWorkerResult); return; }
        if (m.ok === false && m.error && typeof m.error === "object") {
          const error = m.error as { code?: unknown; message?: unknown };
          if (typeof error.code === "string" && typeof error.message === "string") { pending.reject(new IssueWorkerClientError(error.code as IssueWorkerErrorCode, error.message)); return; }
        }
        pending.reject(new IssueWorkerClientError(pending.mutating ? "OUTCOME_UNKNOWN" : "WORKER_UNAVAILABLE", "이슈 저장소 응답을 확인할 수 없습니다."));
      });
      this.worker.on("error", fail);
      this.worker.on("exit", () => { if (!this.closing || this.pending.size) fail(); else markReady(); });
    });
  }

  private failAll(): void {
    this.failure = new IssueWorkerClientError("WORKER_UNAVAILABLE", "이슈 저장소 worker를 사용할 수 없습니다.");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new IssueWorkerClientError(pending.mutating ? "OUTCOME_UNKNOWN" : "WORKER_UNAVAILABLE", pending.mutating ? "저장 요청의 결과를 확인할 수 없습니다. 현재 상태를 확인한 뒤 다시 시도하세요." : this.failure.message));
    }
    this.pending.clear();
  }

  private send(message: { request: IssueWorkerRequest } | { close: true }, mutating: boolean): Promise<IssueWorkerResult | null> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.failAll(); void this.worker.terminate(); }, this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer, mutating });
      try { this.worker.postMessage({ id, ...message }); }
      catch {
        clearTimeout(timer); this.pending.delete(id);
        reject(new IssueWorkerClientError("WORKER_UNAVAILABLE", "이슈 저장소에 요청을 전달하지 못했습니다."));
      }
    });
  }

  async request(input: unknown, mayStart?: () => boolean): Promise<IssueWorkerResult> {
    const request = validateIssueWorkerRequest(input);
    if (this.closing || this.failure) throw this.failure || new IssueWorkerClientError("WORKER_UNAVAILABLE", "이슈 저장소가 종료 중입니다.");
    if (this.inFlight >= MAX_IN_FLIGHT) throw new IssueWorkerClientError("BUSY", "이슈 저장소 요청 한도입니다. 이전 요청을 기다리세요.");
    this.inFlight++;
    try {
      // Snapshot at enqueue time, including while the worker is starting.
      const safeRequest = request.operation === "document.import" ? { ...request, bytes: Uint8Array.from(request.bytes) } : request.operation === "execution.approval" ? { ...request, binding: { ...request.binding }, action: { ...request.action } } : request.operation === "execution.prepare" ? { ...request, policy: { ...request.policy } } : request.operation === "execution.transition" ? { ...request, action: { ...request.action } } : { ...request };
      await this.ready;
      if (this.closing || this.failure) throw this.failure || new IssueWorkerClientError("WORKER_UNAVAILABLE", "이슈 저장소가 종료 중입니다.");
      if (mayStart && !mayStart()) throw new IssueWorkerClientError("STALE_SELECTION", "프로젝트나 연결 상태가 바뀌어 이슈 요청을 시작하지 않았습니다.");
      const result = await this.send({ request: safeRequest }, safeRequest.operation === "project.create" || safeRequest.operation === "document.import" || safeRequest.operation === "execution.approval" || safeRequest.operation === "execution.invalidateApprovals" || safeRequest.operation === "execution.prepare" || safeRequest.operation === "execution.transition");
      if (!result) throw new IssueWorkerClientError("WORKER_UNAVAILABLE", "이슈 저장소 응답이 없습니다.");
      return result;
    } finally { this.inFlight--; }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      await this.ready;
      try { if (!this.failure) await this.send({ close: true }, false); }
      finally { await this.worker.terminate(); }
    })();
    return this.closePromise;
  }
}
