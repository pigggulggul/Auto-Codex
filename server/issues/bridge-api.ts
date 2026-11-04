import type { IssueProjectSelection } from "./project-context.js";
import { IssueProjectContextError } from "./project-context.js";
import { IssueWorkerClientError } from "./worker-client.js";
import { SelectedDocumentError } from "./selected-document.js";
import { IssueExportError } from "./export-file.js";
import { AnalysisSourceError } from "./analysis-source.js";
import { IssueSourceSessions, SourceSessionError } from "./source-session.js";
import { AnalysisDraft } from "./analysis-draft.js";
import { AnalysisBatch } from "./analysis-batch.js";
import { validIssueFilters, validProjectIssueCursor, validProjectIssueFilters, type IssueViewQuery, type IssueViewResult } from "../../shared/issues/view.js";
import type { AnalysisFreshness, AnalysisSnapshotRequest, AnalysisSnapshotSummary, AnalysisSourceChunk, AnalysisSourceList } from "../../shared/issues/sources.js";
import { performance } from "node:perf_hooks";
import path from "node:path";

type Action = "status" | "bind" | "import" | "export" | "authorizeView" | "view" | "releaseView" | "sourceAdd" | "sourceList" | "sourceRead" | "sourceRemove" | "snapshotPrepare" | "snapshotCheck";
export type IssueProjectReply = { type: "issues.project.result"; v: 1; clientRequestId: string; action: Action; ok: true; bound: boolean; cancelled?: true; issueCount?: number; alreadyImported?: boolean; cleanupWarning?: boolean; view?: IssueViewResult; authorized?: boolean; authorizedForMs?: number; sources?: AnalysisSourceList; chunk?: AnalysisSourceChunk; snapshot?: AnalysisSnapshotSummary; freshness?: AnalysisFreshness } | { type: "issues.project.result"; v: 1; clientRequestId: string; action: Action; ok: false; error: { code: string; message: string } };
type Context = { status(): Promise<{ project: { id: string; revision: number } | null }>; bind(): Promise<{ project: { id: string; revision: number }; alreadyBound: boolean }>; importDocument(bytes: Uint8Array, mayStart: () => boolean): Promise<{ issueCount: number; alreadyImported: boolean }>; exportDocument(documentId: string, revision: number, mayStart: () => boolean): Promise<Uint8Array>; view(query: IssueViewQuery, mayStart: () => boolean): Promise<IssueViewResult> };
type Options = { selection(): IssueProjectSelection; context(): Context; pick(signal?: AbortSignal): Promise<string | null>; pickView(signal?: AbortSignal): Promise<string | null>; pickDocument(signal?: AbortSignal): Promise<string | null>; pickExport(projectPath: string, signal?: AbortSignal): Promise<string | null>; pickSource(projectPath: string, signal?: AbortSignal): Promise<string | null>; readSource(projectPath: string, target: string, signal?: AbortSignal): Promise<{ relativePath: string; bytes: number; sha256: string; text: string }>; readDocument(path: string, signal?: AbortSignal): Promise<Uint8Array>; writeExport(projectPath: string, target: string, bytes: Uint8Array, beforeCommit: () => Promise<void>, signal?: AbortSignal): Promise<{ cleanupWarning: boolean }>; tryAcquireWrite(): (() => void) | null; canonical(path: string): Promise<string>; busy(): boolean; now?(): number };
const equalPath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const safeError = (error: unknown) => error instanceof IssueProjectContextError || error instanceof IssueWorkerClientError || error instanceof SelectedDocumentError || error instanceof IssueExportError || error instanceof AnalysisSourceError || error instanceof SourceSessionError
  ? { code: error.code, message: error.message }
  : { code: "STORAGE_FAILED", message: "이슈 프로젝트를 확인하지 못했습니다. 폴더와 저장소 상태를 확인하세요." };
const id = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
function parseSnapshotRequest(message: Record<string, unknown>): AnalysisSnapshotRequest {
  if (!Number.isSafeInteger(message.expectedRevision) || Number(message.expectedRevision) < 1 || typeof message.instruction !== "string" || message.instruction.length > 1024 || Buffer.byteLength(message.instruction, "utf8") > 4096 || message.instruction.includes("\0") || !Array.isArray(message.expectedSources) || message.expectedSources.length < 1 || message.expectedSources.length > 16) throw new Error("invalid");
  const seen = new Set<string>();
  for (const item of message.expectedSources) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => key !== "id" && key !== "sha256") || typeof item.id !== "string" || !/^source_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.id) || seen.has(item.id) || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("invalid");
    seen.add(item.id);
  }
  return { expectedRevision: Number(message.expectedRevision), instruction: message.instruction, expectedSources: message.expectedSources as AnalysisSnapshotRequest["expectedSources"] };
}
function parseViewQuery(value: unknown): IssueViewQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  const q = value as Record<string, unknown>;
  const keys = (allowed: string[]) => { if (Object.keys(q).some(key => !allowed.includes(key))) throw new Error("invalid"); };
  const revision = () => Number.isSafeInteger(q.expectedRevision) && Number(q.expectedRevision) > 0;
  const offset = () => Number.isSafeInteger(q.offset) && Number(q.offset) >= 0;
  switch (q.kind) {
    case "documents": keys(["kind", "expectedRevision", "afterId"]); if (q.expectedRevision !== undefined && !revision() || q.afterId !== undefined && !id(q.afterId)) throw new Error("invalid"); break;
    case "issues": keys(["kind", "documentId", "expectedRevision", "offset", "filters"]); if (!id(q.documentId) || !revision() || !offset() || q.filters !== undefined && !validIssueFilters(q.filters)) throw new Error("invalid"); break;
    case "projectIssues": keys(["kind", "expectedRevision", "cursor", "filters"]); if (!revision() || !validProjectIssueCursor(q.cursor) || q.filters !== undefined && !validProjectIssueFilters(q.filters)) throw new Error("invalid"); break;
    case "categories": keys(["kind", "documentId", "expectedRevision", "parentId", "offset"]); if (!id(q.documentId) || !revision() || !offset() || !(q.parentId === null || id(q.parentId))) throw new Error("invalid"); break;
    case "diagnostics": keys(["kind", "documentId", "expectedRevision", "offset"]); if (!id(q.documentId) || !revision() || !offset()) throw new Error("invalid"); break;
    case "requirementDetail": keys(["kind", "documentId", "expectedRevision", "requirementId", "offset"]); if (!id(q.documentId) || !revision() || !id(q.requirementId) || !offset()) throw new Error("invalid"); break;
    case "detail": keys(["kind", "documentId", "expectedRevision", "issueId"]); if (!id(q.documentId) || !revision() || !id(q.issueId)) throw new Error("invalid"); break;
    case "criteria": case "requirements": case "dependencies": keys(["kind", "documentId", "expectedRevision", "issueId", "offset"]); if (!id(q.documentId) || !revision() || !id(q.issueId) || !offset()) throw new Error("invalid"); break;
    default: throw new Error("invalid");
  }
  return q as IssueViewQuery;
}

/** Binding requires a native selection of the current project. Origin is not an authentication credential. */
export class IssueBridgeApi {
  private pickerOpen = false;
  private checkingSources = false;
  private readonly views = new WeakMap<AbortSignal, { generation: number; path: string; expires: number }>();
  private readonly sources = new IssueSourceSessions(() => this.now());
  constructor(private readonly options: Options) {}
  private now(): number { return this.options.now?.() ?? performance.now(); }
  clearSources(): void { this.sources.clearAll(); }
  private activeView(signal: AbortSignal | undefined, connected: () => boolean) {
    if (!signal || signal.aborted || !connected()) { if (signal) this.sources.clear(signal); return null; }
    const grant = this.views.get(signal), current = this.options.selection();
    if (!grant || grant.expires <= this.now() || current.workspaceMode !== "project" || current.generation !== grant.generation || current.projectPath !== grant.path) { this.sources.clear(signal); return null; }
    return grant;
  }
  /**
   * Trusted runtime entry point, not a WebSocket operation. The runtime must acquire
   * shared admission and enforce tool isolation before using the returned batch.
   */
  async createAnalysisBatch(signal: AbortSignal, connected: () => boolean, admitted: () => boolean, snapshotId: string, revision: number): Promise<AnalysisBatch> {
    const grant = this.activeView(signal, connected);
    const stale = (): never => { throw new AnalysisSourceError("STALE_INPUT", "분석 입력 또는 실행 권한이 변경되었습니다. 다시 준비하세요."); };
    const valid = () => Boolean(grant && this.activeView(signal, connected) === grant && admitted());
    if (!grant || !valid()) return stale();
    const project = await this.options.context().status();
    if (!valid() || !project.project || project.project.revision !== revision) return stale();
    const projectId = project.project.id;
    const summary = this.sources.snapshotSummary(signal, grant.generation, grant.path, revision, snapshotId);
    const loadSegment = async (index: number) => {
      if (!valid()) return stale();
      const files = this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
      for (const file of files) {
        let current: Awaited<ReturnType<Options["readSource"]>>;
        try { current = await this.options.readSource(grant.path, path.resolve(grant.path, ...file.relativePath.split("/")), signal); }
        catch { return stale(); }
        if (!valid() || current.relativePath !== file.relativePath || current.bytes !== file.bytes || current.sha256 !== file.sha256) return stale();
        this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
      }
      const currentProject = await this.options.context().status();
      if (!valid() || !currentProject.project || currentProject.project.id !== projectId || currentProject.project.revision !== revision) return stale();
      return this.sources.analysisSegment(signal, grant.generation, grant.path, revision, snapshotId, index);
    };
    return new AnalysisBatch(new AnalysisDraft(snapshotId, revision, summary.totalSegments, loadSegment));
  }
  async handle(raw: string, uiOrigin: boolean, connected: () => boolean, signal?: AbortSignal): Promise<IssueProjectReply> {
    let clientRequestId = "", action: Action = "status";
    try {
      if (Buffer.byteLength(raw) > 16 * 1024) throw new IssueProjectContextError("WORKER_UNAVAILABLE", "이슈 요청 크기가 너무 큽니다.");
      const input: unknown = JSON.parse(raw);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid");
      const message = input as Record<string, unknown>;
      if (message.type === "issues.project.bind") action = "bind";
      if (message.type === "issues.document.import") action = "import";
      if (message.type === "issues.document.export") action = "export";
      if (message.type === "issues.view.authorize") action = "authorizeView";
      if (message.type === "issues.view.query") action = "view";
      if (message.type === "issues.view.release") action = "releaseView";
      if (message.type === "issues.sources.add") action = "sourceAdd";
      if (message.type === "issues.sources.list") action = "sourceList";
      if (message.type === "issues.sources.read") action = "sourceRead";
      if (message.type === "issues.sources.remove") action = "sourceRemove";
      if (message.type === "issues.analysis.prepare") action = "snapshotPrepare";
      if (message.type === "issues.analysis.check") action = "snapshotCheck";
      if (typeof message.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(message.clientRequestId)) clientRequestId = message.clientRequestId;
      if (!uiOrigin || !clientRequestId || message.v !== 1 || !["issues.project.status", "issues.project.bind", "issues.document.import", "issues.document.export", "issues.view.authorize", "issues.view.query", "issues.view.release", "issues.sources.add", "issues.sources.list", "issues.sources.read", "issues.sources.remove", "issues.analysis.prepare", "issues.analysis.check"].includes(String(message.type)) || Object.keys(message).some(key => !["type", "v", "clientRequestId", ...(action === "view" ? ["query"] : []), ...(action === "export" ? ["documentId", "expectedRevision"] : []), ...(["sourceRead", "sourceRemove"].includes(action) ? ["sourceId"] : []), ...(action === "sourceRead" ? ["offset"] : []), ...(action === "snapshotPrepare" ? ["expectedRevision", "expectedSources", "instruction"] : []), ...(action === "snapshotCheck" ? ["snapshotId", "expectedRevision"] : [])].includes(key))) throw new Error("invalid");
      if (action === "export" && (!id(message.documentId) || !Number.isSafeInteger(message.expectedRevision) || Number(message.expectedRevision) < 1)) throw new Error("invalid");
      if ((action === "sourceRead" || action === "sourceRemove") && (!id(message.sourceId) || !String(message.sourceId).startsWith("source_") || action === "sourceRead" && (!Number.isSafeInteger(message.offset) || Number(message.offset) < 0))) throw new Error("invalid");
      if (action === "snapshotCheck" && (typeof message.snapshotId !== "string" || !/^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(message.snapshotId) || !Number.isSafeInteger(message.expectedRevision) || Number(message.expectedRevision) < 1)) throw new Error("invalid");
      if (signal?.aborted || !connected()) throw new IssueProjectContextError("STALE_SELECTION", "연결이 끊겨 이슈 요청을 취소했습니다.");
      if (action === "status") return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: Boolean((await this.options.context().status()).project) };
      if (action === "releaseView") { if (signal) { this.views.delete(signal); this.sources.clear(signal); } return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, authorized: false }; }
      if (action === "sourceList" || action === "sourceRead" || action === "sourceRemove" || action === "snapshotPrepare" || action === "snapshotCheck") {
        const snapshotRequest = action === "snapshotPrepare" ? parseSnapshotRequest(message) : undefined;
        const grant = this.activeView(signal, connected);
        if (!grant || !signal) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "자료를 보려면 현재 프로젝트 폴더를 다시 확인하세요." } };
        let project: Awaited<ReturnType<Context["status"]>>;
        try { project = await this.options.context().status(); } catch (error) { this.sources.clear(signal); throw error; }
        if (!project.project || this.activeView(signal, connected) !== grant) { this.sources.clear(signal); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "프로젝트 또는 보기 권한이 변경되었습니다." } }; }
        if (snapshotRequest) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, snapshot: this.sources.prepare(signal, grant.generation, grant.path, project.project.revision, snapshotRequest) };
        if (action === "snapshotCheck") {
          const snapshotId = String(message.snapshotId), revision = Number(message.expectedRevision);
          if (project.project.revision !== revision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트가 변경되었습니다. 목록을 새로 불러오세요.");
          const sourceFiles = this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
          if (this.checkingSources || this.options.busy()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "다른 작업이 끝난 뒤 원본을 확인하세요." } };
          this.checkingSources = true;
          try {
            const files: AnalysisFreshness["files"] = [];
            for (const item of sourceFiles) {
              let state: AnalysisFreshness["files"][number]["state"];
              try {
                const source = await this.options.readSource(grant.path, path.resolve(grant.path, ...item.relativePath.split("/")), signal);
                state = source.relativePath === item.relativePath && source.bytes === item.bytes && source.sha256 === item.sha256 ? "unchanged" : "changed";
              } catch (error) { if (!(error instanceof AnalysisSourceError)) throw error; state = "unavailable"; }
              if (this.activeView(signal, connected) !== grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다.");
              if (this.options.busy()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "다른 작업이 시작되어 원본 확인을 중단했습니다." } };
              this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
              files.push({ id: item.id, state });
            }
            const after = await this.options.context().status();
            if (this.activeView(signal, connected) !== grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다.");
            if (!after.project || after.project.id !== project.project.id || after.project.revision !== revision || this.options.busy()) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 작업 상태가 변경되어 원본을 다시 확인해야 합니다.");
            this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
            return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, freshness: { snapshotId, projectRevision: revision, files } };
          } finally { this.checkingSources = false; }
        }
        if (action === "sourceRead") return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, chunk: this.sources.read(signal, grant.generation, grant.path, String(message.sourceId), Number(message.offset)) };
        const sources = action === "sourceRemove" ? this.sources.remove(signal, grant.generation, grant.path, String(message.sourceId)) : this.sources.list(signal, grant.generation, grant.path);
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, sources };
      }
      if (action === "view") {
        const query = parseViewQuery(message.query);
        const allowed = () => { if (!signal || signal.aborted || !connected()) return false; const grant = this.views.get(signal), now = this.options.selection(); return Boolean(grant && grant.expires > this.now() && now.workspaceMode === "project" && now.generation === grant.generation && now.projectPath === grant.path); };
        if (!allowed()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "이슈 내용을 보려면 현재 프로젝트 폴더를 확인하세요." } };
        const view = await this.options.context().view(query, allowed);
        if (!allowed()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "이슈 보기 권한이 만료되었거나 프로젝트가 변경되었습니다." } };
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, view };
      }
      if (this.pickerOpen || this.options.busy()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "진행 중인 작업이나 폴더 선택이 끝난 뒤 다시 시도하세요." } };
      const current = this.options.selection();
      if (current.workspaceMode !== "project" || !current.projectPath) throw new IssueProjectContextError("PROJECT_REQUIRED", "먼저 프로젝트 폴더를 선택하세요.");
      const selected = { ...current }; this.pickerOpen = true;
      try {
        const stillSelected = () => { const now = this.options.selection(); return !signal?.aborted && connected() && now.generation === selected.generation && now.workspaceMode === "project" && now.projectPath === selected.projectPath; };
        if (action === "export") {
          const allowed = () => { if (!signal || !stillSelected()) return false; const grant = this.views.get(signal); return Boolean(grant && grant.expires > this.now() && grant.generation === selected.generation && grant.path === selected.projectPath); };
          if (!allowed()) throw new IssueExportError("VIEW_AUTH_REQUIRED", "이슈 보기 권한이 없거나 만료되었습니다. 다시 확인하세요.");
          const documentId = message.documentId as string, expectedRevision = Number(message.expectedRevision);
          const context = this.options.context(), before = await context.status();
          if (!before.project || before.project.revision !== expectedRevision || !allowed()) throw new IssueExportError("STALE_SELECTION", "이슈 목록 또는 프로젝트 선택이 변경되었습니다. 다시 불러오세요.");
          const target = await this.options.pickExport(selected.projectPath!, signal);
          if (!target) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true };
          const canWrite = () => allowed() && !this.options.busy();
          if (!canWrite()) throw new IssueExportError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되어 저장하지 않았습니다.");
          const release = this.options.tryAcquireWrite();
          if (!release) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "다른 작업이 시작되어 저장하지 않았습니다. 작업이 끝난 뒤 다시 시도하세요." } };
          try {
            const bytes = await context.exportDocument(documentId, expectedRevision, canWrite);
            const beforeCommit = async () => {
              if (!canWrite()) throw new IssueExportError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되어 저장하지 않았습니다.");
              const current = await context.status();
              if (!canWrite() || !current.project || current.project.id !== before.project!.id || current.project.revision !== expectedRevision) throw new IssueExportError("STALE_SELECTION", "이슈 목록 또는 프로젝트 선택이 변경되어 저장하지 않았습니다.");
            };
            const saved = await this.options.writeExport(selected.projectPath!, target, bytes, beforeCommit, signal);
            if (!canWrite()) throw new IssueExportError("OUTCOME_UNKNOWN", "저장 중 연결 또는 프로젝트가 변경되었습니다. 선택한 위치를 확인하세요.");
            return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cleanupWarning: saved.cleanupWarning };
          } finally { release(); }
        }
        if (action === "authorizeView") {
          if (!signal) throw new Error("missing session");
          this.views.delete(signal);
          this.sources.clear(signal);
          if (!(await this.options.context().status()).project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
          if (!stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되었습니다.");
          const path = await this.options.pickView(signal);
          if (!path) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true, authorized: false };
          if (!stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되었습니다.");
          const actual = await this.options.canonical(path), expected = await this.options.canonical(selected.projectPath!);
          if (!stillSelected() || !equalPath(actual, expected)) throw new IssueProjectContextError("STALE_SELECTION", "현재 프로젝트 폴더를 다시 선택해 주세요.");
          if (!(await this.options.context().status()).project || !stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되었습니다.");
          this.views.set(signal, { generation: selected.generation, path: selected.projectPath!, expires: this.now() + 15 * 60_000 });
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, authorized: true, authorizedForMs: 15 * 60_000 };
        }
        if (action === "sourceAdd") {
          const grant = this.activeView(signal, connected);
          if (!grant || !signal) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "자료를 선택하려면 현재 프로젝트 폴더를 다시 확인하세요." } };
          const context = this.options.context(), before = await context.status();
          const requireGrant = () => { if (this.activeView(signal, connected) !== grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다."); };
          requireGrant();
          if (!before.project || !stillSelected()) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 선택이 변경되었습니다. 다시 확인하세요.");
          const chosen = await this.options.pickSource(selected.projectPath!, signal);
          if (!chosen) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true };
          requireGrant();
          if (!stillSelected() || this.options.busy()) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 실행 상태가 변경되어 자료를 선택하지 않았습니다.");
          const source = await this.options.readSource(selected.projectPath!, chosen, signal);
          requireGrant();
          if (!stillSelected() || this.options.busy()) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 실행 상태가 변경되어 자료를 선택하지 않았습니다.");
          const after = await context.status();
          requireGrant();
          if (!stillSelected() || this.options.busy() || !after.project || after.project.id !== before.project.id || after.project.revision !== before.project.revision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 이슈 저장소가 변경되어 자료를 선택하지 않았습니다.");
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, sources: this.sources.add(signal, selected.generation, selected.projectPath!, grant.expires, before.project.revision, source) };
        }
        if (action === "import") {
          if (!(await this.options.context().status()).project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
          if (!stillSelected() || this.options.busy()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되었습니다.");
          const file = await this.options.pickDocument(signal);
          if (!file) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true };
          if (!stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되어 문서를 가져오지 않았습니다.");
          const bytes = await this.options.readDocument(file, signal);
          if (!stillSelected() || this.options.busy()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되어 문서를 가져오지 않았습니다.");
          const result = await this.options.context().importDocument(bytes, () => stillSelected() && !this.options.busy());
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, issueCount: result.issueCount, alreadyImported: result.alreadyImported };
        }
        const path = await this.options.pick(signal);
        if (!path) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: false, cancelled: true };
        const now = this.options.selection();
        if (signal?.aborted || !connected() || now.generation !== selected.generation || now.workspaceMode !== "project" || now.projectPath !== selected.projectPath) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되어 연결하지 않았습니다.");
        const actual = await this.options.canonical(path);
        const expected = await this.options.canonical(selected.projectPath!);
        const after = this.options.selection();
        if (signal?.aborted || !connected() || after.generation !== selected.generation || after.workspaceMode !== "project" || after.projectPath !== selected.projectPath || !equalPath(actual, expected)) throw new IssueProjectContextError("STALE_SELECTION", "현재 프로젝트 폴더를 다시 선택해 주세요.");
        if (this.options.busy()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "진행 중인 작업이 끝난 뒤 다시 시도하세요." } };
        await this.options.context().bind();
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true };
      } finally { this.pickerOpen = false; }
    } catch (error) {
      const result = safeError(error);
      return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: signal?.aborted && result.code !== "OUTCOME_UNKNOWN" ? { code: "STALE_SELECTION", message: "연결이 끊겨 이슈 요청을 취소했습니다. 상태를 확인하세요." } : result };
    }
  }
}
