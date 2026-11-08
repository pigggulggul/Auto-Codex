import { randomUUID } from "node:crypto";
import type { ApprovalBinding, ApprovalDecision, ApprovalKind } from "./execution-approval-journal.js";

type Action = { type: "request"; kind: ApprovalKind } | { type: "respond"; decision: ApprovalDecision } | { type: "finish"; result: "sent" | "outcome_unknown" };
type OwnedRequest = { binding: ApprovalBinding; owner: AbortSignal; kind: ApprovalKind; state: "recording" | "pending" | "responding"; onAbort: () => void };
type Options = {
  /** This check must use server-owned admission, active request and project state. */
  valid(binding: ApprovalBinding, owner: AbortSignal): boolean;
  persist(binding: ApprovalBinding, action: Action): Promise<void>;
  show(approvalId: string, binding: ApprovalBinding, kind: ApprovalKind, owner: AbortSignal): void | Promise<void>;
  /** Must use the original server-owned request and return only after local write. */
  send(binding: ApprovalBinding, decision: ApprovalDecision): void | Promise<void>;
  /** Stop the owning runtime and keep admission reserved if stopping is uncertain. */
  unsafe(): void;
};

/** Server-internal adapter. Browser approval IDs only select an owned pending
 * request; they never supply the request ID, permissions, command or path. */
export class ExecutionApprovalRelay {
  private requests = new Map<string, OwnedRequest>();
  private requestKeys = new Set<string>();
  private stopped = false;
  constructor(private readonly options: Options) {}
  private valid(request: OwnedRequest): boolean {
    try { return !this.stopped && !request.owner.aborted && this.options.valid(request.binding, request.owner) === true; } catch { return false; }
  }
  private key(binding: ApprovalBinding): string { return JSON.stringify([binding.attemptId, typeof binding.requestId, binding.requestId]); }
  private unsafe(): void { if (this.stopped) return; this.stopped = true; try { this.options.unsafe(); } catch { /* A failed stop must not become an approval. */ } }

  async request(binding: ApprovalBinding, kind: ApprovalKind, owner: AbortSignal): Promise<string> {
    const fixed = Object.freeze({ ...binding }), request: OwnedRequest = { binding: fixed, owner, kind, state: "recording", onAbort: () => this.unsafe() };
    const key = this.key(fixed);
    if (!this.valid(request) || this.requests.size >= 64 || this.requestKeys.has(key) || !["command", "file", "permission"].includes(kind)) throw new Error("Approval unavailable");
    const approvalId = randomUUID(); this.requests.set(approvalId, request); this.requestKeys.add(key); owner.addEventListener("abort", request.onAbort, { once: true });
    try {
      await this.options.persist(fixed, { type: "request", kind });
      if (!this.valid(request) || this.requests.get(approvalId) !== request) throw new Error("Approval expired");
      await this.options.show(approvalId, fixed, kind, owner);
      if (!this.valid(request) || this.requests.get(approvalId) !== request) throw new Error("Approval expired");
      request.state = "pending";
      return approvalId;
    } catch (error) {
      owner.removeEventListener("abort", request.onAbort); this.requests.delete(approvalId); this.requestKeys.delete(key); this.unsafe(); throw error;
    }
  }

  async respond(approvalId: string, owner: AbortSignal, decision: ApprovalDecision): Promise<void> {
    const request = this.requests.get(approvalId);
    if (!request || request.owner !== owner || request.state !== "pending" || !this.valid(request) || !["accept", "decline", "cancel"].includes(decision)) throw new Error("Approval unavailable");
    request.state = "responding";
    let writeAttempted = false;
    try {
      await this.options.persist(request.binding, { type: "respond", decision });
      if (!this.valid(request) || this.requests.get(approvalId) !== request) throw new Error("Approval expired");
      writeAttempted = true;
      await this.options.send(request.binding, decision);
      await this.options.persist(request.binding, { type: "finish", result: "sent" });
    } catch (error) {
      if (writeAttempted) { try { await this.options.persist(request.binding, { type: "finish", result: "outcome_unknown" }); } catch { /* Preserve the uncertain state. */ } }
      this.unsafe(); throw error;
    } finally {
      owner.removeEventListener("abort", request.onAbort); this.requests.delete(approvalId); this.requestKeys.delete(this.key(request.binding));
    }
  }

  /** Invalidates local handles; the runtime must also stop or deny its requests. */
  invalidate(): void { this.stopped = true; for (const request of this.requests.values()) request.owner.removeEventListener("abort", request.onAbort); this.requests.clear(); this.requestKeys.clear(); }
}
