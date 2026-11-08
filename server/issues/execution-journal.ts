import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Included in fresh issue stores and installed separately when migrating v3. */
export const EXECUTION_APPROVAL_SCHEMA = `
  CREATE TABLE issue_approval_journal (
    attempt_id TEXT NOT NULL REFERENCES issue_dispatch_journal(attempt_id),
    request_digest TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('command','file','permission')),
    state TEXT NOT NULL CHECK(state IN ('pending','responding','sent','outcome_unknown','expired')),
    decision TEXT CHECK(decision IN ('accept','decline','cancel')),
    PRIMARY KEY(attempt_id,request_digest),
    CHECK ((state IN ('pending','expired')) = (decision IS NULL))
  );
`;

export const EXECUTION_JOURNAL_SCHEMA = `
  CREATE TABLE issue_dispatch_journal (
    attempt_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    project_revision INTEGER NOT NULL CHECK(project_revision > 0),
    request_digest TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('prepared','dispatching','running','verifying','outcome_unknown','settled')),
    outcome TEXT CHECK(outcome IN ('interrupted','failed','verification_finished','reconciled_unknown')),
    thread_id TEXT,
    turn_id TEXT,
    UNIQUE(project_id,idempotency_key),
    CHECK ((phase = 'settled') = (outcome IS NOT NULL)),
    CHECK ((thread_id IS NULL) = (turn_id IS NULL)),
    CHECK (phase NOT IN ('running','verifying') OR thread_id IS NOT NULL),
    CHECK (phase NOT IN ('prepared','dispatching') OR thread_id IS NULL)
  );
  CREATE UNIQUE INDEX issue_dispatch_one_open ON issue_dispatch_journal(project_id)
    WHERE phase IN ('prepared','dispatching','running','verifying','outcome_unknown');
  CREATE TABLE issue_dispatch_reconciliation (
    attempt_id TEXT PRIMARY KEY REFERENCES issue_dispatch_journal(attempt_id),
    reason TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  ${EXECUTION_APPROVAL_SCHEMA}
`;

type Identity = { projectId: string; issueId: string; idempotencyKey: string; projectRevision: number; requestDigest: string };
export type JournalRecord = Identity & { attemptId: string; phase: "prepared" | "dispatching" | "running" | "verifying" | "outcome_unknown" | "settled"; outcome: "interrupted" | "failed" | "verification_finished" | "reconciled_unknown" | null; threadId: string | null; turnId: string | null };
export type JournalApprovalCounts = { pending: number; responding: number; sent: number; outcome_unknown: number; expired: number };
export type JournalHistoryEntry = Pick<JournalRecord, "attemptId" | "issueId" | "projectRevision" | "phase" | "outcome"> & { hasRuntimeReference: boolean; approvals: JournalApprovalCounts };
export type JournalHistoryPage = { items: JournalHistoryEntry[]; nextAfterId: string | null };
type JournalCode = "INVALID_INPUT" | "IDEMPOTENCY_CONFLICT" | "PROJECT_BUSY" | "INVALID_TRANSITION" | "NOT_FOUND" | "CORRUPT_RECORD";
export class ExecutionJournalError extends Error {
  constructor(readonly code: JournalCode) { super(code); }
}
const fail = (code: JournalCode): never => { throw new ExecutionJournalError(code); };
const boundedId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const protocolId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);

/**
 * Server-only primitive over a trusted, exclusively managed SQLite connection.
 * It does not authenticate callers, validate revisions/evidence, manage the
 * shared admission lock, start a turn, or itself establish SQLite durability.
 */
export class ExecutionJournal {
  constructor(private readonly db: DatabaseSync, private readonly beforeWrite: () => void = () => {}) {}

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { this.beforeWrite(); const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private read(projectId: string, attemptId: string): JournalRecord {
    const row = this.db.prepare(`SELECT attempt_id AS attemptId, project_id AS projectId, issue_id AS issueId,
      idempotency_key AS idempotencyKey, project_revision AS projectRevision, request_digest AS requestDigest,
      phase, outcome, thread_id AS threadId, turn_id AS turnId FROM issue_dispatch_journal WHERE project_id=? AND attempt_id=?`).get(projectId, attemptId);
    if (!row) return fail("NOT_FOUND");
    const record = row as unknown as JournalRecord;
    if (!boundedId(record.attemptId) || !boundedId(record.projectId) || !boundedId(record.issueId) || !boundedId(record.idempotencyKey) || !Number.isSafeInteger(record.projectRevision) || record.projectRevision < 1 || typeof record.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.requestDigest) || !["prepared", "dispatching", "running", "verifying", "outcome_unknown", "settled"].includes(record.phase) || !(record.outcome === null || ["interrupted", "failed", "verification_finished", "reconciled_unknown"].includes(record.outcome)) || (record.phase === "settled") !== (record.outcome !== null) || (record.threadId === null) !== (record.turnId === null) || record.threadId !== null && (!protocolId(record.threadId) || !protocolId(record.turnId)) || ["running", "verifying"].includes(record.phase) && record.threadId === null || ["prepared", "dispatching"].includes(record.phase) && record.threadId !== null) return fail("CORRUPT_RECORD");
    if (record.outcome === "reconciled_unknown") {
      const reconciliation = this.db.prepare("SELECT reason,recorded_at FROM issue_dispatch_reconciliation WHERE attempt_id=?").get(record.attemptId);
      if (!reconciliation || typeof reconciliation.reason !== "string" || !reconciliation.reason.trim() || reconciliation.reason.length > 2000 || reconciliation.reason.includes("\0") || typeof reconciliation.recorded_at !== "string" || !Number.isFinite(Date.parse(reconciliation.recorded_at))) return fail("CORRUPT_RECORD");
    }
    return record;
  }

  get(projectId: string, attemptId: string): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId)) return fail("INVALID_INPUT");
    return this.read(projectId, attemptId);
  }

  /** Read a bounded, project-scoped page without exposing request or runtime identifiers. */
  history(projectId: string, afterId: string | null = null, limit = 32): JournalHistoryPage {
    if (!boundedId(projectId) || afterId !== null && !boundedId(afterId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) return fail("INVALID_INPUT");
    const rows = this.db.prepare(`SELECT attempt_id AS attemptId
      FROM issue_dispatch_journal WHERE project_id=? AND (? IS NULL OR attempt_id>?) ORDER BY attempt_id LIMIT ?`)
      .all(projectId, afterId, afterId, limit + 1) as unknown as { attemptId: string }[];
    const items = rows.slice(0, limit).map(row => {
      if (!boundedId(row.attemptId)) return fail("CORRUPT_RECORD");
      const record = this.read(projectId, row.attemptId);
      const approvals: JournalApprovalCounts = { pending: 0, responding: 0, sent: 0, outcome_unknown: 0, expired: 0 };
      for (const count of this.db.prepare("SELECT state,count(*) AS n FROM issue_approval_journal WHERE attempt_id=? GROUP BY state").all(record.attemptId)) {
        if (typeof count.state !== "string" || !Object.hasOwn(approvals, count.state) || !Number.isSafeInteger(count.n) || Number(count.n) < 0 || Number(count.n) > 1024) return fail("CORRUPT_RECORD");
        approvals[count.state as keyof JournalApprovalCounts] = Number(count.n);
      }
      if (Object.values(approvals).reduce((sum, count) => sum + count, 0) > 1024) return fail("CORRUPT_RECORD");
      return { attemptId: record.attemptId, issueId: record.issueId, projectRevision: record.projectRevision, phase: record.phase, outcome: record.outcome, hasRuntimeReference: record.threadId !== null, approvals };
    });
    return { items, nextAfterId: rows.length > limit ? items[items.length - 1].attemptId : null };
  }

  /** The digest must be computed by trusted server code from the frozen request. */
  prepare(identity: Identity): { record: JournalRecord; created: boolean } {
    if (!identity || typeof identity !== "object" || Object.keys(identity).some(key => !["projectId", "issueId", "idempotencyKey", "projectRevision", "requestDigest"].includes(key)) || !boundedId(identity.projectId) || !boundedId(identity.issueId) || !boundedId(identity.idempotencyKey) || !Number.isSafeInteger(identity.projectRevision) || identity.projectRevision < 1 || typeof identity.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(identity.requestDigest)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const found = this.db.prepare("SELECT attempt_id AS attemptId FROM issue_dispatch_journal WHERE project_id=? AND idempotency_key=?").get(identity.projectId, identity.idempotencyKey);
      if (found) {
        const record = this.read(identity.projectId, String(found.attemptId));
        if (record.issueId !== identity.issueId || record.projectRevision !== identity.projectRevision || record.requestDigest !== identity.requestDigest) return fail("IDEMPOTENCY_CONFLICT");
        return { record, created: false };
      }
      if (this.db.prepare("SELECT 1 FROM issue_dispatch_journal WHERE project_id=? AND phase IN ('prepared','dispatching','running','verifying','outcome_unknown')").get(identity.projectId)) return fail("PROJECT_BUSY");
      const attemptId = `attempt_${randomUUID()}`;
      this.db.prepare("INSERT INTO issue_dispatch_journal(attempt_id,project_id,idempotency_key,issue_id,project_revision,request_digest,phase) VALUES(?,?,?,?,?,?,'prepared')")
        .run(attemptId, identity.projectId, identity.idempotencyKey, identity.issueId, identity.projectRevision, identity.requestDigest);
      return { record: this.read(identity.projectId, attemptId), created: true };
    });
  }

  /** Persist this transition before sending the external turn request. */
  beginDispatch(projectId: string, attemptId: string): JournalRecord {
    return this.transition(projectId, attemptId, "prepared", "dispatching");
  }

  /** The trusted caller must correlate these IDs to a real turn-start event. */
  markRunning(projectId: string, attemptId: string, threadId: string, turnId: string): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId) || !protocolId(threadId) || !protocolId(turnId)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (record.phase !== "dispatching") return fail("INVALID_TRANSITION");
      this.db.prepare("UPDATE issue_dispatch_journal SET phase='running',thread_id=?,turn_id=? WHERE project_id=? AND attempt_id=?").run(threadId, turnId, projectId, attemptId);
      return this.read(projectId, attemptId);
    });
  }

  /** After confirmed turn termination, record verification before starting it; the attempt stays open. */
  beginVerification(projectId: string, attemptId: string): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (record.phase !== "running" || this.hasUnresolvedApproval(attemptId)) return fail("INVALID_TRANSITION");
      this.db.prepare("UPDATE issue_dispatch_journal SET phase='verifying' WHERE project_id=? AND attempt_id=?").run(projectId, attemptId);
      return this.read(projectId, attemptId);
    });
  }

  private hasUnresolvedApproval(attemptId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM issue_approval_journal WHERE attempt_id=? AND state IN ('pending','responding','outcome_unknown') LIMIT 1").get(attemptId));
  }
  private invalidateApprovals(attemptId: string): void {
    this.db.prepare("UPDATE issue_approval_journal SET state='expired' WHERE attempt_id=? AND state='pending'").run(attemptId);
    this.db.prepare("UPDATE issue_approval_journal SET state='outcome_unknown' WHERE attempt_id=? AND state='responding'").run(attemptId);
  }

  /** A lost dispatch/termination response blocks new attempts until reconciled. */
  markOutcomeUnknown(projectId: string, attemptId: string): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (record.phase !== "dispatching" && record.phase !== "running" && record.phase !== "verifying") return fail("INVALID_TRANSITION");
      this.db.prepare("UPDATE issue_dispatch_journal SET phase='outcome_unknown' WHERE project_id=? AND attempt_id=?").run(projectId, attemptId);
      this.invalidateApprovals(attemptId);
      return this.read(projectId, attemptId);
    });
  }

  /** Trusted caller must verify exclusive ownership, confirmed runtime termination,
   * current project access and explicit user review. This records uncertainty;
   * it does not establish whether the operation succeeded or authorize a retry. */
  reconcileUnknown(projectId: string, attemptId: string, reason: string, mayReconcile: () => boolean): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId) || typeof reason !== "string" || !reason.trim() || reason.length > 2000 || reason.includes("\0") || typeof mayReconcile !== "function") return fail("INVALID_INPUT");
    const allowed = () => { try { return mayReconcile() === true; } catch { return false; } };
    if (!allowed()) return fail("INVALID_TRANSITION");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (record.phase !== "outcome_unknown" || !allowed()) return fail("INVALID_TRANSITION");
      this.db.prepare("INSERT INTO issue_dispatch_reconciliation(attempt_id,reason,recorded_at) VALUES(?,?,?)").run(attemptId, reason, new Date().toISOString());
      if (!allowed()) return fail("INVALID_TRANSITION");
      this.db.prepare("UPDATE issue_dispatch_journal SET phase='settled',outcome='reconciled_unknown' WHERE project_id=? AND attempt_id=?").run(projectId, attemptId);
      return this.read(projectId, attemptId);
    });
  }

  /** Call only after no dispatch was sent or actual termination is confirmed. */
  settle(projectId: string, attemptId: string, outcome: "interrupted" | "failed" | "verification_finished"): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId) || !["interrupted", "failed", "verification_finished"].includes(outcome)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (!["prepared", "dispatching", "running", "verifying"].includes(record.phase) || outcome === "verification_finished" && record.phase !== "verifying" || record.phase === "prepared" && outcome !== "interrupted" || this.hasUnresolvedApproval(attemptId)) return fail("INVALID_TRANSITION");
      this.db.prepare("UPDATE issue_dispatch_journal SET phase='settled',outcome=? WHERE project_id=? AND attempt_id=?").run(outcome, projectId, attemptId);
      return this.read(projectId, attemptId);
    });
  }

  private transition(projectId: string, attemptId: string, from: JournalRecord["phase"], to: JournalRecord["phase"]): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (record.phase !== from) return fail("INVALID_TRANSITION");
      this.db.prepare("UPDATE issue_dispatch_journal SET phase=? WHERE project_id=? AND attempt_id=?").run(to, projectId, attemptId);
      return this.read(projectId, attemptId);
    });
  }

  /** The caller must independently verify exclusive ownership and termination
   * of the previous runtime. A boolean callback is a guard, not that proof. */
  recoverAfterRestart(canRecover: () => boolean): { interrupted: number; unknown: number } {
    const allowed = () => { try { return typeof canRecover === "function" && canRecover() === true; } catch { return false; } };
    if (!allowed()) return fail("INVALID_TRANSITION");
    return this.transaction(() => {
      if (!allowed()) return fail("INVALID_TRANSITION");
      // Check every record before rewriting any of them; recovery must
      // not conceal inconsistent identities or partially recover a corrupt DB.
      for (const row of this.db.prepare("SELECT project_id,attempt_id FROM issue_dispatch_journal").iterate()) {
        this.read(String(row.project_id), String(row.attempt_id));
      }
      const interrupted = this.db.prepare("UPDATE issue_dispatch_journal SET phase='settled',outcome='interrupted' WHERE phase='prepared'").run().changes;
      const unknown = this.db.prepare("UPDATE issue_dispatch_journal SET phase='outcome_unknown' WHERE phase IN ('dispatching','running','verifying')").run().changes;
      this.db.prepare("UPDATE issue_approval_journal SET state='expired' WHERE state='pending' AND attempt_id IN (SELECT attempt_id FROM issue_dispatch_journal WHERE phase='outcome_unknown')").run();
      this.db.prepare("UPDATE issue_approval_journal SET state='outcome_unknown' WHERE state='responding' AND attempt_id IN (SELECT attempt_id FROM issue_dispatch_journal WHERE phase='outcome_unknown')").run();
      if (!allowed()) return fail("INVALID_TRANSITION");
      return { interrupted: Number(interrupted), unknown: Number(unknown) };
    });
  }
}
