import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ExecutionJournal } from "./execution-journal.js";
export { EXECUTION_APPROVAL_SCHEMA } from "./execution-journal.js";

type RequestId = string | number;
export type ApprovalKind = "command" | "file" | "permission";
export type ApprovalDecision = "accept" | "decline" | "cancel";
export type ApprovalBinding = { projectId: string; attemptId: string; threadId: string; turnId: string; requestId: RequestId };
export class ApprovalJournalError extends Error { constructor(readonly code: "INVALID_INPUT" | "INVALID_TRANSITION" | "NOT_FOUND" | "LIMIT_EXCEEDED") { super(code); } }
const fail = (code: ApprovalJournalError["code"]): never => { throw new ApprovalJournalError(code); };
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const protocolId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
function digest(requestId: unknown): string {
  if (!(typeof requestId === "string" && protocolId(requestId) || typeof requestId === "number" && Number.isSafeInteger(requestId))) return fail("INVALID_INPUT");
  return createHash("sha256").update(JSON.stringify([typeof requestId, requestId]), "utf8").digest("hex");
}

/** Internal primitive only: a trusted caller must own and correlate the actual
 * live App Server request and enforce approval authorization before calling it. */
export class ExecutionApprovalJournal {
  constructor(private readonly db: DatabaseSync, private readonly validateProject: () => void = () => {}) {}
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = work(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private bound(binding: ApprovalBinding): string {
    if (!binding || !id(binding.projectId) || !id(binding.attemptId) || !protocolId(binding.threadId) || !protocolId(binding.turnId)) return fail("INVALID_INPUT");
    this.validateProject();
    const key = digest(binding.requestId), attempt = new ExecutionJournal(this.db).get(binding.projectId, binding.attemptId);
    if (attempt.phase !== "running" || attempt.threadId !== binding.threadId || attempt.turnId !== binding.turnId) return fail("INVALID_TRANSITION");
    return key;
  }
  recordRequest(binding: ApprovalBinding, kind: ApprovalKind): void {
    if (!["command", "file", "permission"].includes(kind)) return fail("INVALID_INPUT");
    this.transaction(() => {
      const key = this.bound(binding);
      const count = Number(this.db.prepare("SELECT count(*) AS n FROM issue_approval_journal WHERE attempt_id=?").get(binding.attemptId)?.n);
      if (count >= 1024) return fail("LIMIT_EXCEEDED");
      if (this.db.prepare("SELECT 1 FROM issue_approval_journal WHERE attempt_id=? AND request_digest=?").get(binding.attemptId, key)) return fail("INVALID_TRANSITION");
      this.db.prepare("INSERT INTO issue_approval_journal(attempt_id,request_digest,kind,state) VALUES(?,?,?,'pending')").run(binding.attemptId, key, kind);
    });
  }
  /** Persist before sending; a crash at this point never proves delivery. */
  beginResponse(binding: ApprovalBinding, decision: ApprovalDecision): void {
    if (!["accept", "decline", "cancel"].includes(decision)) return fail("INVALID_INPUT");
    this.transaction(() => {
      const key = this.bound(binding);
      const result = this.db.prepare("UPDATE issue_approval_journal SET state='responding',decision=? WHERE attempt_id=? AND request_digest=? AND state='pending'").run(decision, binding.attemptId, key);
      if (result.changes !== 1) return fail("INVALID_TRANSITION");
    });
  }
  /** 'sent' means only that the local protocol write returned, not that the
   * operation or the issue succeeded. Call unknown on uncertain write failure. */
  finishResponse(binding: ApprovalBinding, result: "sent" | "outcome_unknown"): void {
    if (!(result === "sent" || result === "outcome_unknown")) return fail("INVALID_INPUT");
    this.transaction(() => {
      const key = this.bound(binding);
      const changed = this.db.prepare("UPDATE issue_approval_journal SET state=? WHERE attempt_id=? AND request_digest=? AND state='responding'").run(result, binding.attemptId, key);
      if (changed.changes !== 1) return fail("INVALID_TRANSITION");
    });
  }
  /** After the attempt is marked unknown, invalidate old requests without
   * restoring them or claiming an in-flight response was delivered. */
  invalidateUnknownAttempt(projectId: string, attemptId: string): { expired: number; unknown: number } {
    if (!id(projectId) || !id(attemptId)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      this.validateProject();
      const attempt = new ExecutionJournal(this.db).get(projectId, attemptId);
      if (attempt.phase !== "outcome_unknown") return fail("INVALID_TRANSITION");
      const expired = this.db.prepare("UPDATE issue_approval_journal SET state='expired' WHERE attempt_id=? AND state='pending'").run(attemptId).changes;
      const unknown = this.db.prepare("UPDATE issue_approval_journal SET state='outcome_unknown' WHERE attempt_id=? AND state='responding'").run(attemptId).changes;
      return { expired: Number(expired), unknown: Number(unknown) };
    });
  }
}
