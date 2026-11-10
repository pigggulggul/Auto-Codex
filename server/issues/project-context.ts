import { IssueWorkerClientError } from "./worker-client.js";
import type { IssueWorkerRequest, IssueWorkerResult } from "./worker-contract.js";
import type { IssueViewQuery, IssueViewResult } from "../../shared/issues/view.js";
import { freezeExecutionPolicy, type ExecutionIntentInput, type FrozenExecutionIntent } from "./execution-intent.js";
import type { JournalRecord } from "./execution-journal.js";
import type { ExecutionApprovalRouter } from "./execution-approval-router.js";
import type { PlanningDraft } from "./planning-draft.js";

/** Supplied by the bridge, never constructed from an individual renderer message. */
export type IssueProjectSelection = {
  workspaceMode: "project" | "research";
  projectPath: string | null;
  /** Increment on every selection/mode change, including switching away and back. */
  generation: number;
};
type SelectedProject = IssueProjectSelection & { workspaceMode: "project"; projectPath: string };
type Worker = { request(input: IssueWorkerRequest, mayStart?: () => boolean): Promise<IssueWorkerResult> };
export class IssueProjectContextError extends Error {
  constructor(readonly code: "PROJECT_REQUIRED" | "PROJECT_UNBOUND" | "STALE_SELECTION" | "WORKER_UNAVAILABLE", message: string) { super(message); }
}

/** Internal context binding; this class does not authenticate a user action or authorize a client. */
export class IssueProjectContext {
  constructor(private readonly currentSelection: () => IssueProjectSelection, private readonly worker: Worker) {}

  private capture(): SelectedProject {
    const current = this.currentSelection();
    if (current.workspaceMode !== "project" || !current.projectPath || !Number.isSafeInteger(current.generation) || current.generation < 0) throw new IssueProjectContextError("PROJECT_REQUIRED", "이슈 작업을 위한 프로젝트 폴더를 선택하세요.");
    return { workspaceMode: "project", projectPath: current.projectPath, generation: current.generation };
  }
  private verify(selection: SelectedProject): void {
    const now = this.currentSelection();
    if (now.workspaceMode !== "project" || now.generation !== selection.generation || now.projectPath !== selection.projectPath) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 선택이 변경되었습니다. 이전 프로젝트에 저장된 상태를 확인하세요.");
  }
  private async request(selection: SelectedProject, message: IssueWorkerRequest, mayStart: () => boolean = () => true): Promise<IssueWorkerResult> {
    const mutating = message.operation === "planning.save" || message.operation === "project.create" || message.operation === "document.import" || message.operation === "execution.prepare" || message.operation === "execution.transition" || message.operation === "execution.approval" || message.operation === "execution.invalidateApprovals" || message.operation === "execution.reconcile";
    this.verify(selection);
    try {
      const result = await this.worker.request(message, () => { const now = this.currentSelection(); return now.workspaceMode === "project" && now.projectPath === selection.projectPath && now.generation === selection.generation && mayStart(); });
      try { this.verify(selection); }
      catch (error) {
        if (mutating) throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "요청이 이전 프로젝트에 적용되었을 수 있습니다. 상태를 확인한 뒤 다시 시도하세요.");
        throw error;
      }
      return result;
    }
    catch (error) {
      // Do not hide an uncertain mutation outcome when the selection changes concurrently.
      if (!mutating) this.verify(selection);
      throw error;
    }
  }

  /** Trusted runtime only: a view grant does not itself authorize execution. */
  async prepareExecution(input: { documentId: string; issueId: string; expectedRevision: number; idempotencyKey: string; policy: ExecutionIntentInput["policy"] }, expectedProjectId: string, mayStart: () => boolean): Promise<{ intent: FrozenExecutionIntent; record: JournalRecord; created: boolean }> {
    const fixed = { documentId: input.documentId, issueId: input.issueId, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, policy: freezeExecutionPolicy(input.policy) };
    const allowed = () => { try { return mayStart() === true; } catch { return false; } };
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project || project.id !== expectedProjectId || project.revision !== fixed.expectedRevision || !allowed()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 실행 권한이 변경되었습니다.");
    const result = await this.request(selected, { operation: "execution.prepare", projectId: project.id, ...fixed }, allowed);
    if (!allowed()) throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "시도 준비 결과를 확인하지 못했습니다. 상태를 확인하세요.");
    if (result.kind !== "execution.prepare") throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "시도 준비 결과를 확인하지 못했습니다. 상태를 확인하세요.");
    return { intent: result.intent, record: result.record, created: result.created };
  }

  /** Only a runtime owning the actual event and admission may call this. */
  async transitionExecution(input: Extract<IssueWorkerRequest, { operation: "execution.transition" }>, expectedProjectId: string, mayStart: () => boolean): Promise<JournalRecord> {
    const fixed = { ...input, action: { ...input.action } };
    const allowed = () => { try { return mayStart() === true; } catch { return false; } };
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project || project.id !== expectedProjectId || fixed.projectId !== project.id || project.revision !== fixed.expectedRevision || !allowed()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 실행 권한이 변경되었습니다.");
    const result = await this.request(selected, fixed, allowed);
    if (!allowed()) throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "시도 기록 결과를 확인하지 못했습니다. 상태를 확인하세요.");
    if (result.kind !== "execution.transition") throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "시도 기록 결과를 확인하지 못했습니다. 상태를 확인하세요.");
    return result.record;
  }

  /** Correlation and the actual pending request must be checked by the owning runtime. */
  async recordExecutionApproval(input: Extract<IssueWorkerRequest, { operation: "execution.approval" }>, expectedProjectId: string, mayStart: () => boolean): Promise<void> {
    const fixed = { ...input, binding: { ...input.binding }, action: { ...input.action } };
    const allowed = () => { try { return mayStart() === true; } catch { return false; } };
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project || project.id !== expectedProjectId || fixed.binding.projectId !== project.id || project.revision !== fixed.expectedRevision || !allowed()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 승인 요청이 변경되었습니다.");
    const result = await this.request(selected, fixed, allowed);
    if (!allowed()) throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "승인 기록 결과를 확인하지 못했습니다. 자동 재전송하지 마세요.");
    if (result.kind !== "execution.approval") throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "승인 기록 결과를 확인하지 못했습니다. 자동 재전송하지 마세요.");
  }

  /** Trusted bridge only. mayReconcile must verify exclusive admission, actual
   * previous-process termination and explicit review; the callback is not proof. */
  async reconcileExecution(input: { projectId: string; attemptId: string; expectedRevision: number; reason: string }, mayReconcile: () => boolean): Promise<JournalRecord> {
    const fixed = { projectId: input.projectId, attemptId: input.attemptId, expectedRevision: input.expectedRevision, reason: input.reason };
    const allowed = () => { try { return mayReconcile() === true; } catch { return false; } };
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project || project.id !== fixed.projectId || project.revision !== fixed.expectedRevision || !allowed()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 복구 권한이 변경되었습니다.");
    const result = await this.request(selected, { operation: "execution.reconcile", ...fixed }, allowed);
    if (!allowed() || result.kind !== "execution.reconcile") throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "복구 기록 결과를 확인하지 못했습니다. 상태를 다시 확인하세요.");
    return result.record;
  }

  /** Trusted runtime only. The caller must already own shared admission and
   * stop the actual process on unsafe; this method does not establish either. */
  async registerExecutionApprovals(router: ExecutionApprovalRouter, input: { projectId: string; expectedRevision: number; attemptId: string; owner: AbortSignal }, mayRun: () => boolean, unsafe: () => void): Promise<{ bindThread: (threadId: string) => void; bindTurn: (turnId: string) => void; close: () => void }> {
    const fixed = { projectId: input.projectId, expectedRevision: input.expectedRevision, attemptId: input.attemptId, owner: input.owner };
    const selected = this.capture();
    const allowed = () => {
      try { const current = this.currentSelection(); return !fixed.owner.aborted && current.workspaceMode === "project" && current.projectPath === selected.projectPath && current.generation === selected.generation && mayRun() === true; }
      catch { return false; }
    };
    const project = await this.lookup(selected);
    if (!project || project.id !== fixed.projectId || project.revision !== fixed.expectedRevision || !allowed()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 실행 권한이 변경되었습니다.");
    return router.registerLaunching({
      owner: fixed.owner, projectId: fixed.projectId, attemptId: fixed.attemptId, valid: allowed, unsafe,
      persist: (binding, action) => this.recordExecutionApproval({ operation: "execution.approval", binding, expectedRevision: fixed.expectedRevision, action }, fixed.projectId, allowed),
    });
  }
  private async lookup(selection: SelectedProject): Promise<{ id: string; revision: number } | null> {
    const result = await this.request(selection, { operation: "project.lookup", selectedPath: selection.projectPath });
    if (result.kind !== "project.lookup") throw new IssueProjectContextError("WORKER_UNAVAILABLE", "이슈 프로젝트 응답을 확인할 수 없습니다.");
    return result.project;
  }

  /** Read-only lookup. It never creates a binding. */
  async status(): Promise<{ project: { id: string; revision: number } | null }> {
    const selected = this.capture();
    return { project: await this.lookup(selected) };
  }

  /** The bridge owns the view grant and must recheck it after these operations. */
  async readPlanningDraft(expected: { id: string; revision: number }, mayStart: () => boolean) {
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project || project.id !== expected.id || project.revision !== expected.revision || !mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 보기 권한이 변경되었습니다.");
    const result = await this.request(selected, { operation: "planning.read", projectId: project.id, expectedRevision: project.revision }, mayStart);
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "보기 권한이 변경되었습니다.");
    if (result.kind !== "planning.read") throw new IssueProjectContextError("WORKER_UNAVAILABLE", "저장된 초안을 확인할 수 없습니다.");
    return result.draft;
  }
  async savePlanningDraft(expected: { id: string; revision: number }, generation: number, snapshot: ReturnType<PlanningDraft["read"]>, mayStart: () => boolean) {
    const fixed = structuredClone(snapshot), selected = this.capture(), project = await this.lookup(selected);
    if (!project || project.id !== expected.id || project.revision !== expected.revision || !mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트 또는 보기 권한이 변경되었습니다.");
    const result = await this.request(selected, { operation: "planning.save", projectId: project.id, expectedRevision: project.revision, expectedGeneration: generation, snapshot: fixed }, mayStart);
    if (!mayStart() || result.kind !== "planning.save") throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "초안 저장 결과를 확인하지 못했습니다. 다시 조회하세요.");
    return result.generation;
  }

  /** The bridge must authenticate an explicit binding action before calling this method. */
  async bind(): Promise<{ project: { id: string; revision: number }; alreadyBound: boolean }> {
    const selected = this.capture();
    const existing = await this.lookup(selected);
    if (existing) return { project: existing, alreadyBound: true };
    try {
      const result = await this.request(selected, { operation: "project.create", selectedPath: selected.projectPath });
      if (result.kind !== "project") throw new IssueProjectContextError("WORKER_UNAVAILABLE", "이슈 프로젝트 응답을 확인할 수 없습니다.");
      return { project: { id: result.id, revision: result.revision }, alreadyBound: false };
    } catch (error) {
      if (!(error instanceof IssueWorkerClientError) || error.code !== "BINDING_EXISTS") throw error;
      // Another caller may have bound the same still-selected directory. Never rebind on mismatch.
      const bound = await this.lookup(selected);
      if (!bound) throw error;
      return { project: bound, alreadyBound: true };
    }
  }

  /** Import is called only after the bridge has confirmed a native file selection. */
  async importDocument(bytes: Uint8Array, mayStart: () => boolean, expected: { id: string; revision: number }): Promise<{ issueCount: number; alreadyImported: boolean }> {
    const selected = this.capture();
    const project = await this.lookup(selected);
    if (!project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
    if (project.id !== expected.id || project.revision !== expected.revision) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트가 변경되어 가져오기를 중단했습니다.");
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "가져오기를 시작하기 전에 연결 또는 실행 상태가 변경되었습니다.");
    const result = await this.request(selected, { operation: "document.import", projectId: project.id, expectedRevision: project.revision, bytes }, mayStart);
    if (result.kind !== "import") throw new IssueProjectContextError("WORKER_UNAVAILABLE", "이슈 문서 응답을 확인할 수 없습니다.");
    return { issueCount: result.issueCount, alreadyImported: result.alreadyImported };
  }

  /** Serialize the currently bound project's fixed revision; this does not write a file. */
  async exportDocument(documentId: string, expectedRevision: number, mayStart: () => boolean, expectedProjectId: string): Promise<Uint8Array> {
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
    if (project.id !== expectedProjectId) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트가 변경되어 내보내기를 중단했습니다.");
    if (project.revision !== expectedRevision) throw new IssueWorkerClientError("VERSION_CONFLICT", "이슈 목록이 변경되었습니다. 다시 불러오세요.");
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "내보내기 전에 프로젝트 또는 연결 상태가 변경되었습니다.");
    const result = await this.request(selected, { operation: "document.export", projectId: project.id, documentId, expectedRevision }, mayStart);
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "내보내기 전에 프로젝트 또는 연결 상태가 변경되었습니다.");
    if (result.kind !== "document.export") throw new IssueProjectContextError("WORKER_UNAVAILABLE", "내보낼 문서를 확인할 수 없습니다.");
    return result.bytes;
  }

  /** The caller must verify a current, per-connection view grant before and after this call. */
  async view(query: IssueViewQuery, mayStart: () => boolean, expectedProjectId: string): Promise<IssueViewResult> {
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
    if (project.id !== expectedProjectId) throw new IssueProjectContextError("STALE_SELECTION", "프로젝트가 변경되어 이슈 조회를 중단했습니다.");
    if (query.expectedRevision !== undefined && query.expectedRevision !== project.revision) throw new IssueWorkerClientError("VERSION_CONFLICT", "이슈 목록이 변경되었습니다. 다시 불러오세요.");
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "이슈 보기 권한 또는 프로젝트 선택이 변경되었습니다.");
    const base = { projectId: project.id, expectedRevision: project.revision };
    let request: IssueWorkerRequest;
    switch (query.kind) {
      case "documents": request = { operation: "document.list", ...base, limit: 32, ...(query.afterId ? { afterId: query.afterId } : {}) }; break;
      case "executionHistory": request = { operation: "execution.history", ...base, afterId: query.afterId }; break;
      case "issues": request = { operation: "issue.list", ...base, documentId: query.documentId, offset: query.offset, ...(query.filters ? { filters: query.filters } : {}) }; break;
      case "projectIssues": request = { operation: "issue.projectSearch", ...base, cursor: query.cursor, ...(query.filters ? { filters: query.filters } : {}) }; break;
      case "categories": request = { operation: "category.list", ...base, documentId: query.documentId, parentId: query.parentId, offset: query.offset }; break;
      case "diagnostics": request = { operation: "document.diagnostics", ...base, documentId: query.documentId, offset: query.offset }; break;
      case "sourceTrace": request = { operation: "document.sourceTrace", ...base, documentId: query.documentId, offset: query.offset }; break;
      case "requirementDetail": request = { operation: "requirement.detail", ...base, documentId: query.documentId, requirementId: query.requirementId, offset: query.offset }; break;
      case "detail": request = { operation: "issue.detail", ...base, documentId: query.documentId, issueId: query.issueId }; break;
      case "candidatePreview": request = { operation: "issue.candidatePreview", ...base, documentId: query.documentId, issueIds: query.issueIds, ...(query.options ? { options: query.options } : {}) }; break;
      case "criteria": request = { operation: "issue.criteria", ...base, documentId: query.documentId, issueId: query.issueId, offset: query.offset }; break;
      case "requirements": request = { operation: "issue.requirements", ...base, documentId: query.documentId, issueId: query.issueId, offset: query.offset }; break;
      case "dependencies": request = { operation: "issue.dependencies", ...base, documentId: query.documentId, issueId: query.issueId, offset: query.offset }; break;
    }
    const result = await this.request(selected, request, mayStart);
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "이슈 보기 권한 또는 프로젝트 선택이 변경되었습니다.");
    if (query.kind === "documents" && result.kind === "documents") return result;
    if (query.kind === "executionHistory" && result.kind === "execution.history") return { kind: "executionHistory", revision: project.revision, page: result.page };
    if (query.kind === "issues" && result.kind === "issue.list") return { kind: "issues", revision: project.revision, page: result.page };
    if (query.kind === "projectIssues" && result.kind === "issue.projectSearch") return { kind: "projectIssues", revision: project.revision, page: result.page };
    if (query.kind === "categories" && result.kind === "category.list") return { kind: "categories", revision: project.revision, page: result.page };
    if (query.kind === "diagnostics" && result.kind === "document.diagnostics") return { kind: "diagnostics", revision: project.revision, report: result.report };
    if (query.kind === "sourceTrace" && result.kind === "document.sourceTrace") return { kind: "sourceTrace", revision: project.revision, page: result.page };
    if (query.kind === "requirementDetail" && result.kind === "requirement.detail") return { kind: "requirementDetail", revision: project.revision, requirement: result.requirement, page: result.page };
    if (query.kind === "detail" && result.kind === "issue.detail") return { kind: "detail", revision: project.revision, issue: result.issue };
    if (query.kind === "candidatePreview" && result.kind === "issue.candidatePreview") return { kind: "candidatePreview", revision: project.revision, options: query.options ?? { includeRetryable: false, includeFailed: false }, items: result.items };
    if (query.kind === "criteria" && result.kind === "issue.criteria") return { kind: "criteria", revision: project.revision, page: result.page };
    if (query.kind === "requirements" && result.kind === "issue.requirements") return { kind: "requirements", revision: project.revision, page: result.page };
    if (query.kind === "dependencies" && result.kind === "issue.dependencies") return { kind: "dependencies", revision: project.revision, page: result.page };
    throw new IssueProjectContextError("WORKER_UNAVAILABLE", "이슈 목록 응답을 확인할 수 없습니다.");
  }
}
