import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXECUTION_JOURNAL_SCHEMA, ExecutionJournal } from "./execution-journal.js";

const selection = { projectId: "project-a", issueId: "issue-a", idempotencyKey: "request-a", projectRevision: 2, requestDigest: "a".repeat(64) };

describe("isolated issue dispatch journal", () => {
  it("lists bounded project-scoped history without exposing private correlation fields or releasing unknown attempts", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(EXECUTION_JOURNAL_SCHEMA); const journal = new ExecutionJournal(db), expectedIds: string[] = [];
      for (let index = 0; index < 40; index++) {
        const record = journal.prepare({ ...selection, issueId: `issue-${index}`, idempotencyKey: `request-${index}` }).record;
        expectedIds.push(record.attemptId);
        journal.settle(selection.projectId, record.attemptId, index % 2 ? "failed" : "verification_required");
      }
      const uncertain = journal.prepare({ ...selection, issueId: "uncertain", idempotencyKey: "request-uncertain" }).record;
      expectedIds.push(uncertain.attemptId); journal.beginDispatch(selection.projectId, uncertain.attemptId);
      journal.markRunning(selection.projectId, uncertain.attemptId, "synthetic-thread", "synthetic-turn"); journal.markOutcomeUnknown(selection.projectId, uncertain.attemptId);
      const other = journal.prepare({ ...selection, projectId: "project-b", issueId: "other-project" }).record;
      const first = journal.history(selection.projectId), second = journal.history(selection.projectId, first.nextAfterId);
      expect(first.items).toHaveLength(32); expect(first.nextAfterId).toBe(first.items.at(-1)?.attemptId); expect(second.items).toHaveLength(9); expect(second.nextAfterId).toBeNull();
      const items = [...first.items, ...second.items];
      expect(items.map(item => item.attemptId)).toEqual(expectedIds.sort());
      expect(items.find(item => item.attemptId === uncertain.attemptId)).toEqual({ attemptId: uncertain.attemptId, issueId: "uncertain", projectRevision: 2, phase: "outcome_unknown", outcome: null, hasRuntimeReference: true });
      expect(items.some(item => item.attemptId === other.attemptId || item.issueId === "other-project")).toBe(false);
      expect(JSON.stringify(items)).not.toContain("synthetic-thread"); expect(JSON.stringify(items)).not.toContain("synthetic-turn"); expect(JSON.stringify(items)).not.toContain(selection.requestDigest); expect(JSON.stringify(items)).not.toContain("request-");
      expect(journal.history("project-b").items).toMatchObject([{ attemptId: other.attemptId, issueId: "other-project", phase: "prepared", hasRuntimeReference: false }]);
      expect(journal.history("project-missing")).toEqual({ items: [], nextAfterId: null });
      expect(() => journal.prepare({ ...selection, idempotencyKey: "another" })).toThrow(expect.objectContaining({ code: "PROJECT_BUSY" }));
      expect(journal.get(selection.projectId, uncertain.attemptId).phase).toBe("outcome_unknown");
    } finally { db.close(); }
  });
  it("rejects malformed history cursors and limits without changing the journal", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(EXECUTION_JOURNAL_SCHEMA); const journal = new ExecutionJournal(db), record = journal.prepare(selection).record;
      for (const [projectId, afterId, limit] of [["../outside", null, 1], ["project-a", "../outside", 1], ["project-a", "", 1], ["project-a", null, 0], ["project-a", null, 33], ["project-a", null, 1.5]] as const) expect(() => journal.history(projectId, afterId, limit)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(journal.history(selection.projectId, null, 1)).toMatchObject({ items: [{ attemptId: record.attemptId, phase: "prepared", hasRuntimeReference: false }], nextAfterId: null });
      expect(journal.get(selection.projectId, record.attemptId).phase).toBe("prepared");
    } finally { db.close(); }
  });
  it("deduplicates a request, rejects changed payloads and reserves one attempt per project", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(EXECUTION_JOURNAL_SCHEMA);
      const journal = new ExecutionJournal(db), first = journal.prepare(selection);
      expect(first.created).toBe(true);
      expect(journal.prepare(selection)).toEqual({ record: first.record, created: false });
      for (const change of [{ issueId: "other" }, { projectRevision: 3 }, { requestDigest: "b".repeat(64) }]) expect(() => journal.prepare({ ...selection, ...change })).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
      expect(() => journal.prepare({ ...selection, idempotencyKey: "other" })).toThrow(expect.objectContaining({ code: "PROJECT_BUSY" }));
      expect(journal.prepare({ ...selection, projectId: "project-b" }).created).toBe(true);
    } finally { db.close(); }
  });

  it("requires the dispatch journal before running and never asserts issue completion", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(EXECUTION_JOURNAL_SCHEMA);
      const journal = new ExecutionJournal(db), { attemptId } = journal.prepare(selection).record;
      expect(() => journal.markRunning(selection.projectId, attemptId, "thread", "turn")).toThrow(expect.objectContaining({ code: "INVALID_TRANSITION" }));
      expect(journal.beginDispatch(selection.projectId, attemptId).phase).toBe("dispatching");
      expect(journal.markRunning(selection.projectId, attemptId, "thread", "turn")).toMatchObject({ phase: "running", threadId: "thread", turnId: "turn" });
      expect(journal.settle(selection.projectId, attemptId, "verification_required")).toMatchObject({ phase: "settled", outcome: "verification_required" });
      expect(() => journal.beginDispatch(selection.projectId, attemptId)).toThrow(expect.objectContaining({ code: "INVALID_TRANSITION" }));
      expect(journal.prepare({ ...selection, idempotencyKey: "request-b" }).created).toBe(true);
      expect(() => journal.get("project-b", attemptId)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    } finally { db.close(); }
  });

  it("persists and recovers uncertain dispatch without automatic replay or release", async () => {
    const base = path.resolve(".cache"); await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "issue-journal-test-")), filename = path.join(root, "journal.sqlite");
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(filename); db.exec("PRAGMA synchronous=FULL"); db.exec(EXECUTION_JOURNAL_SCHEMA);
      let journal = new ExecutionJournal(db);
      const sent = journal.prepare(selection).record;
      const competitor = new DatabaseSync(filename);
      try {
        const otherJournal = new ExecutionJournal(competitor);
        expect(otherJournal.prepare(selection)).toMatchObject({ created: false, record: { attemptId: sent.attemptId } });
        expect(() => otherJournal.prepare({ ...selection, idempotencyKey: "competing" })).toThrow(expect.objectContaining({ code: "PROJECT_BUSY" }));
        competitor.exec("BEGIN IMMEDIATE");
        try { expect(() => journal.prepare({ ...selection, projectId: "locked-project" })).toThrow(); }
        finally { competitor.exec("ROLLBACK"); }
      } finally { competitor.close(); }
      journal.beginDispatch(selection.projectId, sent.attemptId);
      const unsent = journal.prepare({ ...selection, projectId: "project-b" }).record;
      const running = journal.prepare({ ...selection, projectId: "project-c" }).record;
      journal.beginDispatch("project-c", running.attemptId);
      journal.markRunning("project-c", running.attemptId, "thread", "turn");
      db.close();
      db = new DatabaseSync(filename); db.exec("PRAGMA synchronous=FULL"); journal = new ExecutionJournal(db);
      expect(journal.recoverAfterRestart()).toEqual({ interrupted: 1, unknown: 2 });
      expect(journal.get("project-b", unsent.attemptId)).toMatchObject({ phase: "settled", outcome: "interrupted" });
      expect(journal.get("project-c", running.attemptId)).toMatchObject({ phase: "outcome_unknown", threadId: "thread", turnId: "turn" });
      expect(journal.get(selection.projectId, sent.attemptId)).toMatchObject({ phase: "outcome_unknown", outcome: null, threadId: null, turnId: null });
      expect(journal.prepare(selection)).toMatchObject({ created: false, record: { attemptId: sent.attemptId, phase: "outcome_unknown" } });
      expect(() => journal.prepare({ ...selection, idempotencyKey: "request-b" })).toThrow(expect.objectContaining({ code: "PROJECT_BUSY" }));
      expect(() => journal.settle(selection.projectId, sent.attemptId, "failed")).toThrow(expect.objectContaining({ code: "INVALID_TRANSITION" }));
      expect(journal.recoverAfterRestart()).toEqual({ interrupted: 0, unknown: 0 });
    } finally {
      db?.close();
      expect(path.dirname(await realpath(root))).toBe(await realpath(base));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid IDs, digests and revisions without reserving a project", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(EXECUTION_JOURNAL_SCHEMA); const journal = new ExecutionJournal(db);
      for (const identity of [{ ...selection, issueId: "../other" }, { ...selection, idempotencyKey: "" }, { ...selection, projectRevision: 0 }, { ...selection, requestDigest: "x" }]) expect(() => journal.prepare(identity)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(journal.prepare(selection).created).toBe(true);
    } finally { db.close(); }
  });
  it("keeps a live uncertain outcome reserved and never replays its key", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(EXECUTION_JOURNAL_SCHEMA); const journal = new ExecutionJournal(db), record = journal.prepare(selection).record;
      expect(() => journal.markOutcomeUnknown(selection.projectId, record.attemptId)).toThrow(expect.objectContaining({ code: "INVALID_TRANSITION" }));
      journal.beginDispatch(selection.projectId, record.attemptId);
      expect(journal.markOutcomeUnknown(selection.projectId, record.attemptId)).toMatchObject({ phase: "outcome_unknown", outcome: null });
      expect(journal.prepare(selection)).toMatchObject({ created: false, record: { phase: "outcome_unknown" } });
      expect(() => journal.prepare({ ...selection, idempotencyKey: "new" })).toThrow(expect.objectContaining({ code: "PROJECT_BUSY" }));
    } finally { db.close(); }
  });
});
