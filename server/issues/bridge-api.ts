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
import { SemanticExecution } from "./semantic-execution.js";
import type { SemanticInput } from "./semantic-validation.js";
import { PlanningProposalExecution } from "./planning-proposal-execution.js";
import { PlanningProposalError } from "./planning-proposal.js";
import { PlanningDraft, PlanningDraftError } from "./planning-draft.js";
import { validCandidateIds, validCandidateOptions, validIssueFilters, validProjectIssueCursor, validProjectIssueFilters, type IssueViewQuery, type IssueViewResult } from "../../shared/issues/view.js";
import type { AnalysisFreshness, AnalysisSegmentPage, AnalysisSnapshotRequest, AnalysisSnapshotSummary, AnalysisSourceChunk, AnalysisSourceList } from "../../shared/issues/sources.js";
import { performance } from "node:perf_hooks";
import path from "node:path";

type Action = "status" | "bind" | "import" | "export" | "authorizeView" | "view" | "releaseView" | "sourceAdd" | "sourceList" | "sourceRead" | "sourceRemove" | "snapshotPrepare" | "snapshotCheck" | "analysisStatus" | "analysisStart" | "analysisInterrupt" | "analysisClear" | "analysisSegment" | "analysisRetry" | "draftCreate" | "draftRead" | "draftReplace" | "draftReview" | "draftRegister" | "draftPersist" | "draftRestore" | "draftInspectSaved" | "draftRebase" | "draftCopy" | "semanticStart" | "semanticStatus" | "semanticInterrupt" | "semanticClear" | "semanticSave" | "semanticReview" | "planStart" | "planStatus" | "planInterrupt" | "planClear" | "planApply";
export type IssueProjectReply = { type: "issues.project.result"; v: 1; clientRequestId: string; action: Action; ok: true; bound: boolean; cancelled?: true; issueCount?: number; alreadyImported?: boolean; cleanupWarning?: boolean; view?: IssueViewResult; authorized?: boolean; authorizedForMs?: number; sources?: AnalysisSourceList; chunk?: AnalysisSourceChunk; snapshot?: AnalysisSnapshotSummary; freshness?: AnalysisFreshness; analysisStatus?: "unavailable" | ReturnType<AnalysisExecution["status"]>; analysisSegment?: AnalysisSegmentPage; draft?: ReturnType<PlanningDraft["read"]>; savedStale?: boolean; semanticStatus?: ReturnType<SemanticExecution["status"]>; planStatus?: ReturnType<PlanningProposalExecution["status"]> } | { type: "issues.project.result"; v: 1; clientRequestId: string; action: Action; ok: false; error: { code: string; message: string } };
type Context = { status(): Promise<{ project: { id: string; revision: number } | null }>; bind(): Promise<{ project: { id: string; revision: number }; alreadyBound: boolean }>; readPlanningDraft?(expected: { id: string; revision: number }, mayStart: () => boolean): Promise<{ generation: number; stale: boolean; snapshot: ReturnType<PlanningDraft["read"]> } | null>; savePlanningDraft?(expected: { id: string; revision: number }, generation: number, snapshot: ReturnType<PlanningDraft["read"]>, mayStart: () => boolean): Promise<number>; importDocument(bytes: Uint8Array, mayStart: () => boolean, expected: { id: string; revision: number }): Promise<{ issueCount: number; alreadyImported: boolean }>; exportDocument(documentId: string, revision: number, mayStart: () => boolean, expectedProjectId: string): Promise<Uint8Array>; view(query: IssueViewQuery, mayStart: () => boolean, expectedProjectId: string): Promise<IssueViewResult> };
type Options = { selection(): IssueProjectSelection; context(): Context; pick(signal?: AbortSignal): Promise<string | null>; pickView(signal?: AbortSignal): Promise<string | null>; pickDocument(signal?: AbortSignal): Promise<string | null>; pickExport(projectPath: string, signal?: AbortSignal): Promise<string | null>; pickSource(projectPath: string, signal?: AbortSignal): Promise<string | null>; readSource(projectPath: string, target: string, signal?: AbortSignal): Promise<{ relativePath: string; bytes: number; sha256: string; text: string }>; readDocument(path: string, signal?: AbortSignal): Promise<Uint8Array>; writeExport(projectPath: string, target: string, bytes: Uint8Array, beforeCommit: () => Promise<void>, signal?: AbortSignal): Promise<{ cleanupWarning: boolean }>; tryAcquireWrite(): (() => void) | null; canonical(path: string): Promise<string>; busy(): boolean; now?(): number; analysisAvailable?(): boolean; createAnalysisExecution?: (createBatch: (admitted: () => boolean) => Promise<AnalysisBatch>, owner: AbortSignal) => AnalysisExecution | null; createSemanticExecution?: (load: (admitted: () => boolean) => Promise<SemanticInput>, owner: AbortSignal) => SemanticExecution | null; createPlanningProposal?: (load: (admitted: () => boolean) => Promise<ReturnType<PlanningDraft["read"]>>, owner: AbortSignal) => PlanningProposalExecution | null };
type AnalysisLease = { invalidated: boolean; batch?: AnalysisBatch; timer: ReturnType<typeof setTimeout>; onAbort: () => void };
const equalPath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const safeError = (error: unknown) => error instanceof PlanningProposalError ? { code: error.code, message: error.code === "STALE_INPUT" ? "초안이 변경되어 이전 제안을 적용할 수 없습니다." : "계획 제안 또는 입력을 확인하세요." } : error instanceof PlanningDraftError ? { code: error.code, message: "초안 또는 버전을 확인하세요." } : error instanceof IssueProjectContextError || error instanceof IssueWorkerClientError || error instanceof SelectedDocumentError || error instanceof IssueExportError || error instanceof AnalysisSourceError || error instanceof SourceSessionError
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
  private readonly semanticExecutions = new Map<AbortSignal, { execution: SemanticExecution; load: (admitted: () => boolean) => Promise<SemanticInput>; segmentIndex: number; saved: boolean }>();
  private readonly planningProposals = new Map<AbortSignal, { execution: PlanningProposalExecution; load: (admitted: () => boolean) => Promise<ReturnType<PlanningDraft["read"]>> }>();
  private readonly drafts = new WeakMap<AbortSignal, { projectId: string; draft: PlanningDraft }>();
  private readonly persistedGenerations = new WeakMap<AbortSignal, number>();
  private readonly inspectedDrafts = new WeakMap<AbortSignal, { projectId: string; projectRevision: number; generation: number }>();
  private readonly registeringDrafts = new WeakSet<AbortSignal>();
  private readonly snapshotProjects = new WeakMap<AbortSignal, { snapshotId: string; projectId: string }>();
  constructor(private readonly options: Options) {}
  private now(): number { return this.options.now?.() ?? performance.now(); }
  clearSources(): void { for (const signal of new Set([...this.analysisLeases.keys(), ...this.analysisExecutions.keys(), ...this.semanticExecutions.keys(), ...this.planningProposals.keys()])) this.revokeAnalysis(signal); this.sources.clearAll(); }
  private finishAnalysis(signal: AbortSignal, lease: AnalysisLease): void {
    if (this.analysisLeases.get(signal) !== lease) return;
    clearTimeout(lease.timer); signal.removeEventListener("abort", lease.onAbort); this.analysisLeases.delete(signal);
  }
  private revokeAnalysis(signal: AbortSignal): void {
    const proposal = this.planningProposals.get(signal);
    if (proposal) { proposal.execution.interrupt(); if (proposal.execution.clear()) this.planningProposals.delete(signal); }
    const semantic = this.semanticExecutions.get(signal);
    if (semantic) { semantic.execution.interrupt(); if (semantic.execution.clear()) this.semanticExecutions.delete(signal); }
    const execution = this.analysisExecutions.get(signal);
    if (execution) { execution.interrupt(); if (execution.clear()) { this.analysisExecutions.delete(signal); this.analysisRevisions.delete(signal); this.analysisProjectIds.delete(signal); this.analysisSnapshotIds.delete(signal); } }
    const lease = this.analysisLeases.get(signal);
    if (!lease) return;
    lease.invalidated = true;
    lease.batch?.dispose();
  }
  private revokeView(signal: AbortSignal): void {
    this.views.delete(signal); this.drafts.delete(signal); this.persistedGenerations.delete(signal); this.inspectedDrafts.delete(signal); this.revokeAnalysis(signal); this.sources.clear(signal); this.snapshotProjects.delete(signal);
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
      if (message.type === "issues.draft.persist") action = "draftPersist";
      if (message.type === "issues.draft.restore") action = "draftRestore";
      if (message.type === "issues.draft.inspectSaved") action = "draftInspectSaved";
      if (message.type === "issues.draft.rebase") action = "draftRebase";
      if (message.type === "issues.draft.copy") action = "draftCopy";
      if (message.type === "issues.semantic.start") action = "semanticStart";
      if (message.type === "issues.semantic.status") action = "semanticStatus";
      if (message.type === "issues.semantic.interrupt") action = "semanticInterrupt";
      if (message.type === "issues.semantic.clear") action = "semanticClear";
      if (message.type === "issues.semantic.save") action = "semanticSave";
      if (message.type === "issues.semantic.review") action = "semanticReview";
      if (message.type === "issues.plan.start") action = "planStart";
      if (message.type === "issues.plan.status") action = "planStatus";
      if (message.type === "issues.plan.interrupt") action = "planInterrupt";
      if (message.type === "issues.plan.clear") action = "planClear";
      if (message.type === "issues.plan.apply") action = "planApply";
      if (typeof message.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(message.clientRequestId)) clientRequestId = message.clientRequestId;
      if (!uiOrigin || !clientRequestId || message.v !== 1 || !["issues.project.status", "issues.project.bind", "issues.document.import", "issues.document.export", "issues.view.authorize", "issues.view.query", "issues.view.release", "issues.sources.add", "issues.sources.list", "issues.sources.read", "issues.sources.remove", "issues.analysis.prepare", "issues.analysis.check", "issues.analysis.status", "issues.analysis.start", "issues.analysis.interrupt", "issues.analysis.clear", "issues.analysis.segment", "issues.analysis.retry", "issues.draft.create", "issues.draft.read", "issues.draft.replace", "issues.draft.review", "issues.draft.register", "issues.draft.persist", "issues.draft.restore", "issues.draft.inspectSaved", "issues.draft.rebase", "issues.draft.copy", "issues.semantic.start", "issues.semantic.status", "issues.semantic.interrupt", "issues.semantic.clear", "issues.semantic.save", "issues.semantic.review", "issues.plan.start", "issues.plan.status", "issues.plan.interrupt", "issues.plan.clear", "issues.plan.apply"].includes(String(message.type)) || Object.keys(message).some(key => !["type", "v", "clientRequestId", ...(action === "view" ? ["query"] : []), ...(["draftCreate", "draftReplace"].includes(action) ? ["document"] : []), ...(action === "draftReview" ? ["review"] : []), ...(["draftReplace", "draftReview", "draftRegister", "draftPersist", "semanticSave", "semanticReview", "planStart", "planApply"].includes(action) ? ["draftRevision"] : []), ...(action === "semanticReview" ? ["findingId", "decision", "reason"] : []), ...(action === "planStart" ? ["request"] : []), ...(action === "planApply" ? ["proposalId"] : []), ...(action === "draftCreate" ? ["expectedRevision"] : []), ...(action === "export" ? ["documentId", "expectedRevision"] : []), ...(["sourceRead", "sourceRemove"].includes(action) ? ["sourceId"] : []), ...(action === "sourceRead" || action === "analysisSegment" ? ["offset"] : []), ...(["analysisSegment", "analysisRetry"].includes(action) ? ["index"] : []), ...(action === "snapshotPrepare" ? ["expectedRevision", "expectedSources", "instruction"] : []), ...(["snapshotCheck", "analysisStart", "semanticStart"].includes(action) ? ["snapshotId", "expectedRevision"] : []), ...(action === "semanticStart" ? ["index", "draftRevision"] : [])].includes(key))) throw new Error("invalid");
      if (action === "export" && (!id(message.documentId) || !Number.isSafeInteger(message.expectedRevision) || Number(message.expectedRevision) < 1)) throw new Error("invalid");
      if ((action === "sourceRead" || action === "sourceRemove") && (!id(message.sourceId) || !String(message.sourceId).startsWith("source_") || action === "sourceRead" && (!Number.isSafeInteger(message.offset) || Number(message.offset) < 0))) throw new Error("invalid");
      if ((action === "snapshotCheck" || action === "analysisStart" || action === "semanticStart") && (typeof message.snapshotId !== "string" || !/^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(message.snapshotId) || !Number.isSafeInteger(message.expectedRevision) || Number(message.expectedRevision) < 1)) throw new Error("invalid");
      if ((action === "analysisSegment" || action === "analysisRetry") && (!Number.isSafeInteger(message.index) || Number(message.index) < 0 || Number(message.index) >= 2048 || action === "analysisSegment" && (!Number.isSafeInteger(message.offset) || Number(message.offset) < 0 || Number(message.offset) > 512))) throw new Error("invalid");
      if (signal?.aborted || !connected()) throw new IssueProjectContextError("STALE_SELECTION", "연결이 끊겨 이슈 요청을 취소했습니다.");
      if (action === "status") return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: Boolean((await this.options.context().status()).project) };
      if (["planStart", "planStatus", "planInterrupt", "planClear", "planApply"].includes(action)) {
        const grant = this.activeView(signal, connected);
        if (!signal || !grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "계획 제안을 보려면 프로젝트를 다시 확인하세요.");
        const project = await this.options.context().status();
        if (this.activeView(signal, connected) !== grant || !project.project || project.project.id !== grant.projectId) throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다.");
        let owned = this.planningProposals.get(signal);
        if (action === "planStart") {
          if (owned || !this.options.createPlanningProposal) throw new AnalysisSourceError("BUSY", "이전 제안을 정리하거나 실행 가능 상태를 확인하세요.");
          if (!Number.isSafeInteger(message.draftRevision) || Number(message.draftRevision) < 1 || typeof message.request !== "string" || !message.request.trim() || message.request.length > 1024 || Buffer.byteLength(message.request, "utf8") > 4096 || message.request.includes("\0")) throw new PlanningDraftError("INVALID_INPUT");
          const entry = this.drafts.get(signal), projectId = project.project.id, revision = project.project.revision, draftRevision = Number(message.draftRevision);
          if (!entry || entry.projectId !== projectId || entry.draft.projectRevision !== revision || entry.draft.read().revision !== draftRevision) throw new PlanningDraftError("VERSION_CONFLICT");
          if (!entry.draft.hasConversationCapacity(2)) throw new PlanningDraftError("LIMIT_EXCEEDED");
          const load = async (admitted: () => boolean) => {
            const valid = () => admitted() && this.activeView(signal, connected) === grant && this.drafts.get(signal) === entry && entry.draft.read().revision === draftRevision;
            if (!valid()) throw new AnalysisSourceError("STALE_INPUT", "초안 또는 보기 권한이 변경되었습니다.");
            const current = await this.options.context().status();
            if (!valid() || !current.project || current.project.id !== projectId || current.project.revision !== revision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 초안이 변경되었습니다.");
            return entry.draft.read();
          };
          const execution = this.options.createPlanningProposal(load, signal);
          if (!execution) throw new AnalysisSourceError("BUSY", "안전한 계획 제안 실행을 확인할 수 없습니다.");
          owned = { execution, load }; this.planningProposals.set(signal, owned);
          const pending = execution.start(message.request);
          if (execution.status().state === "idle") { this.planningProposals.delete(signal); await pending.catch(() => {}); throw new AnalysisSourceError("BUSY", "계획 제안을 시작할 수 없습니다."); }
          try { entry.draft.addConversation(draftRevision, "user", message.request); }
          catch (error) { execution.interrupt(); void pending.finally(() => { if (execution.clear()) this.planningProposals.delete(signal); }).catch(() => {}); throw error; }
          const selected = owned;
          void pending.finally(() => {
            const status = selected.execution.status();
            if (status.result && this.activeView(signal, connected) === grant && this.drafts.get(signal) === entry && entry.draft.read().revision === draftRevision) {
              const message = status.result.proposals.length ? status.result.proposals.map(item => `${item.targetId} · ${item.field}\n제안: ${item.after}\n근거: ${item.reason}\n불확실성: ${item.uncertainty}`).join("\n\n") : "변경 제안이 없습니다. 초안이 완전하다는 뜻은 아닙니다.";
              try { entry.draft.addConversation(draftRevision, "assistant", message); } catch { selected.execution.failRecording(); }
            }
            if (!this.activeView(signal, connected) && selected.execution.clear()) this.planningProposals.delete(signal);
          }).catch(() => {});
        } else if (action === "planInterrupt") {
          if (!owned?.execution.interrupt()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "NOT_RUNNING", message: "중단할 제안이 없습니다." } };
        } else if (action === "planClear") {
          if (!owned?.execution.clear()) throw new AnalysisSourceError("BUSY", "제안 작업이 완전히 끝난 뒤 정리하세요.");
          this.planningProposals.delete(signal); owned = undefined;
        } else if (action === "planApply") {
          if (!owned || owned.execution.busy || this.options.busy() || !Number.isSafeInteger(message.draftRevision) || Number(message.draftRevision) < 1 || !id(message.proposalId)) throw new PlanningDraftError("INVALID_INPUT");
          const entry = this.drafts.get(signal); if (!entry || entry.projectId !== project.project.id || entry.draft.projectRevision !== project.project.revision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 초안이 변경되었습니다.");
          await owned.load(() => !this.options.busy());
          if (this.activeView(signal, connected) !== grant || this.drafts.get(signal) !== entry || this.planningProposals.get(signal) !== owned || this.options.busy()) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 제안이 변경되었습니다.");
          owned.execution.apply(entry.draft, Number(message.draftRevision), message.proposalId);
          this.planningProposals.delete(signal);
          return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, draft: entry.draft.read() };
        } else if (owned?.execution.status().result) {
          if (this.options.busy()) throw new AnalysisSourceError("BUSY", "다른 작업이 끝난 뒤 제안을 확인하세요.");
          try { await owned.load(() => !this.options.busy()); } catch { owned.execution.clear(); this.planningProposals.delete(signal); throw new AnalysisSourceError("STALE_INPUT", "초안이 변경되어 제안을 표시하지 않습니다."); }
          if (this.planningProposals.get(signal) !== owned) throw new AnalysisSourceError("STALE_INPUT", "제안이 변경되었습니다.");
        }
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, planStatus: owned?.execution.status() ?? { state: "idle", result: null } };
      }
      if (action === "semanticSave" || action === "semanticReview") {
        const grant = this.activeView(signal, connected);
        if (!signal || !grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "검증을 기록하려면 프로젝트를 다시 확인하세요.");
        if (!Number.isSafeInteger(message.draftRevision) || Number(message.draftRevision) < 1) throw new PlanningDraftError("INVALID_INPUT");
        const project = await this.options.context().status(), entry = this.drafts.get(signal);
        if (this.activeView(signal, connected) !== grant || !project.project || project.project.id !== grant.projectId || !entry || entry.projectId !== project.project.id || entry.draft.projectRevision !== project.project.revision || entry.draft.read().revision !== message.draftRevision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 초안이 변경되었습니다.");
        if (this.options.busy() || this.registeringDrafts.has(signal)) throw new AnalysisSourceError("BUSY", "진행 중인 작업이 끝난 뒤 기록하세요.");
        if (action === "semanticReview") {
          if (!id(message.findingId) || !(message.decision === "resolved" || message.decision === "deferred") || typeof message.reason !== "string" || !message.reason.trim() || message.reason.length > 2000 || message.reason.includes("\0")) throw new PlanningDraftError("INVALID_INPUT");
          const source = entry.draft.semanticSource(Number(message.draftRevision), message.findingId);
          const selected = this.sources.list(signal, grant.generation, grant.path).items.find(item => item.relativePath === source.sourcePath && item.sha256 === source.sourceSha256 && item.projectRevision === project.project!.revision);
          if (!selected) throw new AnalysisSourceError("STALE_INPUT", "검증 원본을 다시 선택하고 내용을 확인하세요.");
          let actual: Awaited<ReturnType<Options["readSource"]>>;
          try { actual = await this.options.readSource(grant.path, path.resolve(grant.path, ...selected.relativePath.split("/")), signal); } catch { throw new AnalysisSourceError("STALE_INPUT", "검증 원본을 확인할 수 없습니다."); }
          const current = await this.options.context().status();
          const stillSelected = this.sources.list(signal, grant.generation, grant.path).items.some(item => item.id === selected.id && item.relativePath === selected.relativePath && item.sha256 === selected.sha256 && item.bytes === selected.bytes && item.projectRevision === selected.projectRevision);
          if (this.activeView(signal, connected) !== grant || this.drafts.get(signal) !== entry || entry.draft.read().revision !== message.draftRevision || !current.project || current.project.id !== project.project.id || current.project.revision !== project.project.revision || this.options.busy() || this.registeringDrafts.has(signal) || !stillSelected || actual.relativePath !== selected.relativePath || actual.sha256 !== selected.sha256 || actual.bytes !== selected.bytes) throw new AnalysisSourceError("STALE_INPUT", "자료 또는 초안이 변경되어 검토를 기록하지 않았습니다.");
          entry.draft.reviewSemantic(Number(message.draftRevision), message.findingId, message.decision, message.reason);
        } else {
          const owned = this.semanticExecutions.get(signal), result = owned?.execution.status().result;
          if (!owned || !result || owned.saved || owned.execution.busy) throw new AnalysisSourceError("BUSY", "기록할 현재 검증 결과가 없습니다.");
          await owned.load(() => !this.options.busy());
          if (this.activeView(signal, connected) !== grant || this.drafts.get(signal) !== entry || this.semanticExecutions.get(signal) !== owned || owned.saved || this.options.busy()) throw new AnalysisSourceError("STALE_INPUT", "자료 또는 초안이 변경되어 결과를 기록하지 않았습니다.");
          entry.draft.addSemanticResult(Number(message.draftRevision), owned.segmentIndex, result); owned.saved = true;
        }
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, draft: entry.draft.read() };
      }
      if (["semanticStart", "semanticStatus", "semanticInterrupt", "semanticClear"].includes(action)) {
        const grant = this.activeView(signal, connected);
        if (!signal || !grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "의미 검증을 보려면 프로젝트를 다시 확인하세요.");
        const project = await this.options.context().status();
        if (this.activeView(signal, connected) !== grant || !project.project || project.project.id !== grant.projectId) throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다.");
        let owned = this.semanticExecutions.get(signal);
        if (action === "semanticStart") {
          if (owned || !this.options.createSemanticExecution) throw new AnalysisSourceError("BUSY", "이전 검증을 정리하거나 실행 가능 상태를 확인하세요.");
          if (!Number.isSafeInteger(message.index) || Number(message.index) < 0 || Number(message.index) >= 2048 || !Number.isSafeInteger(message.draftRevision) || Number(message.draftRevision) < 1 || project.project.revision !== Number(message.expectedRevision)) throw new PlanningDraftError("INVALID_INPUT");
          const entry = this.drafts.get(signal), snapshotId = String(message.snapshotId), revision = project.project.revision, projectId = project.project.id, index = Number(message.index), draftRevision = Number(message.draftRevision);
          if (!entry || entry.projectId !== projectId || entry.draft.projectRevision !== revision || entry.draft.read().revision !== draftRevision) throw new PlanningDraftError("VERSION_CONFLICT");
          const prepared = this.snapshotProjects.get(signal);
          if (!prepared || prepared.projectId !== projectId || prepared.snapshotId !== snapshotId) throw new AnalysisSourceError("STALE_INPUT", "분석 입력을 다시 준비하세요.");
          this.sources.analysisSegment(signal, grant.generation, grant.path, revision, snapshotId, index);
          const load = async (admitted: () => boolean): Promise<SemanticInput> => {
            const valid = () => admitted() && this.activeView(signal, connected) === grant && this.drafts.get(signal) === entry && entry.draft.read().revision === draftRevision;
            if (!valid()) throw new AnalysisSourceError("STALE_INPUT", "초안 또는 보기 권한이 변경되었습니다.");
            const files = this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
            for (const file of files) {
              let actual: Awaited<ReturnType<Options["readSource"]>>;
              try { actual = await this.options.readSource(grant.path, path.resolve(grant.path, ...file.relativePath.split("/")), signal); } catch { throw new AnalysisSourceError("STALE_INPUT", "자료 원본을 확인할 수 없습니다."); }
              if (!valid() || actual.relativePath !== file.relativePath || actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new AnalysisSourceError("STALE_INPUT", "자료 또는 초안이 변경되었습니다.");
              this.sources.snapshotFiles(signal, grant.generation, grant.path, revision, snapshotId);
            }
            const current = await this.options.context().status();
            if (!valid() || !current.project || current.project.id !== projectId || current.project.revision !== revision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 초안이 변경되었습니다.");
            return { projectRevision: revision, draftRevision, document: entry.draft.read().document, segment: this.sources.analysisSegment(signal, grant.generation, grant.path, revision, snapshotId, index) };
          };
          const execution = this.options.createSemanticExecution(load, signal);
          if (!execution) throw new AnalysisSourceError("BUSY", "안전한 의미 검증 실행을 확인할 수 없습니다.");
          owned = { execution, load, segmentIndex: index, saved: false }; this.semanticExecutions.set(signal, owned);
          const pending = execution.start();
          if (execution.status().state === "idle") { this.semanticExecutions.delete(signal); await pending.catch(() => {}); throw new AnalysisSourceError("BUSY", "의미 검증을 시작할 수 없습니다."); }
          const selected = owned;
          void pending.finally(() => { if (!this.activeView(signal, connected) && selected.execution.clear()) this.semanticExecutions.delete(signal); }).catch(() => {});
        } else if (action === "semanticInterrupt") {
          if (!owned?.execution.interrupt()) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: false, error: { code: "NOT_RUNNING", message: "중단할 검증이 없습니다." } };
        } else if (action === "semanticClear") {
          if (!owned?.execution.clear()) throw new AnalysisSourceError("BUSY", "검증이 완전히 끝난 뒤 정리하세요.");
          this.semanticExecutions.delete(signal); owned = undefined;
        } else if (owned?.execution.status().result) {
          if (this.options.busy()) throw new AnalysisSourceError("BUSY", "다른 작업이 끝난 뒤 결과를 확인하세요.");
          try { await owned.load(() => !this.options.busy()); }
          catch { owned.execution.clear(); this.semanticExecutions.delete(signal); throw new AnalysisSourceError("STALE_INPUT", "자료 또는 초안이 변경되어 검증 결과를 표시하지 않습니다."); }
          if (this.semanticExecutions.get(signal) !== owned) throw new AnalysisSourceError("STALE_INPUT", "검증 결과가 변경되었습니다.");
        }
        return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, semanticStatus: owned?.execution.status() ?? { state: "idle", result: null } };
      }
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
      if (["draftCreate", "draftRead", "draftReplace", "draftReview", "draftRegister", "draftPersist", "draftRestore", "draftInspectSaved", "draftRebase", "draftCopy"].includes(action)) {
        const grant = this.activeView(signal, connected);
        if (!signal || !grant) throw new IssueExportError("VIEW_AUTH_REQUIRED", "초안을 보려면 프로젝트를 다시 확인하세요.");
        const context = this.options.context(), project = await context.status();
        if (this.activeView(signal, connected) !== grant || !project.project || project.project.id !== grant.projectId) {
          this.revokeView(signal); throw new IssueExportError("VIEW_AUTH_REQUIRED", "프로젝트 또는 보기 권한이 변경되었습니다.");
        }
        const allowed = () => this.activeView(signal, connected) === grant && !this.options.busy();
        if ((this.semanticExecutions.get(signal)?.execution.busy || this.planningProposals.get(signal)?.execution.busy) && action !== "draftRead") throw new AnalysisSourceError("BUSY", "분석 또는 제안 작업이 끝난 뒤 초안을 변경하세요.");
        if (this.registeringDrafts.has(signal)) throw new AnalysisSourceError("BUSY", "초안 등록이 끝날 때까지 기다리세요.");
        if (["draftReplace", "draftReview", "draftRegister", "draftPersist"].includes(action) && (!Number.isSafeInteger(message.draftRevision) || Number(message.draftRevision) < 1)) throw new PlanningDraftError("INVALID_INPUT");
        let entry = this.drafts.get(signal);
        if (entry && (entry.projectId !== project.project.id || entry.draft.projectRevision !== project.project.revision)) {
          // Keep unsaved work in memory. A revision conflict must not silently
          // destroy it; the stale draft cannot be changed or registered here.
          if (action === "draftRead" && entry.projectId === project.project.id) return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, draft: entry.draft.read() };
          if (action === "draftRebase" && entry.projectId === project.project.id && allowed()) {
            const recovered = PlanningDraft.rebase(entry.draft.read(), project.project.revision);
            this.drafts.set(signal, { projectId: entry.projectId, draft: recovered });
            return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, draft: recovered.read() };
          }
          throw new PlanningDraftError("VERSION_CONFLICT");
        }
        if (action === "draftInspectSaved" || action === "draftRebase" || action === "draftCopy") {
          if (entry) throw new AnalysisSourceError("BUSY", "현재 초안을 먼저 정리하세요. 저장된 초안으로 덮어쓰지 않습니다.");
          if (!context.readPlanningDraft || !allowed()) throw new AnalysisSourceError("BUSY", "저장된 초안을 지금 확인할 수 없습니다.");
          const inspected = this.inspectedDrafts.get(signal);
          if ((action === "draftRebase" || action === "draftCopy") && (!inspected || inspected.projectId !== project.project.id || inspected.projectRevision !== project.project.revision)) throw new AnalysisSourceError("STALE_INPUT", "저장된 초안을 먼저 다시 확인하세요.");
          this.registeringDrafts.add(signal);
          try {
            const saved = await context.readPlanningDraft(project.project, allowed);
            if (!allowed() || this.drafts.has(signal)) throw new IssueExportError("STALE_SELECTION", "보기 권한 또는 초안이 변경되었습니다.");
            if (!saved) throw new PlanningDraftError("NOT_FOUND");
            if (action === "draftInspectSaved") {
              this.inspectedDrafts.set(signal, { projectId: project.project.id, projectRevision: project.project.revision, generation: saved.generation });
              return { type: "issues.project.result", v: 1, clientRequestId, action, ok: true, bound: true, draft: saved.snapshot, savedStale: saved.stale };
            }
            if ((action === "draftRebase" && !saved.stale) || !inspected || inspected.generation !== saved.generation) throw new AnalysisSourceError("STALE_INPUT", "저장된 초안이 변경되었습니다. 다시 확인하세요.");
            entry = { projectId: project.project.id, draft: action === "draftCopy" ? PlanningDraft.copyAsNew(saved.snapshot, project.project.revision) : PlanningDraft.rebase(saved.snapshot, project.project.revision) };
            this.persistedGenerations.set(signal, saved.generation); this.inspectedDrafts.delete(signal); this.drafts.set(signal, entry);
          } finally { this.registeringDrafts.delete(signal); }
        } else if (action === "draftRestore") {
          if (entry) throw new AnalysisSourceError("BUSY", "현재 초안을 먼저 정리하세요. 저장된 초안으로 덮어쓰지 않습니다.");
          if (!context.readPlanningDraft || !allowed()) throw new AnalysisSourceError("BUSY", "저장된 초안을 지금 불러올 수 없습니다.");
          this.registeringDrafts.add(signal);
          try {
            const saved = await context.readPlanningDraft(project.project, allowed);
            if (!allowed() || this.drafts.has(signal)) throw new IssueExportError("STALE_SELECTION", "보기 권한 또는 초안이 변경되었습니다.");
            if (!saved) throw new PlanningDraftError("NOT_FOUND");
            if (saved.stale) throw new AnalysisSourceError("STALE_INPUT", "저장된 초안 이후 프로젝트가 변경되었습니다. 기존 초안은 보존되었으며 자동으로 적용하지 않습니다.");
            entry = { projectId: project.project.id, draft: PlanningDraft.restore(saved.snapshot) };
            this.persistedGenerations.set(signal, saved.generation); this.drafts.set(signal, entry);
          } finally { this.registeringDrafts.delete(signal); }
        } else if (action === "draftCreate") {
          if (entry) throw new AnalysisSourceError("BUSY", "기존 초안이 있습니다. 보기 권한을 종료하면 삭제됩니다.");
          if (message.expectedRevision !== project.project.revision) throw new PlanningDraftError("VERSION_CONFLICT");
          entry = { projectId: project.project.id, draft: new PlanningDraft(message.document, project.project.revision) };
          this.drafts.set(signal, entry);
        } else {
          if (!entry) throw new PlanningDraftError("NOT_FOUND");
          if (action === "draftReplace") entry.draft.replace(Number(message.draftRevision), message.document);
          if (action === "draftReview") entry.draft.review(Number(message.draftRevision), message.review);
          if (action === "draftPersist") {
            if (!context.savePlanningDraft || !allowed()) throw new AnalysisSourceError("BUSY", "초안을 지금 저장할 수 없습니다.");
            const snapshot = entry.draft.read();
            if (snapshot.revision !== message.draftRevision) throw new PlanningDraftError("VERSION_CONFLICT");
            const release = this.options.tryAcquireWrite();
            if (!release) throw new AnalysisSourceError("BUSY", "다른 작업이 끝난 뒤 저장하세요.");
            this.registeringDrafts.add(signal);
            try {
              const generation = await context.savePlanningDraft(project.project, this.persistedGenerations.get(signal) ?? 0, snapshot, allowed);
              if (!allowed() || this.drafts.get(signal) !== entry) throw new IssueExportError("OUTCOME_UNKNOWN", "초안 저장 결과를 확인할 수 없습니다. 다시 조회하세요.");
              this.persistedGenerations.set(signal, generation);
            } finally { this.registeringDrafts.delete(signal); release(); }
          }
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
              // Only files explicitly selected in this connection may be reopened.
              // The draft comes from the renderer and cannot authorize a path.
              const draftSources = entry.draft.read().document.sources;
              const draftProjectRevision = entry.draft.projectRevision;
              const selected = this.sources.list(signal, grant.generation, grant.path).items;
              for (const source of draftSources) {
                // Source IDs are connection-scoped and change after restoring a
                // draft. The server-owned selection, path and hash authorize the
                // recheck; the stored ID itself grants no file access.
                const item = selected.find(value => value.relativePath === source.name && `sha256:${value.sha256}` === source.contentHash && value.projectRevision === draftProjectRevision);
                if (!item) throw new AnalysisSourceError("STALE_INPUT", "초안의 원본 자료를 다시 선택하고 분석해야 합니다.");
                let original: Awaited<ReturnType<typeof this.options.readSource>>;
                try { original = await this.options.readSource(grant.path, path.resolve(grant.path, ...item.relativePath.split("/")), signal); }
                catch { throw new AnalysisSourceError("STALE_INPUT", "초안의 원본 자료를 확인할 수 없습니다. 다시 선택하고 분석하세요."); }
                const stillSelected = this.sources.list(signal, grant.generation, grant.path).items.some(value => value.id === item.id && value.relativePath === item.relativePath && value.sha256 === item.sha256 && value.bytes === item.bytes && value.projectRevision === item.projectRevision);
                if (!allowed() || this.drafts.get(signal) !== entry || !stillSelected || original.relativePath !== item.relativePath || original.bytes !== item.bytes || original.sha256 !== item.sha256) throw new AnalysisSourceError("STALE_INPUT", "초안의 원본 자료 또는 작업 상태가 변경되었습니다. 다시 선택하고 분석하세요.");
              }
              const current = await context.status();
              if (!allowed() || this.drafts.get(signal) !== entry || !current.project || current.project.id !== entry.projectId || current.project.revision !== project.project.revision) throw new AnalysisSourceError("STALE_INPUT", "프로젝트 또는 초안이 변경되어 등록하지 않았습니다.");
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
      if (signal && this.semanticExecutions.get(signal)?.execution.busy && (action === "sourceAdd" || action === "sourceRemove" || action === "snapshotPrepare")) throw new AnalysisSourceError("BUSY", "의미 검증이 끝난 뒤 자료를 변경하세요.");
      if (signal && this.registeringDrafts.has(signal) && (action === "sourceAdd" || action === "sourceRemove" || action === "snapshotPrepare")) throw new AnalysisSourceError("BUSY", "초안 등록이 끝난 뒤 자료를 변경하세요.");
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
        if ((this.registeringDrafts.has(signal) || this.semanticExecutions.get(signal)?.execution.busy) && (action === "sourceRemove" || action === "snapshotPrepare")) throw new AnalysisSourceError("BUSY", "초안 등록 또는 의미 검증이 끝난 뒤 자료를 변경하세요.");
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
          if (this.analysisLeases.has(signal) || this.registeringDrafts.has(signal) || this.semanticExecutions.get(signal)?.execution.busy) throw new AnalysisSourceError("BUSY", "분석 또는 초안 등록이 끝난 뒤 자료를 변경하세요.");
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
