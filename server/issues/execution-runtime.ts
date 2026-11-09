import type { ExecutionApprovalRouter } from "./execution-approval-router.js";
import type { FrozenExecutionIntent } from "./execution-intent.js";
import type { JournalRecord } from "./execution-journal.js";
import type { IssueProjectContext } from "./project-context.js";

type StartInput = { projectId: string; documentId: string; issueId: string; expectedRevision: number; idempotencyKey: string; owner: AbortSignal };
type Completion = { threadId: string; turnId: string; status: "completed" | "failed" | "interrupted" };
type Transport = {
  /** Must enforce the frozen policy and validate the actual project path/model. */
  startThread(intent: FrozenExecutionIntent): Promise<string>;
  startTurn(threadId: string, intent: FrozenExecutionIntent): Promise<string>;
  /** Must buffer notifications before turn/start resolves, and reject on disconnect or stop. */
  waitForCompletion(threadId: string, turnId: string): Promise<Completion>;
  /** Must resolve only after the entire owned process tree is confirmed stopped. */
  stopAndWait(): Promise<void>;
  disposeUnused?(): void;
};
type Options = {
  context: Pick<IssueProjectContext, "prepareExecution" | "transitionExecution" | "registerExecutionApprovals">;
  router: ExecutionApprovalRouter;
  transport: Transport;
  /** Shared bridge admission; null means another operation owns it. */
  acquire(): (() => void) | null;
  /** Server-owned execution grant and selected project; independent of App Server readiness. */
  permitted(): boolean;
};

export class IssueExecutionRuntimeError extends Error {
  constructor(readonly code: "BUSY" | "STALE" | "EXISTING_ATTEMPT" | "OUTCOME_UNKNOWN", message: string) { super(message); }
}

/**
 * Trusted bridge coordinator. This class is not an entry point or a process-tree
 * verifier: the caller must supply an authorized grant, exclusive admission and
 * a transport that actually enforces the requested sandbox and confirms stop.
 */
export class IssueExecutionRuntime {
  private held = false;
  constructor(private readonly options: Options) {}
  get busy(): boolean { return this.held; }

  async run(input: StartInput): Promise<JournalRecord> {
    if (this.held) throw new IssueExecutionRuntimeError("BUSY", "다른 작업이 진행 중입니다.");
    const fixed = { ...input }, release = this.options.acquire();
    if (!release) throw new IssueExecutionRuntimeError("BUSY", "다른 작업이 진행 중입니다.");
    this.held = true;
    let canRelease = false, unsafe = false, stopped: Promise<void> | null = null;
    let record: JournalRecord | null = null, dispatchAttempted = false;
    let session: Awaited<ReturnType<IssueProjectContext["registerExecutionApprovals"]>> | null = null;
    const permitted = () => { try { return this.held && !unsafe && !fixed.owner.aborted && this.options.permitted() === true; } catch { return false; } };
    // Cleanup writes require ownership and selection but not a still-connected UI.
    const mayRecord = () => { try { return this.held && this.options.permitted() === true; } catch { return false; } };
    const requirePermit = () => { if (!permitted()) throw new IssueExecutionRuntimeError("STALE", "프로젝트 또는 실행 권한이 변경되었습니다."); };
    const stop = () => stopped ??= Promise.resolve().then(() => this.options.transport.stopAndWait());
    const stopUnsafe = () => { unsafe = true; void stop().catch(() => {}); };
    // A disconnected owner must not leave an active turn waiting indefinitely.
    // Before dispatch there is no owned process to stop; requirePermit will reject.
    const onOwnerAbort = () => { if (dispatchAttempted) stopUnsafe(); };
    fixed.owner.addEventListener("abort", onOwnerAbort, { once: true });
    const transition = (action: Parameters<IssueProjectContext["transitionExecution"]>[0]["action"]) => this.options.context.transitionExecution({ operation: "execution.transition", projectId: fixed.projectId, expectedRevision: fixed.expectedRevision, attemptId: record!.attemptId, action }, fixed.projectId, mayRecord);
    try {
      requirePermit();
      const prepared = await this.options.context.prepareExecution({ documentId: fixed.documentId, issueId: fixed.issueId, expectedRevision: fixed.expectedRevision, idempotencyKey: fixed.idempotencyKey, policy: { sandbox: "workspace-write", networkAccess: false, approval: "manual", revision: 1 } }, fixed.projectId, permitted);
      if (!prepared.created) { canRelease = true; throw new IssueExecutionRuntimeError("EXISTING_ATTEMPT", "기존 실행 시도를 확인하세요. 자동으로 다시 실행하지 않습니다."); }
      record = prepared.record; requirePermit();
      session = await this.options.context.registerExecutionApprovals(this.options.router, { projectId: fixed.projectId, expectedRevision: fixed.expectedRevision, attemptId: record.attemptId, owner: fixed.owner }, permitted, stopUnsafe);
      requirePermit();
      dispatchAttempted = true;
      await transition({ type: "dispatch" }); requirePermit();
      const threadId = await this.options.transport.startThread(prepared.intent); requirePermit();
      session.bindThread(threadId);
      const turnId = await this.options.transport.startTurn(threadId, prepared.intent); requirePermit();
      await transition({ type: "running", threadId, turnId }); requirePermit();
      session.bindTurn(turnId);
      const completed = await this.options.transport.waitForCompletion(threadId, turnId); requirePermit();
      if (completed.threadId !== threadId || completed.turnId !== turnId || !["completed", "failed", "interrupted"].includes(completed.status)) throw new Error("Unmatched turn completion");
      // Keep the router registered until the exclusive server has stopped.
      await stop(); requirePermit();
      const final = completed.status === "completed" ? await transition({ type: "verifying" }) : await transition({ type: "settle", outcome: completed.status });
      canRelease = true;
      return final;
    } catch (error) {
      if (!record) { canRelease = true; throw error; }
      try {
        if (session || dispatchAttempted) await stop();
        // A possibly committed dispatch is never retried or reported as failed.
        await transition(dispatchAttempted ? { type: "unknown" } : { type: "settle", outcome: "interrupted" });
        canRelease = true;
      } catch { /* Retain admission when termination or durable state is unconfirmed. */ }
      throw new IssueExecutionRuntimeError("OUTCOME_UNKNOWN", "실행 또는 저장 결과를 확인해야 합니다. 자동으로 재실행하지 않습니다.");
    } finally {
      fixed.owner.removeEventListener("abort", onOwnerAbort);
      session?.close();
      if (!session && !dispatchAttempted && canRelease) this.options.transport.disposeUnused?.();
      if (canRelease) { this.held = false; release(); }
    }
  }
}
