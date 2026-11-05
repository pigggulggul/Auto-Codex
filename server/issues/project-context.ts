import { IssueWorkerClientError } from "./worker-client.js";
import type { IssueWorkerRequest, IssueWorkerResult } from "./worker-contract.js";
import type { IssueViewQuery, IssueViewResult } from "../../shared/issues/view.js";

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
    this.verify(selection);
    try { const result = await this.worker.request(message, () => { const now = this.currentSelection(); return now.workspaceMode === "project" && now.projectPath === selection.projectPath && now.generation === selection.generation && mayStart(); }); this.verify(selection); return result; }
    catch (error) {
      // Do not hide an uncertain mutation outcome when the selection changes concurrently.
      if (message.operation !== "project.create" && message.operation !== "document.import") this.verify(selection);
      throw error;
    }
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
  async importDocument(bytes: Uint8Array, mayStart: () => boolean): Promise<{ issueCount: number; alreadyImported: boolean }> {
    const selected = this.capture();
    const project = await this.lookup(selected);
    if (!project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "가져오기를 시작하기 전에 연결 또는 실행 상태가 변경되었습니다.");
    const result = await this.request(selected, { operation: "document.import", projectId: project.id, expectedRevision: project.revision, bytes }, mayStart);
    if (result.kind !== "import") throw new IssueProjectContextError("WORKER_UNAVAILABLE", "이슈 문서 응답을 확인할 수 없습니다.");
    return { issueCount: result.issueCount, alreadyImported: result.alreadyImported };
  }

  /** Serialize the currently bound project's fixed revision; this does not write a file. */
  async exportDocument(documentId: string, expectedRevision: number, mayStart: () => boolean): Promise<Uint8Array> {
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
    if (project.revision !== expectedRevision) throw new IssueWorkerClientError("VERSION_CONFLICT", "이슈 목록이 변경되었습니다. 다시 불러오세요.");
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "내보내기 전에 프로젝트 또는 연결 상태가 변경되었습니다.");
    const result = await this.request(selected, { operation: "document.export", projectId: project.id, documentId, expectedRevision }, mayStart);
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "내보내기 전에 프로젝트 또는 연결 상태가 변경되었습니다.");
    if (result.kind !== "document.export") throw new IssueProjectContextError("WORKER_UNAVAILABLE", "내보낼 문서를 확인할 수 없습니다.");
    return result.bytes;
  }

  /** The caller must verify a current, per-connection view grant before and after this call. */
  async view(query: IssueViewQuery, mayStart: () => boolean): Promise<IssueViewResult> {
    const selected = this.capture(), project = await this.lookup(selected);
    if (!project) throw new IssueProjectContextError("PROJECT_UNBOUND", "먼저 현재 프로젝트의 이슈 저장소를 연결하세요.");
    if (query.expectedRevision !== undefined && query.expectedRevision !== project.revision) throw new IssueWorkerClientError("VERSION_CONFLICT", "이슈 목록이 변경되었습니다. 다시 불러오세요.");
    if (!mayStart()) throw new IssueProjectContextError("STALE_SELECTION", "이슈 보기 권한 또는 프로젝트 선택이 변경되었습니다.");
    const base = { projectId: project.id, expectedRevision: project.revision };
    let request: IssueWorkerRequest;
    switch (query.kind) {
      case "documents": request = { operation: "document.list", ...base, limit: 32, ...(query.afterId ? { afterId: query.afterId } : {}) }; break;
      case "issues": request = { operation: "issue.list", ...base, documentId: query.documentId, offset: query.offset, ...(query.filters ? { filters: query.filters } : {}) }; break;
      case "projectIssues": request = { operation: "issue.projectSearch", ...base, cursor: query.cursor, ...(query.filters ? { filters: query.filters } : {}) }; break;
      case "categories": request = { operation: "category.list", ...base, documentId: query.documentId, parentId: query.parentId, offset: query.offset }; break;
      case "diagnostics": request = { operation: "document.diagnostics", ...base, documentId: query.documentId, offset: query.offset }; break;
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
    if (query.kind === "issues" && result.kind === "issue.list") return { kind: "issues", revision: project.revision, page: result.page };
    if (query.kind === "projectIssues" && result.kind === "issue.projectSearch") return { kind: "projectIssues", revision: project.revision, page: result.page };
    if (query.kind === "categories" && result.kind === "category.list") return { kind: "categories", revision: project.revision, page: result.page };
    if (query.kind === "diagnostics" && result.kind === "document.diagnostics") return { kind: "diagnostics", revision: project.revision, report: result.report };
    if (query.kind === "requirementDetail" && result.kind === "requirement.detail") return { kind: "requirementDetail", revision: project.revision, requirement: result.requirement, page: result.page };
    if (query.kind === "detail" && result.kind === "issue.detail") return { kind: "detail", revision: project.revision, issue: result.issue };
    if (query.kind === "candidatePreview" && result.kind === "issue.candidatePreview") return { kind: "candidatePreview", revision: project.revision, options: query.options ?? { includeRetryable: false, includeFailed: false }, items: result.items };
    if (query.kind === "criteria" && result.kind === "issue.criteria") return { kind: "criteria", revision: project.revision, page: result.page };
    if (query.kind === "requirements" && result.kind === "issue.requirements") return { kind: "requirements", revision: project.revision, page: result.page };
    if (query.kind === "dependencies" && result.kind === "issue.dependencies") return { kind: "dependencies", revision: project.revision, page: result.page };
    throw new IssueProjectContextError("WORKER_UNAVAILABLE", "이슈 목록 응답을 확인할 수 없습니다.");
  }
}
