import { afterEach, describe, expect, it } from "vitest";
import { link, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IssueStore } from "./store.js";
import { PlanningDraft } from "./planning-draft.js";

const scratch = path.resolve(".cache");
const roots: string[] = [], stores: IssueStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) {
    expect(path.dirname(await realpath(root))).toBe(await realpath(scratch));
    await rm(root, { recursive: true, force: true });
  }
});
async function setup() {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "issues-store-")); roots.push(root);
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  const store = await IssueStore.open(root); stores.push(store);
  const project = await store.createProject(workspace);
  return { root, workspace, store, project };
}
function document(suffix: string, options: { status?: string; criteria?: string[]; issueId?: string } = {}) {
  const data = { format: "auto-codex-issues", formatVersion: 1, documentId: `doc-${suffix}`, revision: 1,
    sources: [{ id: `src-${suffix}`, name: "fixture", contentHash: `sha256:${"a".repeat(64)}` }],
    categories: [{ id: `cat-${suffix}`, parentId: null, title: "기능", order: 0 }],
    requirements: [{ id: `req-${suffix}`, categoryId: `cat-${suffix}`, text: "조건", origin: "source", sourceId: `src-${suffix}` }],
    issues: [{ id: options.issueId || `issue-${suffix}`, categoryId: `cat-${suffix}`, requirementIds: [`req-${suffix}`], version: "1.0.0", order: 0, title: "작업", description: "설명", acceptanceCriteria: options.criteria ?? ["검증"], dependencyIds: [], status: options.status || "ready" }] };
  return new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\`\n`);
}

describe("issue storage", () => {
  it("persists a validated draft across restart, rejects competing writes and marks old project revisions stale", async () => {
    const t = await setup();
    const draft = new PlanningDraft({ format: "auto-codex-issues", formatVersion: 1, documentId: "draft-doc", revision: 1, sources: [], categories: [], requirements: [{ id: "draft-req", categoryId: null, text: "요구", origin: "user" }], issues: [{ id: "draft-issue", categoryId: null, requirementIds: ["draft-req"], version: "1.0.0", order: 0, title: "작업", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] }, 1);
    draft.review(1, { requirementId: "draft-req", issueId: "draft-issue", decision: "deferred", reason: "확인 필요" });
    expect(await t.store.savePlanningDraft(t.project.id, 1, 0, draft.read())).toBe(1);
    await expect(t.store.savePlanningDraft(t.project.id, 1, 0, draft.read())).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const reopened = await IssueStore.open(t.root); stores.push(reopened);
    expect(await reopened.readPlanningDraft(t.project.id, 1)).toMatchObject({ generation: 1, stale: false, snapshot: { reviews: [{ reason: "확인 필요" }] } });
    await reopened.importDocument(t.project.id, 1, document("other"));
    expect(await reopened.readPlanningDraft(t.project.id, 2)).toMatchObject({ generation: 1, stale: true });
    await expect(reopened.savePlanningDraft(t.project.id, 2, 1, draft.read())).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("backs up a v4 database before installing the draft table", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("legacy"));
    t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const root = path.join(t.root, ".local-data", "issues"), filename = path.join(root, "issues.sqlite"), legacy = new DatabaseSync(filename);
    try { legacy.exec("DROP TABLE planning_drafts; PRAGMA user_version=4;"); } finally { legacy.close(); }
    const migrated = await IssueStore.open(t.root); stores.push(migrated);
    expect((await migrated.readDocument(t.project.id, "doc-legacy")).document.documentId).toBe("doc-legacy");
    const backups = (await readdir(root)).filter(name => /^issues-v4-backup-.*\.sqlite$/.test(name)); expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
    try { expect(backup.prepare("PRAGMA user_version").get()?.user_version).toBe(4); expect(backup.prepare("SELECT count(*) AS n FROM documents").get()?.n).toBe(1); } finally { backup.close(); }
  });
  it("rejects modified draft bytes without returning their contents", async () => {
    const t = await setup(), draft = new PlanningDraft({ format: "auto-codex-issues", formatVersion: 1, documentId: "draft-doc", revision: 1, sources: [], categories: [], requirements: [], issues: [] }, 1);
    await t.store.savePlanningDraft(t.project.id, 1, 0, draft.read());
    const db = new DatabaseSync(path.join(t.root, ".local-data", "issues", "issues.sqlite"));
    try { db.prepare("UPDATE planning_drafts SET json=? WHERE project_id=?").run("tampered", t.project.id); } finally { db.close(); }
    await expect(t.store.readPlanningDraft(t.project.id, 1)).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    await expect(t.store.savePlanningDraft(t.project.id, 1, 1, draft.read())).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });
  it("reads only the selected project's journal at the requested revision", async () => {
    const t = await setup();
    const db = new DatabaseSync(path.join(t.root, ".local-data", "issues", "issues.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO issue_dispatch_journal(attempt_id,project_id,idempotency_key,issue_id,project_revision,request_digest,phase) VALUES(?,?,?,?,?,?,?)");
      insert.run("attempt-a", t.project.id, "key-a", "issue-a", 1, "a".repeat(64), "prepared");
      insert.run("attempt-b", "project-other", "key-b", "issue-b", 1, "b".repeat(64), "prepared");
    } finally { db.close(); }
    expect(await t.store.executionHistory(t.project.id, 1)).toMatchObject({ items: [{ attemptId: "attempt-a", issueId: "issue-a", phase: "prepared" }], nextAfterId: null });
    await expect(t.store.executionHistory(t.project.id, 2)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(t.store.executionHistory("project-other", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("reads a compact document imported exactly at the exchange byte limit", async () => {
    const t = await setup();
    const doc = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-boundary", revision: 1, sources: [], categories: [], requirements: [], issues: Array.from({ length: 128 }, (_, index) => ({ id: `issue-${index}`, categoryId: null, requirementIds: [], version: "1.0.0", order: index, title: "x", description: index < 127 ? "x".repeat(32_768) : "", acceptanceCriteria: ["x"], dependencyIds: [], status: "ready" })) };
    const frame = () => new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(doc)}\n\`\`\``);
    const padding = 4 * 1024 * 1024 - frame().byteLength;
    expect(padding).toBeGreaterThanOrEqual(0); expect(padding).toBeLessThanOrEqual(32_768);
    doc.issues[127].description = "x".repeat(padding);
    const input = frame(); expect(input.byteLength).toBe(4 * 1024 * 1024);
    await t.store.importDocument(t.project.id, 1, input);
    expect((await t.store.readDocument(t.project.id, doc.documentId, 2)).document.issues).toHaveLength(128);
    expect(await t.store.importDocument(t.project.id, 2, input)).toMatchObject({ alreadyImported: true });
  });
  it("persists validated imports and separates imported completion from local review across restart", async () => {
    const t = await setup(), bytes = document("a", { status: "completed" });
    expect(await t.store.importDocument(t.project.id, 1, bytes)).toEqual({ documentId: "doc-a", revision: 2, alreadyImported: false, issueCount: 1 });
    expect(await t.store.importDocument(t.project.id, 1, bytes)).toEqual({ documentId: "doc-a", revision: 2, alreadyImported: true, issueCount: 1 });
    expect((await t.store.readDocument(t.project.id, "doc-a")).issues).toEqual([{ issueId: "issue-a", importedStatus: "completed", localStatus: "needs_review" }]);
    t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const reopened = await IssueStore.open(t.root); stores.push(reopened);
    expect(await reopened.readProject(t.project.id)).toEqual({ id: t.project.id, revision: 2 });
    expect((await reopened.readDocument(t.project.id, "doc-a")).document.documentId).toBe("doc-a");
    const db = new DatabaseSync(path.join(t.root, ".local-data", "issues", "issues.sqlite"), { readOnly: true });
    try { expect(db.prepare("SELECT original_bytes FROM documents WHERE id='doc-a'").get()?.original_bytes).toEqual(bytes); } finally { db.close(); }
  });
  it("backs up v1 before migrating, preserving its projects and documents", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("a"));
    t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const root = path.join(t.root, ".local-data", "issues"), filename = path.join(root, "issues.sqlite"), legacy = new DatabaseSync(filename);
    try { legacy.exec("DROP TABLE planning_drafts; DROP TABLE issue_approval_journal; DROP TABLE issue_dispatch_reconciliation; DROP TABLE issue_dispatch_journal; ALTER TABLE documents DROP COLUMN original_bytes; ALTER TABLE documents DROP COLUMN original_hash; PRAGMA user_version=1;"); } finally { legacy.close(); }
    const migrated = await IssueStore.open(t.root); stores.push(migrated);
    expect((await migrated.readDocument(t.project.id, "doc-a")).document.documentId).toBe("doc-a");
    expect((await migrated.readProject(t.project.id)).revision).toBe(2);
    const backups = (await readdir(root)).filter(name => /^issues-v1-backup-.*\.sqlite$/.test(name)); expect(backups).toHaveLength(1);
    const copy = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
    try { expect(copy.prepare("PRAGMA user_version").get()?.user_version).toBe(1); expect(copy.prepare("SELECT count(*) AS count FROM documents").get()?.count).toBe(1); } finally { copy.close(); }
  });
  it("backs up v2 and installs the journal without altering existing documents", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("a"));
    t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const root = path.join(t.root, ".local-data", "issues"), filename = path.join(root, "issues.sqlite"), legacy = new DatabaseSync(filename);
    try { legacy.exec("DROP TABLE planning_drafts; DROP TABLE issue_approval_journal; DROP TABLE issue_dispatch_reconciliation; DROP TABLE issue_dispatch_journal; PRAGMA user_version=2;"); } finally { legacy.close(); }
    const migrated = await IssueStore.open(t.root); stores.push(migrated);
    expect((await migrated.readDocument(t.project.id, "doc-a")).document.documentId).toBe("doc-a");
    const backups = (await readdir(root)).filter(name => /^issues-v2-backup-.*\.sqlite$/.test(name)); expect(backups).toHaveLength(1);
    const copy = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
    try { expect(copy.prepare("PRAGMA user_version").get()?.user_version).toBe(2); expect(copy.prepare("SELECT count(*) AS n FROM documents").get()?.n).toBe(1); } finally { copy.close(); }
    const current = new DatabaseSync(filename, { readOnly: true });
    try { expect(current.prepare("PRAGMA user_version").get()?.user_version).toBe(5); expect(current.prepare("SELECT count(*) AS n FROM issue_dispatch_journal").get()?.n).toBe(0); } finally { current.close(); }
  });
  it("rolls back a v2 migration if the journal schema collides", async () => {
    const t = await setup(); t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const root = path.join(t.root, ".local-data", "issues"), filename = path.join(root, "issues.sqlite"), legacy = new DatabaseSync(filename);
    try { legacy.exec("DROP TABLE issue_dispatch_reconciliation; PRAGMA user_version=2;"); } finally { legacy.close(); }
    await expect(IssueStore.open(t.root)).rejects.toThrow();
    const db = new DatabaseSync(filename, { readOnly: true });
    try { expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2); expect(db.prepare("SELECT count(*) AS n FROM projects").get()?.n).toBe(1); } finally { db.close(); }
    expect((await readdir(root)).filter(name => /^issues-v2-backup-.*\.sqlite$/.test(name))).toHaveLength(1);
  });
  it("backs up v3 and installs approval records while retaining dispatch history", async () => {
    const t = await setup(); t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const root = path.join(t.root, ".local-data", "issues"), filename = path.join(root, "issues.sqlite"), legacy = new DatabaseSync(filename);
    try {
      legacy.prepare("INSERT INTO issue_dispatch_journal(attempt_id,project_id,idempotency_key,issue_id,project_revision,request_digest,phase) VALUES(?,?,?,?,?,?,?)").run("attempt-a", t.project.id, "key-a", "issue-a", 1, "a".repeat(64), "prepared");
      legacy.exec("DROP TABLE planning_drafts; DROP TABLE issue_approval_journal; PRAGMA user_version=3;");
    } finally { legacy.close(); }
    const migrated = await IssueStore.open(t.root); stores.push(migrated);
    expect((await migrated.executionHistory(t.project.id, 1)).items).toMatchObject([{ attemptId: "attempt-a", phase: "prepared" }]);
    const backups = (await readdir(root)).filter(name => /^issues-v3-backup-.*\.sqlite$/.test(name)); expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
    try { expect(backup.prepare("PRAGMA user_version").get()?.user_version).toBe(3); expect(backup.prepare("SELECT count(*) AS n FROM issue_dispatch_journal").get()?.n).toBe(1); } finally { backup.close(); }
    const db = new DatabaseSync(filename, { readOnly: true });
    try { expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(5); expect(db.prepare("SELECT count(*) AS n FROM issue_approval_journal").get()?.n).toBe(0); } finally { db.close(); }
  });
  it("preserves the old version and backup when a malformed v1 database cannot migrate", async () => {
    const t = await setup(); t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const root = path.join(t.root, ".local-data", "issues"), filename = path.join(root, "issues.sqlite"), legacy = new DatabaseSync(filename);
    try { legacy.exec("DROP TABLE documents; PRAGMA user_version=1;"); } finally { legacy.close(); }
    await expect(IssueStore.open(t.root)).rejects.toThrow();
    const original = new DatabaseSync(filename, { readOnly: true });
    try { expect(original.prepare("PRAGMA user_version").get()?.user_version).toBe(1); expect(original.prepare("SELECT count(*) AS count FROM projects").get()?.count).toBe(1); } finally { original.close(); }
    expect((await readdir(root)).filter(name => /^issues-v1-backup-.*\.sqlite$/.test(name))).toHaveLength(1);
  });
  it("detects tampering with the private original document copy", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("a"));
    const db = new DatabaseSync(path.join(t.root, ".local-data", "issues", "issues.sqlite"));
    try { db.prepare("UPDATE documents SET original_bytes=? WHERE id='doc-a'").run(new Uint8Array([1, 2, 3])); } finally { db.close(); }
    await expect(t.store.readDocument(t.project.id, "doc-a")).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    await expect(t.store.importDocument(t.project.id, 2, document("a"))).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });
  it("rejects idempotent re-import when stored issue state or entity index is inconsistent", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("a", { status: "completed" }));
    const db = new DatabaseSync(path.join(t.root, ".local-data", "issues", "issues.sqlite"));
    try {
      db.prepare("UPDATE imported_issues SET local_status='ready' WHERE issue_id='issue-a'").run();
      await expect(t.store.importDocument(t.project.id, 2, document("a", { status: "completed" }))).rejects.toMatchObject({ code: "STORAGE_FAILED" });
      db.prepare("UPDATE imported_issues SET local_status='needs_review' WHERE issue_id='issue-a'").run();
      db.prepare("DELETE FROM entity_ids WHERE entity_id='issue-a'").run();
      await expect(t.store.importDocument(t.project.id, 2, document("a", { status: "completed" }))).rejects.toMatchObject({ code: "STORAGE_FAILED" });
      await expect(t.store.readDocument(t.project.id, "doc-a")).rejects.toMatchObject({ code: "STORAGE_FAILED" });
      expect((await t.store.readProject(t.project.id)).revision).toBe(2);
    } finally { db.close(); }
  });
  it("rejects a stored document revision inconsistent with its content", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("a"));
    const db = new DatabaseSync(path.join(t.root, ".local-data", "issues", "issues.sqlite"));
    try { db.prepare("UPDATE documents SET document_revision=2 WHERE id='doc-a'").run(); } finally { db.close(); }
    await expect(t.store.readDocument(t.project.id, "doc-a")).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    await expect(t.store.importDocument(t.project.id, 2, document("a"))).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });
  it("rolls back collisions, stale writes and invalid documents without changing the revision", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("a"));
    await expect(t.store.importDocument(t.project.id, 1, document("b"))).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(t.store.importDocument(t.project.id, 2, document("a", { status: "failed" }))).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(t.store.importDocument(t.project.id, 2, document("b", { issueId: "issue-a" }))).rejects.toMatchObject({ code: "ID_CONFLICT" });
    await expect(t.store.importDocument(t.project.id, 2, new TextEncoder().encode("invalid"))).rejects.toThrow();
    expect((await t.store.readProject(t.project.id)).revision).toBe(2);
    await expect(t.store.readDocument(t.project.id, "doc-b")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await t.store.importDocument(t.project.id, 2, document("b", { criteria: [] }))).toMatchObject({ revision: 3 });
    expect((await t.store.readDocument(t.project.id, "doc-b")).issues[0].localStatus).toBe("needs_review");
  });
  it("does not attach an existing record automatically after the directory is replaced", async () => {
    const t = await setup();
    expect(await t.store.lookupProject(t.workspace)).toEqual(t.project);
    await expect(t.store.createProject(t.workspace)).rejects.toMatchObject({ code: "BINDING_EXISTS" });
    await rename(t.workspace, `${t.workspace}-old`); await mkdir(t.workspace);
    await expect(t.store.lookupProject(t.workspace)).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
    await expect(t.store.readProject(t.project.id)).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
    await expect(t.store.importDocument(t.project.id, 1, document("a"))).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
    await expect(t.store.createProject(t.workspace)).rejects.toMatchObject({ code: "BINDING_EXISTS" });
  });
  it("does not create a binding during lookup of a different project", async () => {
    const t = await setup(), anotherPath = path.join(t.root, "unbound"); await mkdir(anotherPath);
    expect(await t.store.lookupProject(anotherPath)).toBeNull();
    expect((await t.store.createProject(anotherPath)).revision).toBe(1);
  });
  it("enforces project ownership and serializes competing revision writes", async () => {
    const t = await setup(), anotherPath = path.join(t.root, "other"); await mkdir(anotherPath);
    const another = await t.store.createProject(anotherPath);
    const otherConnection = await IssueStore.open(t.root); stores.push(otherConnection);
    const outcomes = await Promise.allSettled([t.store.importDocument(t.project.id, 1, document("a")), otherConnection.importDocument(t.project.id, 1, document("b"))]);
    expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(x => x.status === "rejected")).toHaveLength(1);
    const winner = outcomes.find(x => x.status === "fulfilled");
    if (!winner || winner.status !== "fulfilled") throw new Error("missing result");
    await expect(t.store.readDocument(another.id, winner.value.documentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not trust locally tampered status or accept completed as an imported local state", async () => {
    const t = await setup(); await t.store.importDocument(t.project.id, 1, document("a", { status: "completed" }));
    const db = new DatabaseSync(path.join(t.root, ".local-data", "issues", "issues.sqlite"));
    try {
      expect(() => db.prepare("UPDATE imported_issues SET local_status='completed'").run()).toThrow();
      db.prepare("UPDATE imported_issues SET local_status='ready'").run();
    } finally { db.close(); }
    await expect(t.store.readDocument(t.project.id, "doc-a")).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });
  it("rejects an import over the stored-document limit without changing the project", async () => {
    const t = await setup(); t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const limited = await IssueStore.open(t.root, { maxStoredBytes: 10 }); stores.push(limited);
    await expect(limited.importDocument(t.project.id, 1, document("a"))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await limited.readProject(t.project.id)).revision).toBe(1);
    await expect(limited.readDocument(t.project.id, "doc-a")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("pages documents in a project revision and rejects a stale cursor", async () => {
    const t = await setup();
    await t.store.importDocument(t.project.id, 1, document("b"));
    await t.store.importDocument(t.project.id, 2, document("a"));
    const first = await t.store.listDocuments(t.project.id, 3, 1);
    expect(first).toEqual({ revision: 3, documents: [{ id: "doc-a", documentRevision: 1, issueCount: 1 }], nextAfterId: "doc-a" });
    expect(await t.store.listDocuments(t.project.id, 3, 1, first.nextAfterId!)).toEqual({ revision: 3, documents: [{ id: "doc-b", documentRevision: 1, issueCount: 1 }], nextAfterId: null });
    await t.store.importDocument(t.project.id, 3, document("c"));
    await expect(t.store.listDocuments(t.project.id, 3, 1, first.nextAfterId!)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(t.store.listDocuments(t.project.id, 4, 101)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("rejects hardlinked SQLite sidecars before reading project state", async () => {
    const t = await setup(), outside = path.join(t.root, "outside.txt"); await writeFile(outside, "unrelated");
    await link(outside, path.join(t.root, ".local-data", "issues", "issues.sqlite-wal"));
    await expect(t.store.readProject(t.project.id)).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });
  it("refuses unknown newer database versions without modifying them", async () => {
    const t = await setup(); t.store.close(); stores.splice(stores.indexOf(t.store), 1);
    const filename = path.join(t.root, ".local-data", "issues", "issues.sqlite"), db = new DatabaseSync(filename);
    db.exec("PRAGMA user_version=99"); db.close();
    await expect(IssueStore.open(t.root)).rejects.toMatchObject({ code: "UNSUPPORTED_VERSION" });
    const verify = new DatabaseSync(filename, { readOnly: true });
    try { expect(verify.prepare("PRAGMA user_version").get()?.user_version).toBe(99); } finally { verify.close(); }
  });
});
