import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Migration fragment only: not installed by the bridge or on existing databases.
 * Integration must version and transactionally apply this schema after backup.
 */
export const EXECUTION_JOURNAL_SCHEMA = `
  CREATE TABLE issue_dispatch_journal (
    attempt_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    project_revision INTEGER NOT NULL CHECK(project_revision > 0),
    request_digest TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('prepared','dispatching','running','outcome_unknown','settled')),
    outcome TEXT CHECK(outcome IN ('interrupted','failed','verification_required')),
    thread_id TEXT,
    turn_id TEXT,
    UNIQUE(project_id,idempotency_key)
  );
  CREATE UNIQUE INDEX issue_dispatch_one_open ON issue_dispatch_journal(project_id)
    WHERE phase IN ('prepared','dispatching','running','outcome_unknown');
`;

type Identity = { projectId: string; issueId: string; idempotencyKey: string; projectRevision: number; requestDigest: string };
export type JournalRecord = Identity & { attemptId: string; phase: "prepared" | "dispatching" | "running" | "outcome_unknown" | "settled"; outcome: "interrupted" | "failed" | "verification_required" | null; threadId: string | null; turnId: string | null };
export type JournalHistoryEntry = Pick<JournalRecord, "attemptId" | "issueId" | "projectRevision" | "phase" | "outcome"> & { hasRuntimeReference: boolean };
export type JournalHistoryPage = { items: JournalHistoryEntry[]; nextAfterId: string | null };
type JournalCode = "INVALID_INPUT" | "IDEMPOTENCY_CONFLICT" | "PROJECT_BUSY" | "INVALID_TRANSITION" | "NOT_FOUND";
export class ExecutionJournalError extends Error {
  constructor(readonly code: JournalCode) { super(code); }
}
const fail = (code: JournalCode): never => { throw new ExecutionJournalError(code); };
const boundedId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const protocolId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024;

/**
 * Server-only primitive over a trusted, exclusively managed SQLite connection.
 * It does not authenticate callers, validate revisions/evidence, manage the
 * shared admission lock, start a turn, or itself establish SQLite durability.
 */
export class ExecutionJournal {
  constructor(private readonly db: DatabaseSync) {}

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private read(projectId: string, attemptId: string): JournalRecord {
    const row = this.db.prepare(`SELECT attempt_id AS attemptId, project_id AS projectId, issue_id AS issueId,
      idempotency_key AS idempotencyKey, project_revision AS projectRevision, request_digest AS requestDigest,
      phase, outcome, thread_id AS threadId, turn_id AS turnId FROM issue_dispatch_journal WHERE project_id=? AND attempt_id=?`).get(projectId, attemptId);
    if (!row) return fail("NOT_FOUND");
    return row as unknown as JournalRecord;
  }

  get(projectId: string, attemptId: string): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId)) return fail("INVALID_INPUT");
    return this.read(projectId, attemptId);
  }

  /** Read a bounded, project-scoped page without exposing request or runtime identifiers. */
  history(projectId: string, afterId: string | null = null, limit = 32): JournalHistoryPage {
    if (!boundedId(projectId) || afterId !== null && !boundedId(afterId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) return fail("INVALID_INPUT");
    const rows = this.db.prepare(`SELECT attempt_id AS attemptId, issue_id AS issueId, project_revision AS projectRevision,
      phase, outcome, CASE WHEN thread_id IS NOT NULL AND turn_id IS NOT NULL THEN 1 ELSE 0 END AS hasRuntimeReference
      FROM issue_dispatch_journal WHERE project_id=? AND (? IS NULL OR attempt_id>?) ORDER BY attempt_id LIMIT ?`)
      .all(projectId, afterId, afterId, limit + 1) as unknown as (Omit<JournalHistoryEntry, "hasRuntimeReference"> & { hasRuntimeReference: number })[];
    const items = rows.slice(0, limit).map(row => ({ attemptId: row.attemptId, issueId: row.issueId, projectRevision: row.projectRevision, phase: row.phase, outcome: row.outcome, hasRuntimeReference: row.hasRuntimeReference === 1 }));
    return { items, nextAfterId: rows.length > limit ? items[items.length - 1].attemptId : null };
  }

  /** The digest must be computed by trusted server code from the frozen request. */
  prepare(identity: Identity): { record: JournalRecord; created: boolean } {
    if (!identity || typeof identity !== "object" || !boundedId(identity.projectId) || !boundedId(identity.issueId) || !boundedId(identity.idempotencyKey) || !Number.isSafeInteger(identity.projectRevision) || identity.projectRevision < 1 || typeof identity.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(identity.requestDigest)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const found = this.db.prepare("SELECT attempt_id AS attemptId FROM issue_dispatch_journal WHERE project_id=? AND idempotency_key=?").get(identity.projectId, identity.idempotencyKey);
      if (found) {
        const record = this.read(identity.projectId, String(found.attemptId));
        if (record.issueId !== identity.issueId || record.projectRevision !== identity.projectRevision || record.requestDigest !== identity.requestDigest) return fail("IDEMPOTENCY_CONFLICT");
        return { record, created: false };
      }
      if (this.db.prepare("SELECT 1 FROM issue_dispatch_journal WHERE project_id=? AND phase IN ('prepared','dispatching','running','outcome_unknown')").get(identity.projectId)) return fail("PROJECT_BUSY");
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

  /** A lost dispatch/termination response blocks new attempts until reconciled. */
  markOutcomeUnknown(projectId: string, attemptId: string): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (record.phase !== "dispatching" && record.phase !== "running") return fail("INVALID_TRANSITION");
      this.db.prepare("UPDATE issue_dispatch_journal SET phase='outcome_unknown' WHERE project_id=? AND attempt_id=?").run(projectId, attemptId);
      return this.read(projectId, attemptId);
    });
  }

  /** Call only after no dispatch was sent or actual termination is confirmed. */
  settle(projectId: string, attemptId: string, outcome: "interrupted" | "failed" | "verification_required"): JournalRecord {
    if (!boundedId(projectId) || !boundedId(attemptId) || !["interrupted", "failed", "verification_required"].includes(outcome)) return fail("INVALID_INPUT");
    return this.transaction(() => {
      const record = this.read(projectId, attemptId);
      if (!["prepared", "dispatching", "running"].includes(record.phase)) return fail("INVALID_TRANSITION");
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

  /** Only after exclusive ownership and prior runtime termination are established. */
  recoverAfterRestart(): { interrupted: number; unknown: number } {
    return this.transaction(() => {
      const interrupted = this.db.prepare("UPDATE issue_dispatch_journal SET phase='settled',outcome='interrupted' WHERE phase='prepared'").run().changes;
      const unknown = this.db.prepare("UPDATE issue_dispatch_journal SET phase='outcome_unknown' WHERE phase IN ('dispatching','running')").run().changes;
      return { interrupted: Number(interrupted), unknown: Number(unknown) };
    });
  }
}
