import type { IssueProjectSelection } from "./project-context.js";
import { IssueProjectContextError } from "./project-context.js";
import { IssueWorkerClientError } from "./worker-client.js";
import { SelectedDocumentError } from "./selected-document.js";
import { IssueExportError } from "./export-file.js";
import { AnalysisSourceError } from "./analysis-source.js";
import { IssueSourceSessions, SourceSessionError } from "./source-session.js";
import { AnalysisDraft } from "./analysis-draft.js";
import { AnalysisBatch } from "./analysis-batch.js";
import { AnalysisExecution } from "./analysis-execution.js";
import { PlanningDraft, PlanningDraftError } from "./planning-draft.js";
import { validCandidateIds, validCandidateOptions, validIssueFilters, validProjectIssueCursor, validProjectIssueFilters, type IssueViewQuery, type IssueViewResult } from "../../shared/issues/view.js";
import type { AnalysisFreshness, AnalysisSegmentPage, AnalysisSnapshotRequest, AnalysisSnapshotSummary, AnalysisSourceChunk, AnalysisSourceList } from "../../shared/issues/sources.js";
import { performance } from "node:perf_hooks";
import path from "node:path";

type Action = "status" | "bind" | "import" | "export" | "authorizeView" | "view" | "releaseView" | "sourceAdd" | "sourceList" | "sourceRead" | "sourceRemove" | "snapshotPrepare" | "snapshotCheck" | "analysisStatus" | "analysisStart" | "analysisInterrupt" | "analysisClear" | "analysisSegment" | "analysisRetry" | "draftCreate" | "draftRead" | "draftReplace" | "draftReview" | "draftRegister";
export type IssueProjectReply = { type: "issues.project.result"; v: 1; clientRequestId: string; action: Action; ok: true; bound: boolean; cancelled?: true; issueCount?: number; alreadyImported?: boolean; cleanupWarning?: boolean; view?: IssueViewResult; authorized?: boolean; authorizedForMs?: number; sources?: AnalysisSourceList; chunk?: AnalysisSourceChunk; snapshot?: AnalysisSnapshotSummary; freshness?: AnalysisFreshness; analysisStatus?: "unavailable" | ReturnType<AnalysisExecution["status"]>; analysisSegment?: AnalysisSegmentPage; draft?: ReturnType<PlanningDraft["read"]> } | { type: "issues.project.result"; v: 1; clientRequestId: string; action: Action; ok: false; error: { code: string; message: string } };
type Context = { status(): Promise<{ project: { id: string; revision: number } | null }>; bind(): Promise<{ project: { id: string; revision: number }; alreadyBound: boolean }>; importDocument(bytes: Uint8Array, mayStart: () => boolean, expected: { id: string; revision: number }): Promise<{ issueCount: number; alreadyImported: boolean }>; exportDocument(documentId: string, revision: number, mayStart: () => boolean, expectedProjectId: string): Promise<Uint8Array>; view(query: IssueViewQuery, mayStart: () => boolean, expectedProjectId: string): Promise<IssueViewResult> };
type Options = { selection(): IssueProjectSelection; context(): Context; pick(signal?: AbortSignal): Promise<string | null>; pickView(signal?: AbortSignal): Promise<string | null>; pickDocument(signal?: AbortSignal): Promise<string | null>; pickExport(projectPath: string, signal?: AbortSignal): Promise<string | null>; pickSource(projectPath: string, signal?: AbortSignal): Promise<string | null>; readSource(projectPath: string, target: string, signal?: AbortSignal): Promise<{ relativePath: string; bytes: number; sha256: string; text: string }>; readDocument(path: string, signal?: AbortSignal): Promise<Uint8Array>; writeExport(projectPath: string, target: string, bytes: Uint8Array, beforeCommit: () => Promise<void>, signal?: AbortSignal): Promise<{ cleanupWarning: boolean }>; tryAcquireWrite(): (() => void) | null; canonical(path: string): Promise<string>; busy(): boolean; now?(): number; analysisAvailable?(): boolean; createAnalysisExecution?: (createBatch: (admitted: () => boolean) => Promise<AnalysisBatch>, owner: AbortSignal) => AnalysisExecution | null };
type AnalysisLease = { invalidated: boolean; batch?: AnalysisBatch; timer: ReturnType<typeof setTimeout>; onAbort: () => void };
const equalPath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const safeError = (error: unknown) => error instanceof PlanningDraftError ? { code: error.code, message: "초안 또는 버전을 확인하세요." } : error instanceof IssueProjectContextError || error instanceof IssueWorkerClientError || error instanceof SelectedDocumentError || error instanceof IssueExportError || error instanceof AnalysisSourceError || error instanceof SourceSessionError
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
    case "executionHistory": keys(["kind", "expectedRevision", "afterId"]); if (!revision() || !(q.afterId === null || id(q.afterId))) throw new Error("invalid"); break;
    case "issues": keys(["kind", "documentId", "expectedRevision", "offset", "filters"]); if (!id(q.documentId) || !revision() || !offset() || q.filters !== undefined && !validIssueFilters(q.filters)) throw new Error("invalid"); break;
    case "projectIssues": keys(["kind", "expectedRevision", "cursor", "filters"]); if (!revision() || !validProjectIssueCursor(q.cursor) || q.filters !== undefined && !validProjectIssueFilters(q.filters)) throw new Error("invalid"); break;
    case "categories": keys(["kind", "documentId", "expectedRevision", "parentId", "offset"]); if (!id(q.documentId) || !revision() || !offset() || !(q.parentId === null || id(q.parentId))) throw new Error("invalid"); break;
    case "diagnostics": keys(["kind", "documentId", "expectedRevision", "offset"]); if (!id(q.documentId) || !revision() || !offset()) throw new Error("invalid"); break;
    case "sourceTrace": keys(["kind", "documentId", "expectedRevision", "offset"]); if (!id(q.documentId) || !revision() || !offset()) throw new Error("invalid"); break;
    case "requirementDetail": keys(["kind", "documentId", "expectedRevision", "requirementId", "offset"]); if (!id(q.documentId) || !revision() || !id(q.requirementId) || !offset()) throw new Error("invalid"); break;
    case "detail": keys(["kind", "documentId", "expectedRevision", "issueId"]); if (!id(q.documentId) || !revision() || !id(q.issueId)) throw new Error("invalid"); break;
    case "candidatePreview": keys(["kind", "documentId", "expectedRevision", "issueIds", "options"]); if (!id(q.documentId) || !revision() || !validCandidateIds(q.issueIds) || q.options !== undefined && !validCandidateOptions(q.options)) throw new Error("invalid"); break;
    case "criteria": case "requirements": case "dependencies": keys(["kind", "documentId", "expectedRevision", "issueId", "offset"]); if (!id(q.documentId) || !revision() || !id(q.issueId) || !offset()) throw new Error("invalid"); break;
    default: throw new Error("invalid");
  }
  return q as IssueViewQuery;
}

/** Binding requires a native selection of the current project. Origin is not an authentication credential. */
export class IssueBridgeApi {
  private pickerOpen = false;
  private checkingSources = false;
  private readonly views = new WeakMap<AbortSignal, { generation: number; path: string; projectId: string; expires: number }>();
  private readonly sources = new IssueSourceSessions(() => this.now());
  private readonly analysisLeases = new Map<AbortSignal, AnalysisLease>();
  private readonly analysisExecutions = new Map<AbortSignal, AnalysisExecution>();
  private readonly analysisRevisions = new Map<AbortSignal, number>();
  private readonly analysisProjectIds = new Map<AbortSignal, string>();
  private readonly analysisSnapshotIds = new Map<AbortSignal, string>();
  private readonly drafts = new WeakMap<AbortSignal, { projectId: string; draft: PlanningDraft }>();
  private readonly registeringDrafts = new WeakSet<AbortSignal>();
  private readonly snapshotProjects = new WeakMap<AbortSignal, { snapshotId: string; projectId: string }>();
  constructor(private readonly options: Options) {}
  private now(): number { return this.options.now?.() ?? performance.now(); }
  clearSources(): void { for (const signal of new Set([...this.analysisLeases.keys(), ...this.analysisExecutions.keys()])) this.revokeAnalysis(signal); this.sources.clearAll(); }
  private finishAnalysis(signal: AbortSignal, lease: AnalysisLease): void {
    if (this.analysisLeases.get(signal) !== lease) return;
    clearTimeout(lease.timer); signal.removeEventListener("abort", lease.onAbort); this.analysisLeases.delete(signal);
  }
  private revokeAnalysis(signal: AbortSignal): void {
    const execution = this.analysisExecutions.get(signal);
    if (execution) { execution.interrupt(); if (execution.clear()) { this.analysisExecutions.delete(signal); this.analysisRevisions.delete(signal); this.analysisProjectIds.delete(signal); this.analysisSnapshotIds.delete(signal); } }
    const lease = this.analysisLeases.get(signal);
    if (!lease) return;
    lease.invalidated = true;
    lease.batch?.dispose();
  }
  private revokeView(signal: AbortSignal): void {
    this.views.delete(signal); this.drafts.delete(signal); this.revokeAnalysis(signal); this.sources.clear(signal); this.snapshotProjects.delete(signal);
  }
  private activeView(signal: AbortSignal | undefined, connected: () => boolean) {
    if (!signal || signal.aborted || !connected()) { if (signal) this.revokeView(signal); return null; }
    const grant = this.views.get(signal), current = this.options.selection();
    if (!grant || grant.expires <= this.now() || current.workspaceMode !== "project" || current.generation !== grant.generation || current.projectPath !== grant.path) { this.revokeView(signal); return null; }
    return grant;
  }
  /**
   * Trusted runtime entry point, not a WebSocket operation. The runtime must acquire
   * shared admission and enforce tool isolation before using the returned batch.
   */
  async createAnalysisBatch(signal: AbortSignal, connected: () => boolean, admitted: () => boolean, snapshotId: string, revision: number, expectedProjectId?: string): Promise<AnalysisBatch> {
    const grant = this.activeView(signal, connected);
    const stale = (): never => { throw new AnalysisSourceError("STALE_INPUT", "분석 입력 또는 실행 권한이 변경되었습니다. 다시 준비하세요."); };
    if (!grant || !admitted()) return stale();
    if (this.analysisLeases.has(signal)) throw new AnalysisSourceError("BUSY", "이 연결의 이전 분석이 완전히 끝난 뒤 다시 시작하세요.");
    const lease: AnalysisLease = { invalidated: false, onAbort: () => this.revokeAnalysis(signal), timer: setTimeout(() => { this.revokeAnalysis(signal); this.sources.clear(signal); }, Math.max(1, grant.expires - this.now())) };
    lease.timer.unref(); this.analysisLeases.set(signal, lease); signal.addEventListener("abort", lease.onAbort, { once: true });
    const valid = () => Boolean(!lease.invalidated && this.activeView(signal, connected) === grant && admitted());
    try {
      const project = await this.options.context().status();
      if (!valid() || !project.project || project.project.id !== grant.projectId || project.project.revision !== revision || expectedProjectId !== undefined && project.project.id !== expectedProjectId) return stale();
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
      const batch = new AnalysisBatch(new AnalysisDraft(snapshotId, revision, summary.totalSegments, loadSegment), () => this.finishAnalysis(signal, lease));
      lease.batch = batch;
      if (!valid()) { batch.dispose(); return stale(); }
      return batch;
    } catch (error) { if (lease.batch) lease.batch.dispose(); else this.finishAnalysis(signal, lease); throw error; }
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
      if (message.type === "issues.analysis.status") action = "analysisStatus";
      if (message.type === "issues.analysis.start") action = "analysisStart";
      if (message.type === "issues.analysis.interrupt") action = "analysisInterrupt";
      if (message.type === "issues.analysis.clear") action = "analysisClear";
      if (message.type === "issues.analysis.segment") action = "analysisSegment";
      if (message.type === "issues.analysis.retry") action = "analysisRetry";
      if (message.type === "issues.draft.create") action = "draftCreate";
      if (message.type === "issues.draft.read") action = "draftRead";
      if (message.type === "issues.draft.replace") action = "draftReplace";
      if (message.type === "issues.draft.review") action = "draftReview";
      if (message.type === "issues.draft.register") action = "draftRegister";
      if (typeof message.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(message.clientRequestId)) clientRequestId = message.clientRequestId;
      if (!uiOrigin || !clientRequestId || message.v !== 1 || !["issues.project.status", "issues.project.bind", "issues.document.import", "issues.document.export", "issues.view.authorize", "issues.view.query", "issues.view.release", "issues.sources.add", "issues.sources.list", "issues.sources.read", "issues.sources.remove", "issues.analysis.prepare", "issues.analysis.check", "issues.analysis.status", "issues.analysis.start", "issues.analysis.interrupt", "issues.analysis.clear", "issues.analysis.segment", "issues.analysis.retry", "issues.draft.create", "issues.draft.read", "issues.draft.replace", "issues.draft.review", "issues.draft.register"].includes(String(message.type)) || Object.keys(message).some(key => !["type", "v", "clientRequestId", ...(action === "view" ? ["query"] : []), ...(["draftCreate", "draftReplace"].includes(action) ? ["document"] : []), ...(action === "draftReview" ? ["review"] : []), ...(["draftReplace", "draftReview", "draftRegister"].includes(action) ? ["draftRevision"] : []), ...(action === "draftCreate" ? ["expectedRevision"] : []), ...(action === "export" ? ["documentId", "expectedRevision"] : []), ...(["sourceRead", "sourceRemove"].includes(action) ? ["sourceId"] : []), ...(action === "sourceRead" || action === "analysisSegment" ? ["offset"] : []), ...(["analysisSegment", "analysisRetry"].includes(action) ? ["index"] : []), ...(action === "snapshotPrepare" ? ["expectedRevision", "expectedSources", "instruction"] : []), ...(["snapshotCheck", "analysisStart"].includes(action) ? ["snapshotId", "expectedRevision"] : [])].includes(key))) throw new Error("invalid");
      if (action === "export" && (!id(message.documentId) || !Number.isSafeInteger(message.expectedRevision) || Number(message.expectedRevision) < 1)) throw new Error("invalid");
      if ((action === "sourceRead" || action === "sourceRemove") && (!id(message.sourceId) || !String(message.sourceId).startsWith("source_") || action === "sourceRead" && (!Number.isSafeInteger(message.offset) || Number(message.offset) < 0))) throw new Error("invalid");
      if ((action === "snapshotCheck" || action === "analysisStart") && (typeof message.snapshotId !== "string" || !/^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(message.snapshotId) || !Number.isSafeInteger(message.expectedRevision) || Number(message.expectedRevision) < 1)) throw new Error("invalid");
      if ((action === "analysisSegment" || action === "analysisRetry") && (!Number.isSafeInteger(message.index) || Number(message.index) < 0 || Number(message.index) >= 2048 || action === "analysisSegment" && (!Number.isSafeInteger(message.offset) || Number(message.offset) < 0 || Number(message.offset) > 512))) throw new Error("invalid");
      if (signal?.aborted || !connected()) throw new IssueProjectContextError("STALE_SELECTION", "연결이 끊겨 이슈 요청을 취소했습니다.");
      if (action === "status") return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: Boolean((await this.options.context().status()).project) };
      if (["analysisStatus", "analysisStart", "analysisInterrupt", "analysisClear", "analysisSegment", "analysisRetry"].includes(action)) {
        const grant = this.activeView(signal, connected);
        if (!grant || !signal) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "이슈 보기 권한을 다시 확인하세요." } };
        let project: Awaited<ReturnType<Context["status"]>>;
        try { project = await this.options.context().status(); }
        catch (error) { if (this.views.get(signal) === grant) this.revokeView(signal); throw error; }
        if (!project.project || this.activeView(signal, connected) !== grant) {
          if (this.views.get(signal) === grant) this.revokeView(signal);
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "프로젝트 또는 보기 권한이 변경되었습니다." } };
        }
        if (project.project.id !== grant.projectId) { this.revokeView(signal); throw new AnalysisSourceError("STALE_INPUT", "프로젝트가 변경되어 분석 입력을 다시 준비해야 합니다."); }
        let execution = this.analysisExecutions.get(signal);
        if (execution && action !== "analysisClear" && (project.project.revision !== this.analysisRevisions.get(signal) || project.project.id !== this.analysisProjectIds.get(signal))) {
          this.revokeAnalysis(signal); this.sources.clear(signal); this.snapshotProjects.delete(signal);
          throw new AnalysisSourceError("STALE_INPUT", "프로젝트가 변경되어 분석 결과를 다시 준비해야 합니다.");
        }
        if (action === "analysisStart") {
          if (!this.options.createAnalysisExecution) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "ANALYSIS_UNAVAILABLE", message: "분석 실행과 도구 정책이 아직 준비되지 않았습니다." } };
          if (execution) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "이전 분석을 정리한 뒤 다시 시작하세요." } };
          if (project.project.revision !== Number(message.expectedRevision)) throw new AnalysisSourceError("STALE_INPUT", "프로젝트가 변경되어 다시 준비해야 합니다.");
          this.sources.snapshotSummary(signal, grant.generation, grant.path, Number(message.expectedRevision), String(message.snapshotId));
          const selectedProjectId = project.project.id;
          const prepared = this.snapshotProjects.get(signal);
          if (!prepared || prepared.snapshotId !== message.snapshotId || prepared.projectId !== selectedProjectId) throw new AnalysisSourceError("STALE_INPUT", "프로젝트가 변경되어 분석 입력을 다시 준비해야 합니다.");
          execution = this.options.createAnalysisExecution(admitted => this.createAnalysisBatch(signal, connected, admitted, String(message.snapshotId), Number(message.expectedRevision), selectedProjectId), signal) ?? undefined;
          if (!execution) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "ANALYSIS_UNAVAILABLE", message: "안전한 분석 실행을 확인할 수 없습니다." } };
          const owned = execution; this.analysisExecutions.set(signal, owned); this.analysisRevisions.set(signal, Number(message.expectedRevision)); this.analysisProjectIds.set(signal, selectedProjectId); this.analysisSnapshotIds.set(signal, String(message.snapshotId));
          const pending = owned.start(2048);
          if (owned.status().state === "idle") { this.analysisExecutions.delete(signal); this.analysisRevisions.delete(signal); this.analysisProjectIds.delete(signal); this.analysisSnapshotIds.delete(signal); await pending.catch(() => {}); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "ANALYSIS_UNAVAILABLE", message: "안전한 분석 실행을 확인할 수 없습니다." } }; }
          void pending.finally(() => { if (!this.activeView(signal, connected) && owned.clear()) { this.analysisExecutions.delete(signal); this.analysisRevisions.delete(signal); this.analysisProjectIds.delete(signal); this.analysisSnapshotIds.delete(signal); } }).catch(() => {});
        } else if (action === "analysisSegment") {
          if (!execution) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "NOT_FOUND", message: "분석 결과가 없습니다." } };
          const revision = this.analysisRevisions.get(signal), snapshotId = this.analysisSnapshotIds.get(signal);
          if (!revision || !snapshotId) throw new AnalysisSourceError("STALE_INPUT", "분석 입력을 다시 준비하세요.");
          const files = this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
          for (const file of files) {
            let current: Awaited<ReturnType<Options["readSource"]>>;
            try { current = await this.options.readSource(grant.path, path.resolve(grant.path, ...file.relativePath.split("/")), signal); }
            catch { this.revokeAnalysis(signal); throw new AnalysisSourceError("STALE_INPUT", "선택 자료를 확인할 수 없어 결과를 표시하지 않았습니다."); }
            if (this.activeView(signal, connected) !== grant || current.relativePath !== file.relativePath || current.bytes !== file.bytes || current.sha256 !== file.sha256) { this.revokeAnalysis(signal); throw new AnalysisSourceError("STALE_INPUT", "선택 자료 또는 보기 권한이 변경되어 결과를 표시하지 않았습니다."); }
            this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
          }
          const after = await this.options.context().status();
          if (this.activeView(signal, connected) !== grant || !after.project || after.project.id !== project.project.id || after.project.revision !== revision || this.analysisExecutions.get(signal) !== execution) { this.revokeAnalysis(signal); throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 보기 권한이 변경되어 결과를 표시하지 않았습니다."); }
          try { return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, analysisSegment: execution.segmentPage(Number(message.index), Number(message.offset)) }; }
          catch { return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "INVALID_INPUT", message: "분석 결과 위치를 확인하세요." } }; }
        } else if (action === "analysisRetry") {
          if (!execution) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "NOT_FOUND", message: "재시도할 분석이 없습니다." } };
          const owned = execution, pending = owned.retry(Number(message.index));
          if (owned.status().state !== "running") { await pending.catch(() => {}); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "ANALYSIS_UNAVAILABLE", message: "이 구간을 다시 시작할 수 없습니다." } }; }
          void pending.finally(() => { if (!this.activeView(signal, connected) && owned.clear()) { this.analysisExecutions.delete(signal); this.analysisRevisions.delete(signal); this.analysisProjectIds.delete(signal); this.analysisSnapshotIds.delete(signal); } }).catch(() => {});
        } else if (action === "analysisInterrupt") {
          if (!execution?.interrupt()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "NOT_RUNNING", message: "중단할 분석이 없습니다." } };
        } else if (action === "analysisClear") {
          if (!execution?.clear()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "분석이 끝난 뒤 정리하세요." } };
          this.analysisExecutions.delete(signal); this.analysisRevisions.delete(signal); this.analysisProjectIds.delete(signal); this.analysisSnapshotIds.delete(signal); execution = undefined;
        }
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, analysisStatus: execution?.status() ?? (this.options.analysisAvailable?.() ? { state: "idle", progress: null } : "unavailable") };
      }
      if (["draftCreate", "draftRead", "draftReplace", "draftReview", "draftRegister"].includes(action)) {
        const grant = this.activeView(signal, connected);
        if (!signal || !grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "초안을 보려면 프로젝트를 다시 확인하세요.");
        const context = this.options.context(), project = await context.status();
        if (this.activeView(signal, connected) !== grant || !project.project || project.project.id !== grant.projectId) {
          this.revokeView(signal); throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다.");
        }
        const allowed = () => this.activeView(signal, connected) === grant && !this.options.busy();
        if (this.registeringDrafts.has(signal)) throw new AnalysisSourceError("BUSY", "초안 등록이 끝날 때까지 기다리세요.");
        if (["draftReplace", "draftReview", "draftRegister"].includes(action) && (!Number.isSafeInteger(message.draftRevision) || Number(message.draftRevision) < 1)) throw new PlanningDraftError("INVALID_INPUT");
        let entry = this.drafts.get(signal);
        if (entry && (entry.projectId !== project.project.id || entry.draft.projectRevision !== project.project.revision)) {
          this.drafts.delete(signal); throw new PlanningDraftError("VERSION_CONFLICT");
        }
        if (action === "draftCreate") {
          if (entry) throw new AnalysisSourceError("BUSY", "기존 초안이 있습니다. 보기 권한을 종료하면 삭제됩니다.");
          if (message.expectedRevision !== project.project.revision) throw new PlanningDraftError("VERSION_CONFLICT");
          entry = { projectId: project.project.id, draft: new PlanningDraft(message.document, project.project.revision) };
          this.drafts.set(signal, entry);
        } else {
          if (!entry) throw new PlanningDraftError("NOT_FOUND");
          if (action === "draftReplace") entry.draft.replace(Number(message.draftRevision), message.document);
          if (action === "draftReview") entry.draft.review(Number(message.draftRevision), message.review);
          if (action === "draftRegister") {
            if (!allowed()) throw new AnalysisSourceError("BUSY", "다른 작업이 끝난 뒤 등록하세요.");
            if (this.pickerOpen) throw new AnalysisSourceError("BUSY", "다른 선택이 끝난 뒤 등록하세요.");
            this.pickerOpen = true;
            try {
              const selectedPath = await this.options.pickView(signal);
              if (!selectedPath) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true };
              const actual = await this.options.canonical(selectedPath), expected = await this.options.canonical(grant.path);
              const current = await context.status();
              if (!allowed() || !equalPath(actual, expected) || !current.project || current.project.id !== entry.projectId || current.project.revision !== project.project.revision || this.drafts.get(signal) !== entry) throw new IssueExportError("STALE_SELECTION", "프로젝트 또는 초안이 변경되어 등록하지 않았습니다.");
            } finally { this.pickerOpen = false; }
            const bytes = entry.draft.exportForRegistration(Number(message.draftRevision), project.project.revision);
            const release = this.options.tryAcquireWrite();
            if (!release) throw new AnalysisSourceError("BUSY", "다른 작업이 끝난 뒤 등록하세요.");
            this.registeringDrafts.add(signal);
            try {
              const result = await context.importDocument(bytes, allowed, { id: entry.projectId, revision: project.project.revision });
              if (!allowed()) throw new IssueExportError("OUTCOME_UNKNOWN", "등록 결과를 확인하세요.");
              this.drafts.delete(signal);
              return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, issueCount: result.issueCount, alreadyImported: result.alreadyImported };
            } finally { this.registeringDrafts.delete(signal); release(); }
          }
        }
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, draft: entry.draft.read() };
      }
      if (action === "releaseView") { if (signal) this.revokeView(signal); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, authorized: false }; }
      if (signal && this.analysisLeases.has(signal) && (action === "sourceAdd" || action === "sourceRemove" || action === "snapshotPrepare")) {
        if (!this.activeView(signal, connected)) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "자료를 보려면 현재 프로젝트 폴더를 다시 확인하세요." } };
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "분석이 완전히 끝난 뒤 자료를 변경하세요." } };
      }
      if (action === "sourceList" || action === "sourceRead" || action === "sourceRemove" || action === "snapshotPrepare" || action === "snapshotCheck") {
        const snapshotRequest = action === "snapshotPrepare" ? parseSnapshotRequest(message) : undefined;
        const grant = this.activeView(signal, connected);
        if (!grant || !signal) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "자료를 보려면 현재 프로젝트 폴더를 다시 확인하세요." } };
        let project: Awaited<ReturnType<Context["status"]>>;
        try { project = await this.options.context().status(); } catch (error) { if (this.views.get(signal) === grant) this.revokeView(signal); throw error; }
        if (!project.project || this.activeView(signal, connected) !== grant) { if (this.views.get(signal) === grant) this.revokeView(signal); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "프로젝트 또는 보기 권한이 변경되었습니다." } }; }
        if (project.project.id !== grant.projectId) { this.revokeView(signal); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "프로젝트가 변경되어 보기 권한을 다시 확인하세요." } }; }
        if (this.analysisLeases.has(signal) && (action === "sourceRemove" || action === "snapshotPrepare")) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "분석이 완전히 끝난 뒤 자료를 변경하세요." } };
        if (snapshotRequest) {
          const snapshot = this.sources.prepare(signal, grant.generation, grant.path, project.project.revision, snapshotRequest);
          this.snapshotProjects.set(signal, { snapshotId: snapshot.id, projectId: project.project.id });
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, snapshot };
        }
        if (action === "snapshotCheck") {
          const snapshotId = String(message.snapshotId), revision = Number(message.expectedRevision);
          if (project.project.revision !== revision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트가 변경되었습니다. 목록을 새로 불러오세요.");
          const prepared = this.snapshotProjects.get(signal);
          if (!prepared || prepared.snapshotId !== snapshotId || prepared.projectId !== project.project.id) throw new AnalysisSourceError("STALE_INPUT", "프로젝트가 변경되어 분석 입력을 다시 준비해야 합니다.");
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
        const grant = this.views.get(signal!)!;
        let before: Awaited<ReturnType<Context["status"]>>, after: Awaited<ReturnType<Context["status"]>>;
        try { before = await this.options.context().status(); } catch (error) { if (this.views.get(signal!) === grant) this.revokeView(signal!); throw error; }
        if (!allowed() || this.views.get(signal!) !== grant || !before.project || before.project.id !== grant.projectId) { if (this.views.get(signal!) === grant) this.revokeView(signal!); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "프로젝트가 변경되어 보기 권한을 다시 확인하세요." } }; }
        const view = await this.options.context().view(query, () => allowed() && this.views.get(signal!) === grant, grant.projectId);
        try { after = await this.options.context().status(); } catch (error) { if (this.views.get(signal!) === grant) this.revokeView(signal!); throw error; }
        if (!allowed() || this.views.get(signal!) !== grant || !after.project || after.project.id !== grant.projectId) { if (this.views.get(signal!) === grant) this.revokeView(signal!); return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "이슈 보기 권한이 만료되었거나 프로젝트가 변경되었습니다." } }; }
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, view };
      }
      if (this.pickerOpen || this.options.busy()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "진행 중인 작업이나 폴더 선택이 끝난 뒤 다시 시도하세요." } };
      const current = this.options.selection();
      if (current.workspaceMode !== "project" || !current.projectPath) throw new IssueProjectContextError("PROJECT_REQUIRED", "먼저 프로젝트 폴더를 선택하세요.");
      const selected = { ...current }; this.pickerOpen = true;
      try {
        const stillSelected = () => { const now = this.options.selection(); return !signal?.aborted && connected() && now.generation === selected.generation && now.workspaceMode === "project" && now.projectPath === selected.projectPath; };
        if (action === "export") {
          const exportGrant = signal ? this.views.get(signal) : undefined;
          const allowed = () => { if (!signal || !stillSelected()) return false; const grant = this.views.get(signal); return Boolean(grant && grant === exportGrant && grant.expires > this.now() && grant.generation === selected.generation && grant.path === selected.projectPath); };
          if (!allowed()) throw new IssueExportError("VIEW_AUTH_REQUIRED", "이슈 보기 권한이 없거나 만료되었습니다. 다시 확인하세요.");
          const documentId = message.documentId as string, expectedRevision = Number(message.expectedRevision);
          const context = this.options.context();
          let before: Awaited<ReturnType<Context["status"]>>;
          try { before = await context.status(); } catch (error) { if (signal && this.views.get(signal) === exportGrant) this.revokeView(signal); throw error; }
          if ((!before.project || before.project.id !== exportGrant?.projectId) && signal && this.views.get(signal) === exportGrant) this.revokeView(signal);
          if (!before.project || before.project.id !== this.views.get(signal!)?.projectId || before.project.revision !== expectedRevision || !allowed()) throw new IssueExportError("STALE_SELECTION", "이슈 목록 또는 프로젝트 선택이 변경되었습니다. 다시 불러오세요.");
          const projectId = before.project.id;
          const target = await this.options.pickExport(selected.projectPath!, signal);
          if (!target) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true };
          const canWrite = () => allowed() && !this.options.busy();
          if (!canWrite()) throw new IssueExportError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되어 저장하지 않았습니다.");
          const release = this.options.tryAcquireWrite();
          if (!release) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "BUSY", message: "다른 작업이 시작되어 저장하지 않았습니다. 작업이 끝난 뒤 다시 시도하세요." } };
          try {
            const bytes = await context.exportDocument(documentId, expectedRevision, canWrite, projectId);
            const beforeCommit = async () => {
              if (!canWrite()) throw new IssueExportError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되어 저장하지 않았습니다.");
              let current: Awaited<ReturnType<Context["status"]>>;
              try { current = await context.status(); } catch (error) { if (signal && this.views.get(signal) === exportGrant) this.revokeView(signal); throw error; }
              if ((!current.project || current.project.id !== projectId) && signal && this.views.get(signal) === exportGrant) this.revokeView(signal);
              if (!canWrite() || !current.project || current.project.id !== projectId || current.project.revision !== expectedRevision) throw new IssueExportError("STALE_SELECTION", "이슈 목록 또는 프로젝트 선택이 변경되어 저장하지 않았습니다.");
            };
            const saved = await this.options.writeExport(selected.projectPath!, target, bytes, beforeCommit, signal);
            if (!canWrite()) throw new IssueExportError("OUTCOME_UNKNOWN", "저장 중 연결 또는 프로젝트가 변경되었습니다. 선택한 위치를 확인하세요.");
            return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cleanupWarning: saved.cleanupWarning };
          } finally { release(); }
        }
        if (action === "authorizeView") {
          if (!signal) throw new Error("missing session");
          this.revokeView(signal);
          const before = await this.options.context().status();
          if (!before.project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
          const projectId = before.project.id;
          if (!stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되었습니다.");
          const path = await this.options.pickView(signal);
          if (!path) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true, authorized: false };
          if (!stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되었습니다.");
          const actual = await this.options.canonical(path), expected = await this.options.canonical(selected.projectPath!);
          if (!stillSelected() || !equalPath(actual, expected)) throw new IssueProjectContextError("STALE_SELECTION", "현재 프로젝트 폴더를 다시 선택해 주세요.");
          const after = await this.options.context().status();
          if (!after.project || after.project.id !== projectId || !stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되었습니다.");
          this.views.set(signal, { generation: selected.generation, path: selected.projectPath!, projectId, expires: this.now() + 15 * 60_000 });
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, authorized: true, authorizedForMs: 15 * 60_000 };
        }
        if (action === "sourceAdd") {
          const grant = this.activeView(signal, connected);
          if (!grant || !signal) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "VIEW_AUTH_REQUIRED", message: "자료를 선택하려면 현재 프로젝트 폴더를 다시 확인하세요." } };
          const context = this.options.context();
          let before: Awaited<ReturnType<Context["status"]>>;
          try { before = await context.status(); } catch (error) { if (this.views.get(signal) === grant) this.revokeView(signal); throw error; }
          const requireGrant = () => { if (this.activeView(signal, connected) !== grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다."); };
          requireGrant();
          if (!before.project || before.project.id !== grant.projectId || !stillSelected()) { this.revokeView(signal); throw new AnalysisSourceError("STALE_INPUT", "프로젝트 선택이 변경되었습니다. 다시 확인하세요."); }
          const projectId = before.project.id, projectRevision = before.project.revision;
          const chosen = await this.options.pickSource(selected.projectPath!, signal);
          if (!chosen) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true };
          requireGrant();
          if (!stillSelected() || this.options.busy()) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 실행 상태가 변경되어 자료를 선택하지 않았습니다.");
          let afterPick: Awaited<ReturnType<Context["status"]>>;
          try { afterPick = await context.status(); } catch (error) { if (this.views.get(signal) === grant) this.revokeView(signal); throw error; }
          requireGrant();
          if (!afterPick.project || afterPick.project.id !== projectId) this.revokeView(signal);
          if (!stillSelected() || this.options.busy() || !afterPick.project || afterPick.project.id !== projectId || afterPick.project.revision !== projectRevision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 이슈 저장소가 변경되어 자료를 선택하지 않았습니다.");
          const source = await this.options.readSource(selected.projectPath!, chosen, signal);
          requireGrant();
          if (!stillSelected() || this.options.busy()) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 실행 상태가 변경되어 자료를 선택하지 않았습니다.");
          let after: Awaited<ReturnType<Context["status"]>>;
          try { after = await context.status(); } catch (error) { if (this.views.get(signal) === grant) this.revokeView(signal); throw error; }
          requireGrant();
          if (!after.project || after.project.id !== grant.projectId) this.revokeView(signal);
          if (!stillSelected() || this.options.busy() || !after.project || after.project.id !== projectId || after.project.revision !== projectRevision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 이슈 저장소가 변경되어 자료를 선택하지 않았습니다.");
          if (this.analysisLeases.has(signal)) throw new AnalysisSourceError("BUSY", "분석이 완전히 끝난 뒤 자료를 변경하세요.");
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, sources: this.sources.add(signal, selected.generation, selected.projectPath!, grant.expires, projectRevision, source) };
        }
        if (action === "import") {
          const context = this.options.context(), before = await context.status();
          if (!before.project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
          const expected = { id: before.project.id, revision: before.project.revision };
          const checkProject = async () => {
            const current = await context.status();
            if (!stillSelected() || this.options.busy() || !current.project || current.project.id !== expected.id || current.project.revision !== expected.revision) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 이슈 저장소가 변경되어 문서를 가져오지 않았습니다.");
          };
          if (!stillSelected() || this.options.busy()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되었습니다.");
          const file = await this.options.pickDocument(signal);
          if (!file) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, cancelled: true };
          if (!stillSelected()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되어 문서를 가져오지 않았습니다.");
          await checkProject();
          const bytes = await this.options.readDocument(file, signal);
          if (!stillSelected() || this.options.busy()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 실행 상태가 변경되어 문서를 가져오지 않았습니다.");
          await checkProject();
          const result = await context.importDocument(bytes, () => stillSelected() && !this.options.busy(), expected);
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
