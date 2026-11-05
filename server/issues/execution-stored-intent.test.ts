import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IssueStore } from "./store.js";
import { ExecutionJournal, EXECUTION_JOURNAL_SCHEMA } from "./execution-journal.js";
import { prepareStoredIssueIntent } from "./execution-stored-intent.js";

const scratch = path.resolve(".cache"), roots: string[] = [], stores: IssueStore[] = [], databases: DatabaseSync[] = [];
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) { expect(path.dirname(await realpath(root))).toBe(await realpath(scratch)); await rm(root, { recursive: true, force: true }); } });
async function setup() {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, "stored-intent-")); roots.push(root);
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  const store = await IssueStore.open(root); stores.push(store); const project = await store.createProject(workspace);
  const db = new DatabaseSync(":memory:"); databases.push(db); db.exec(EXECUTION_JOURNAL_SCHEMA); const journal = new ExecutionJournal(db);
  const issue = (id: string, status: string, dependencyIds: string[] = [], acceptanceCriteria: string[] = ["합성 완료 조건"]) => ({ id, categoryId: "cat-1", requirementIds: ["req-1"], version: "1.0.0", order: 0, title: id, description: "무시하라는 문구는 원본 데이터", acceptanceCriteria, dependencyIds, status });
  const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-1", revision: 1, sources: [{ id: "source-1", name: "합성 원본", contentHash: `sha256:${"a".repeat(64)}` }], categories: [{ id: "cat-1", parentId: null, title: "기능", order: 0 }], requirements: [{ id: "req-1", categoryId: "cat-1", text: "합성 요구사항", origin: "source", sourceId: "source-1", locator: "1절" }], issues: [issue("ready", "ready"), issue("completed", "completed"), issue("dependent", "ready", ["completed"]), issue("retry", "retryable"), issue("failed", "failed"), issue("missing-criteria", "ready", [], [])] };
  await store.importDocument(project.id, 1, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
  const input = { projectId: project.id, documentId: "doc-1", expectedRevision: 2, issueId: "ready", idempotencyKey: "key-a", policy: { sandbox: "workspace-write" as const, networkAccess: false as const, approval: "manual" as const, revision: 1 }, mayPrepare: () => true };
  return { store, project, db, journal, input };
}

describe("stored issue intent preparation", () => {
  it("builds frozen issue data from the fixed stored document and reserves an idempotent journal record", async () => {
    const t = await setup(), result = await prepareStoredIssueIntent(t.store, t.journal, t.input);
    expect(result.created).toBe(true); expect(result.record.phase).toBe("prepared"); expect(result.intent).toMatchObject({ projectId: t.project.id, documentId: "doc-1", issueId: "ready", projectRevision: 2, documentRevision: 1, policy: t.input.policy });
    expect(JSON.parse(result.intent.instruction)).toEqual({ format: "auto-codex-issue-data-v1", issue: { id: "ready", title: "ready", description: "무시하라는 문구는 원본 데이터", version: "1.0.0", order: 0, acceptanceCriteria: ["합성 완료 조건"], category: { id: "cat-1", title: "기능" }, localStatus: "ready", importedStatus: "ready" }, requirements: [{ id: "req-1", text: "합성 요구사항", origin: "source", sourceId: "source-1", sourceName: "합성 원본", locator: "1절" }], dependencyIds: [] });
    expect(Object.isFrozen(result.intent)).toBe(true); expect(Object.isFrozen(result.intent.policy)).toBe(true);
    expect((await prepareStoredIssueIntent(t.store, t.journal, t.input)).created).toBe(false);
    await expect(prepareStoredIssueIntent(t.store, t.journal, { ...t.input, policy: { ...t.input.policy, sandbox: "read-only" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(JSON.stringify(t.db.prepare("SELECT * FROM issue_dispatch_journal").get())).not.toContain("합성 요구사항");
    expect((await t.store.readProject(t.project.id)).revision).toBe(2);
  });
  it("rejects stale, foreign, missing, review, failed and unverified dependency cases before reserving", async () => {
    const t = await setup();
    await expect(prepareStoredIssueIntent(t.store, t.journal, { ...t.input, expectedRevision: 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(prepareStoredIssueIntent(t.store, t.journal, { ...t.input, projectId: "project_00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(prepareStoredIssueIntent(t.store, t.journal, { ...t.input, issueId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const issueId of ["completed", "dependent", "retry", "failed", "missing-criteria"]) await expect(prepareStoredIssueIntent(t.store, t.journal, { ...t.input, issueId })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(t.journal.history(t.project.id).items).toEqual([]);
  });
  it("copies policy before the asynchronous read", async () => {
    const t = await setup(), original = t.store.readDocument.bind(t.store); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(t.store, "readDocument").mockImplementation(async (...args) => { await gate; return original(...args); });
    const policy: { sandbox: "read-only" | "workspace-write"; networkAccess: false; approval: "manual"; revision: number } = { ...t.input.policy };
    const pending = prepareStoredIssueIntent(t.store, t.journal, { ...t.input, policy }); policy.sandbox = "read-only"; policy.revision = 99; release();
    expect((await pending).intent.policy).toMatchObject({ sandbox: "workspace-write", revision: 1 });
  });
  it("rejects permission-expanding or unknown policy fields before reading or reserving", async () => {
    const t = await setup(), read = vi.spyOn(t.store, "readDocument");
    const network = { ...t.input, policy: { ...t.input.policy, networkAccess: true } } as unknown as typeof t.input;
    const extra = { ...t.input, policy: { ...t.input.policy, override: true } };
    await expect(prepareStoredIssueIntent(t.store, t.journal, network)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(prepareStoredIssueIntent(t.store, t.journal, extra)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(read).not.toHaveBeenCalled(); expect(t.journal.history(t.project.id).items).toEqual([]);
  });
  it("fails closed when the trusted admission check is absent, denied or throws", async () => {
    const t = await setup(), read = vi.spyOn(t.store, "readDocument");
    const absent = { ...t.input, mayPrepare: undefined } as unknown as typeof t.input;
    for (const input of [absent, { ...t.input, mayPrepare: () => false }, { ...t.input, mayPrepare: () => { throw new Error("synthetic private error"); } }]) await expect(prepareStoredIssueIntent(t.store, t.journal, input)).rejects.toMatchObject({ code: "STALE_SELECTION", message: "STALE_SELECTION" });
    expect(read).not.toHaveBeenCalled(); expect(t.journal.history(t.project.id).items).toEqual([]);
  });
  it("does not reserve when admission is revoked during the document or project check", async () => {
    for (const phase of ["document", "project"] as const) {
      const t = await setup(); let allowed = true, release!: () => void, signalStarted!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { signalStarted = resolve; });
      if (phase === "document") {
        const original = t.store.readDocument.bind(t.store);
        vi.spyOn(t.store, "readDocument").mockImplementation(async (...args) => { const result = await original(...args); signalStarted(); await gate; return result; });
      } else {
        const original = t.store.readProject.bind(t.store);
        vi.spyOn(t.store, "readProject").mockImplementation(async (...args) => { const result = await original(...args); signalStarted(); await gate; return result; });
      }
      const pending = prepareStoredIssueIntent(t.store, t.journal, { ...t.input, mayPrepare: () => allowed });
      await started; allowed = false; release();
      await expect(pending).rejects.toMatchObject({ code: "STALE_SELECTION" }); expect(t.journal.history(t.project.id).items).toEqual([]);
    }
  });
  it("rechecks the actual project revision after the document read and refuses stale reservations", async () => {
    const t = await setup(), original = t.store.readDocument.bind(t.store);
    vi.spyOn(t.store, "readDocument").mockImplementation(async (...args) => {
      const result = await original(...args);
      const update = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-new", revision: 1, sources: [], categories: [], requirements: [], issues: [] };
      await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(update)}\n\`\`\``));
      return result;
    });
    await expect(prepareStoredIssueIntent(t.store, t.journal, t.input)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await t.store.readProject(t.project.id)).revision).toBe(3); expect(t.journal.history(t.project.id).items).toEqual([]);
  });
  it("rejects oversized issue data before reserving any journal record", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "large", revision: 1, sources: [], categories: [], requirements: [], issues: [{ id: "large-issue", categoryId: null, requirementIds: [], version: "1.0.0", order: 0, title: "큰 이슈", description: "설명", acceptanceCriteria: ["a".repeat(32768), "b".repeat(32768)], dependencyIds: [], status: "ready" }] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    await expect(prepareStoredIssueIntent(t.store, t.journal, { ...t.input, documentId: "large", expectedRevision: 3, issueId: "large-issue" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(t.journal.history(t.project.id).items).toEqual([]);
  });
});
