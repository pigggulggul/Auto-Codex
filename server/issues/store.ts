import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { MAX_DOCUMENT_BYTES, parseIssueDocument, type IssueDocument } from "./document.js";

export type IssueStoreCode = "STORAGE_FAILED" | "UNSUPPORTED_VERSION" | "PATH_INVALID" | "PROJECT_CHANGED" | "BINDING_EXISTS" | "NOT_FOUND" | "VERSION_CONFLICT" | "DOCUMENT_CONFLICT" | "ID_CONFLICT" | "LIMIT_EXCEEDED";
export const MAX_STORED_DOCUMENT_BYTES = 256 * 1024 * 1024;
export class IssueStoreError extends Error {
  constructor(readonly code: IssueStoreCode, message: string) { super(message); }
}
const fail = (code: IssueStoreCode, message: string): never => { throw new IssueStoreError(code, message); };
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

type DirectoryIdentity = { path: string; dev: string; ino: string; birth: string };
type ProjectRow = { id: string; path: string; device: string; inode: string; birth: string; revision: number };
type ImportedIssue = { issueId: string; importedStatus: IssueDocument["issues"][number]["status"]; localStatus: Exclude<IssueDocument["issues"][number]["status"], "completed"> };

async function directoryIdentity(input: string): Promise<DirectoryIdentity> {
  try {
    const actual = await realpath(input);
    const before = await stat(actual, { bigint: true });
    if (!before.isDirectory() || before.dev === 0n || before.ino === 0n || before.birthtimeNs <= 0n) return fail("PATH_INVALID", "프로젝트 폴더의 실제 식별 정보를 확인할 수 없습니다.");
    const after = await stat(actual, { bigint: true });
    if (!samePath(actual, await realpath(input)) || before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs) return fail("PROJECT_CHANGED", "프로젝트 폴더가 확인 중 변경되었습니다.");
    return { path: actual, dev: String(before.dev), ino: String(before.ino), birth: String(before.birthtimeNs) };
  } catch (error) {
    if (error instanceof IssueStoreError) throw error;
    return fail("PATH_INVALID", "프로젝트 폴더를 확인할 수 없습니다.");
  }
}

/** Fixed app-owned namespace, never a renderer-supplied path or the selected project's storage. */
class IssuePaths {
  private constructor(readonly base: string, readonly root: string) {}
  static async open(appRoot: string): Promise<IssuePaths> {
    const base = await realpath(appRoot);
    for (const target of [path.join(base, ".local-data"), path.join(base, ".local-data", "issues")]) {
      try { await mkdir(target, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(target), target)) fail("STORAGE_FAILED", "이슈 저장 경로가 안전하지 않습니다.");
    }
    return new IssuePaths(base, path.join(base, ".local-data", "issues"));
  }
  async verify(): Promise<void> {
    for (const target of [this.base, path.join(this.base, ".local-data"), this.root]) {
      try {
        const info = await lstat(target);
        if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(target), target)) fail("STORAGE_FAILED", "이슈 저장 경로가 변경되었습니다.");
      } catch (error) { if (error instanceof IssueStoreError) throw error; fail("STORAGE_FAILED", "이슈 저장 경로를 확인할 수 없습니다."); }
    }
    for (const name of ["issues.sqlite", "issues.sqlite-journal", "issues.sqlite-wal", "issues.sqlite-shm"]) {
      const target = path.join(this.root, name);
      try {
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !samePath(await realpath(target), target)) fail("STORAGE_FAILED", "이슈 저장 파일이 안전하지 않습니다.");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
}

/** Internal storage API only. Callers must authenticate and authorize UI actions before using it. */
export class IssueStore {
  private constructor(private readonly paths: IssuePaths, private readonly db: DatabaseSync, private readonly maxStoredBytes: number) {}
  static async open(appRoot: string, options: { maxStoredBytes?: number } = {}): Promise<IssueStore> {
    const maxStoredBytes = options.maxStoredBytes ?? MAX_STORED_DOCUMENT_BYTES;
    if (!Number.isSafeInteger(maxStoredBytes) || maxStoredBytes < 1 || maxStoredBytes > MAX_STORED_DOCUMENT_BYTES) fail("LIMIT_EXCEEDED", "저장량 제한이 올바르지 않습니다.");
    const paths = await IssuePaths.open(appRoot); await paths.verify();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(paths.root, "issues.sqlite"));
    try {
      const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
      if (![0, 1, 2].includes(version)) fail("UNSUPPORTED_VERSION", "지원하지 않는 이슈 저장소는 변경하지 않습니다.");
      if (version === 0) {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) fail("UNSUPPORTED_VERSION", "알 수 없는 이슈 저장소는 변경하지 않습니다.");
        db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE projects(id TEXT PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, device TEXT NOT NULL, inode TEXT NOT NULL, birth TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1));
          CREATE TABLE documents(project_id TEXT NOT NULL, id TEXT NOT NULL, document_revision INTEGER NOT NULL, content_hash TEXT NOT NULL, json TEXT NOT NULL, original_bytes BLOB, original_hash TEXT, PRIMARY KEY(project_id,id), FOREIGN KEY(project_id) REFERENCES projects(id));
          CREATE TABLE entity_ids(project_id TEXT NOT NULL, entity_id TEXT NOT NULL, document_id TEXT NOT NULL, PRIMARY KEY(project_id,entity_id), FOREIGN KEY(project_id,document_id) REFERENCES documents(project_id,id));
          CREATE TABLE imported_issues(project_id TEXT NOT NULL, issue_id TEXT NOT NULL, document_id TEXT NOT NULL, imported_status TEXT NOT NULL CHECK(imported_status IN ('ready','retryable','failed','needs_review','completed')), local_status TEXT NOT NULL CHECK(local_status IN ('ready','retryable','failed','needs_review')), PRIMARY KEY(project_id,issue_id), FOREIGN KEY(project_id,document_id) REFERENCES documents(project_id,id));
          CREATE INDEX imported_issues_document ON imported_issues(project_id,document_id);
          PRAGMA user_version=2; COMMIT;`);
      }
      if (version === 1) {
        // A consistent SQLite copy is kept before changing an existing database.
        await paths.verify();
        const basename = `issues-v1-backup-${randomUUID()}`, pending = path.join(paths.root, `${basename}.pending`), backup = path.join(paths.root, `${basename}.sqlite`);
        const handle = await open(pending, "wx", 0o600); await handle.close();
        const before = await lstat(pending);
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !samePath(await realpath(pending), pending)) fail("STORAGE_FAILED", "백업 파일 경로가 안전하지 않습니다.");
        db.prepare("VACUUM INTO ?").run(pending);
        const after = await lstat(pending);
        if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || !samePath(await realpath(pending), pending)) fail("STORAGE_FAILED", "백업 파일 경로가 변경되었습니다.");
        await paths.verify();
        try { await lstat(backup); fail("STORAGE_FAILED", "백업 파일 이름이 이미 존재합니다."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await rename(pending, backup);
        await paths.verify();
        db.exec("BEGIN IMMEDIATE");
        try {
          const current = Number(db.prepare("PRAGMA user_version").get()?.user_version);
          if (current === 1) db.exec("ALTER TABLE documents ADD COLUMN original_bytes BLOB; ALTER TABLE documents ADD COLUMN original_hash TEXT; PRAGMA user_version=2;");
          else if (current !== 2) fail("UNSUPPORTED_VERSION", "이슈 저장소 버전이 변경되었습니다.");
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      }
      db.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;");
      await paths.verify();
      return new IssueStore(paths, db, maxStoredBytes);
    } catch (error) { db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  private project(id: string): ProjectRow {
    const row = this.db.prepare("SELECT id,path,device,inode,birth,revision FROM projects WHERE id=?").get(id);
    if (!row) return fail("NOT_FOUND", "이슈 프로젝트가 없습니다.");
    return row as unknown as ProjectRow;
  }
  private async checkedProject(id: string): Promise<ProjectRow> {
    await this.paths.verify();
    const project = this.project(id);
    let current: DirectoryIdentity;
    try { current = await directoryIdentity(project.path); }
    catch (error) { if (error instanceof IssueStoreError && error.code === "PATH_INVALID") return fail("PROJECT_CHANGED", "연결된 프로젝트 폴더가 없거나 식별할 수 없습니다."); throw error; }
    if (!samePath(current.path, project.path) || current.dev !== project.device || current.ino !== project.inode || current.birth !== project.birth) fail("PROJECT_CHANGED", "연결된 프로젝트 폴더가 변경되었습니다. 사용자 확인이 필요합니다.");
    await this.paths.verify();
    return project;
  }

  /** A trusted caller invokes this only after an explicit user selection; no implicit path rebinding. */
  async createProject(selectedPath: string): Promise<{ id: string; revision: number }> {
    await this.paths.verify(); const identity = await directoryIdentity(selectedPath); await this.paths.verify();
    const pathKey = process.platform === "win32" ? identity.path.toLowerCase() : identity.path;
    const existing = this.db.prepare("SELECT id FROM projects WHERE path_key=?").get(pathKey);
    if (existing) return fail("BINDING_EXISTS", "이 경로에 연결된 이슈 기록이 이미 있습니다. 기존 연결을 확인하세요.");
    const id = `project_${randomUUID()}`;
    try { this.db.prepare("INSERT INTO projects(id,path,path_key,device,inode,birth,revision) VALUES(?,?,?,?,?,?,1)").run(id, identity.path, pathKey, identity.dev, identity.ino, identity.birth); }
    catch (error) {
      if (this.db.prepare("SELECT id FROM projects WHERE path_key=?").get(pathKey)) return fail("BINDING_EXISTS", "이 경로에 연결된 이슈 기록이 이미 있습니다.");
      throw error;
    }
    return { id, revision: 1 };
  }

  async readProject(id: string): Promise<{ id: string; revision: number }> {
    const row = await this.checkedProject(id); return { id: row.id, revision: row.revision };
  }

  /** Lookup never creates or rebinds a project. selectedPath must come from the bridge's current selection. */
  async lookupProject(selectedPath: string): Promise<{ id: string; revision: number } | null> {
    await this.paths.verify();
    const selected = await directoryIdentity(selectedPath);
    const pathKey = process.platform === "win32" ? selected.path.toLowerCase() : selected.path;
    const row = this.db.prepare("SELECT id FROM projects WHERE path_key=?").get(pathKey);
    if (!row || typeof row.id !== "string") {
      const current = await directoryIdentity(selectedPath);
      if (!samePath(current.path, selected.path) || current.dev !== selected.dev || current.ino !== selected.ino || current.birth !== selected.birth) fail("PROJECT_CHANGED", "선택한 프로젝트 폴더가 변경되었습니다.");
      return null;
    }
    const project = await this.checkedProject(row.id);
    const current = await directoryIdentity(selectedPath);
    if (!samePath(current.path, selected.path) || current.dev !== selected.dev || current.ino !== selected.ino || current.birth !== selected.birth || !samePath(project.path, selected.path) || project.device !== selected.dev || project.inode !== selected.ino || project.birth !== selected.birth) fail("PROJECT_CHANGED", "선택한 프로젝트 폴더가 변경되었습니다.");
    return { id: project.id, revision: project.revision };
  }

  async listDocuments(projectId: string, expectedRevision: number, limit = 50, afterId = ""): Promise<{ revision: number; documents: { id: string; documentRevision: number; issueCount: number }[]; nextAfterId: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || afterId.length > 128 || afterId && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(afterId)) fail("LIMIT_EXCEEDED", "목록 페이지 또는 커서가 올바르지 않습니다.");
    await this.checkedProject(projectId);
    this.db.exec("BEGIN");
    try {
      const project = this.project(projectId);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== project.revision) fail("VERSION_CONFLICT", "목록을 불러오는 동안 프로젝트가 변경되었습니다.");
      const rows = this.db.prepare(`SELECT d.id,d.document_revision,(SELECT count(*) FROM imported_issues i WHERE i.project_id=d.project_id AND i.document_id=d.id) AS issue_count
        FROM documents d WHERE d.project_id=? AND d.id>? ORDER BY d.id LIMIT ?`).all(projectId, afterId, limit + 1);
      const more = rows.length > limit, page = rows.slice(0, limit);
      const documents = page.map(row => ({ id: String(row.id), documentRevision: Number(row.document_revision), issueCount: Number(row.issue_count) }));
      this.db.exec("COMMIT");
      return { revision: project.revision, documents, nextAfterId: more ? documents[documents.length - 1].id : null };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** Full validation precedes one transaction; the bytes are never executed or written to the project. */
  async importDocument(projectId: string, expectedRevision: number, bytes: Uint8Array): Promise<{ documentId: string; revision: number; alreadyImported: boolean; issueCount: number }> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DOCUMENT_BYTES) fail("LIMIT_EXCEEDED", "문서 크기 제한을 초과했습니다.");
    const original = Uint8Array.from(bytes);
    const document = parseIssueDocument(original);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("VERSION_CONFLICT", "프로젝트 revision이 올바르지 않습니다.");
    await this.checkedProject(projectId);
    const serialized = JSON.stringify(document), hash = createHash("sha256").update(serialized).digest("hex"), originalHash = createHash("sha256").update(original).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const project = this.project(projectId);
      const existing = this.db.prepare("SELECT content_hash,json FROM documents WHERE project_id=? AND id=?").get(projectId, document.documentId);
      if (existing) {
        if (existing.content_hash !== hash || existing.json !== serialized) fail("DOCUMENT_CONFLICT", "기존 문서와 내용이 달라 등록하지 않았습니다. 비교 기능은 준비 중입니다.");
        this.db.exec("COMMIT");
        return { documentId: document.documentId, revision: project.revision, alreadyImported: true, issueCount: document.issues.length };
      }
      if (project.revision !== expectedRevision) fail("VERSION_CONFLICT", "프로젝트가 변경되었습니다. 다시 확인하세요.");
      const ids = [document.documentId, ...document.sources.map(x => x.id), ...document.categories.map(x => x.id), ...document.requirements.map(x => x.id), ...document.issues.map(x => x.id)];
      const findId = this.db.prepare("SELECT entity_id FROM entity_ids WHERE project_id=? AND entity_id=?");
      for (const entityId of ids) if (findId.get(projectId, entityId)) fail("ID_CONFLICT", "다른 문서와 식별자가 충돌합니다.");
      const total = Number(this.db.prepare("SELECT COALESCE(SUM(length(CAST(json AS BLOB)) + COALESCE(length(original_bytes),0)),0) AS bytes FROM documents").get()?.bytes);
      if (!Number.isSafeInteger(total) || total + Buffer.byteLength(serialized) + original.byteLength > this.maxStoredBytes) fail("LIMIT_EXCEEDED", "이슈 문서 저장량 제한에 도달했습니다. 기존 문서를 보존했습니다.");
      this.db.prepare("INSERT INTO documents(project_id,id,document_revision,content_hash,json,original_bytes,original_hash) VALUES(?,?,?,?,?,?,?)").run(projectId, document.documentId, document.revision, hash, serialized, original, originalHash);
      const insertId = this.db.prepare("INSERT INTO entity_ids(project_id,entity_id,document_id) VALUES(?,?,?)");
      for (const entityId of ids) insertId.run(projectId, entityId, document.documentId);
      const insertIssue = this.db.prepare("INSERT INTO imported_issues(project_id,issue_id,document_id,imported_status,local_status) VALUES(?,?,?,?,?)");
      for (const issue of document.issues) {
        const localStatus = issue.status === "completed" || issue.acceptanceCriteria.length === 0 ? "needs_review" : issue.status;
        insertIssue.run(projectId, issue.id, document.documentId, issue.status, localStatus);
      }
      this.db.prepare("UPDATE projects SET revision=revision+1 WHERE id=?").run(projectId);
      this.db.exec("COMMIT");
      return { documentId: document.documentId, revision: project.revision + 1, alreadyImported: false, issueCount: document.issues.length };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  async readDocument(projectId: string, documentId: string, expectedRevision?: number): Promise<{ document: IssueDocument; issues: ImportedIssue[] }> {
    const project = await this.checkedProject(projectId);
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision !== project.revision)) fail("VERSION_CONFLICT", "이슈 목록이 변경되었습니다. 다시 불러오세요.");
    const row = this.db.prepare("SELECT json,content_hash,original_bytes,original_hash FROM documents WHERE project_id=? AND id=?").get(projectId, documentId);
    if (!row || typeof row.json !== "string" || typeof row.content_hash !== "string") return fail("NOT_FOUND", "이 프로젝트의 이슈 문서가 없습니다.");
    if (createHash("sha256").update(row.json).digest("hex") !== row.content_hash) return fail("STORAGE_FAILED", "저장된 이슈 문서가 변경되었습니다.");
    if (row.original_bytes !== null || row.original_hash !== null) {
      if (!(row.original_bytes instanceof Uint8Array) || typeof row.original_hash !== "string" || createHash("sha256").update(row.original_bytes).digest("hex") !== row.original_hash) return fail("STORAGE_FAILED", "저장된 문서 사본이 변경되었습니다.");
    }
    const document = parseIssueDocument(new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${row.json}\n\`\`\`\n`));
    const rows = this.db.prepare("SELECT issue_id,imported_status,local_status FROM imported_issues WHERE project_id=? AND document_id=? ORDER BY issue_id").all(projectId, documentId);
    const originals = new Map(document.issues.map(issue => [issue.id, issue]));
    if (rows.length !== originals.size || rows.some(row => {
      const original = originals.get(String(row.issue_id));
      return !original || row.imported_status !== original.status || !["ready", "retryable", "failed", "needs_review"].includes(String(row.local_status)) || (original.status === "completed" || original.acceptanceCriteria.length === 0) && row.local_status !== "needs_review";
    })) fail("STORAGE_FAILED", "저장된 이슈 상태와 문서의 연결이 다릅니다.");
    if (expectedRevision !== undefined && this.project(projectId).revision !== expectedRevision) fail("VERSION_CONFLICT", "이슈 목록이 변경되었습니다. 다시 불러오세요.");
    return { document, issues: rows.map(row => ({ issueId: String(row.issue_id), importedStatus: row.imported_status as ImportedIssue["importedStatus"], localStatus: row.local_status as ImportedIssue["localStatus"] })) };
  }
}
