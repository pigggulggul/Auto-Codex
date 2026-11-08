import { IssueDocumentError, MAX_DOCUMENT_BYTES, serializeIssueDocument } from "./document.js";
import { IssueStore, IssueStoreError } from "./store.js";
import type { IssueWorkerErrorCode, IssueWorkerRequest, IssueWorkerResult } from "./worker-contract.js";
import { IssueView } from "./issue-view.js";
import { validCandidateIds, validCandidateOptions, validIssueFilters, validProjectIssueCursor, validProjectIssueFilters } from "../../shared/issues/view.js";
import { freezeExecutionPolicy } from "./execution-intent.js";
import { StoredIntentError } from "./execution-stored-intent.js";
import { ExecutionJournalError } from "./execution-journal.js";
import { ApprovalJournalError } from "./execution-approval-journal.js";

export class IssueWorkerRequestError extends Error {
  readonly code = "INVALID_INPUT";
}
const invalid = (): never => { throw new IssueWorkerRequestError("이슈 저장소 요청 형식이 올바르지 않습니다."); };
const projectId = (value: unknown): value is string => typeof value === "string" && /^project_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const issueId = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const protocolId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);

/** Reject unexpected fields rather than allowing renderer/model data to grow the contract. */
export function validateIssueWorkerRequest(value: unknown): IssueWorkerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  const keys = (allowed: string[]) => { if (Object.keys(v).some(key => !allowed.includes(key))) invalid(); };
  switch (v.operation) {
    case "project.create":
    case "project.lookup":
      keys(["operation", "selectedPath"]);
      if (typeof v.selectedPath !== "string" || !v.selectedPath.trim() || v.selectedPath.length > 32768 || v.selectedPath.includes("\0")) return invalid();
      return v as IssueWorkerRequest;
    case "project.read":
      keys(["operation", "projectId"]); if (!projectId(v.projectId)) return invalid(); return v as IssueWorkerRequest;
    case "execution.history":
      keys(["operation", "projectId", "expectedRevision", "afterId"]); if (!projectId(v.projectId) || !revision(v.expectedRevision) || !(v.afterId === null || issueId(v.afterId))) return invalid(); return v as IssueWorkerRequest;
    case "execution.invalidateApprovals":
      keys(["operation", "projectId", "attemptId", "expectedRevision"]); if (!projectId(v.projectId) || !issueId(v.attemptId) || !revision(v.expectedRevision)) return invalid(); return v as IssueWorkerRequest;
    case "execution.reconcile":
      keys(["operation", "projectId", "attemptId", "expectedRevision", "reason"]); if (!projectId(v.projectId) || !issueId(v.attemptId) || !revision(v.expectedRevision) || typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 2000 || v.reason.includes("\0")) return invalid(); return v as IssueWorkerRequest;
    case "execution.prepare":
      keys(["operation", "projectId", "documentId", "issueId", "expectedRevision", "idempotencyKey", "policy"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !issueId(v.issueId) || !revision(v.expectedRevision) || !issueId(v.idempotencyKey)) return invalid();
      try { freezeExecutionPolicy(v.policy); } catch { return invalid(); }
      return v as IssueWorkerRequest;
    case "execution.transition": {
      keys(["operation", "projectId", "attemptId", "expectedRevision", "action"]);
      if (!projectId(v.projectId) || !issueId(v.attemptId) || !revision(v.expectedRevision) || !v.action || typeof v.action !== "object" || Array.isArray(v.action)) return invalid();
      const a = v.action as Record<string, unknown>;
      const simple = ["dispatch", "verifying", "unknown"].includes(String(a.type)) && Object.keys(a).length === 1;
      const running = a.type === "running" && Object.keys(a).length === 3 && protocolId(a.threadId) && protocolId(a.turnId);
      const settle = a.type === "settle" && Object.keys(a).length === 2 && ["interrupted", "failed", "verification_finished"].includes(String(a.outcome));
      if (!simple && !running && !settle) return invalid();
      return v as IssueWorkerRequest;
    }
    case "execution.approval": {
      keys(["operation", "binding", "expectedRevision", "action"]);
      if (!revision(v.expectedRevision) || !v.binding || typeof v.binding !== "object" || Array.isArray(v.binding) || !v.action || typeof v.action !== "object" || Array.isArray(v.action)) return invalid();
      const b = v.binding as Record<string, unknown>, a = v.action as Record<string, unknown>;
      if (Object.keys(b).length !== 5 || Object.keys(b).some(key => !["projectId", "attemptId", "threadId", "turnId", "requestId"].includes(key)) || !projectId(b.projectId) || !issueId(b.attemptId) || !protocolId(b.threadId) || !protocolId(b.turnId) || !(protocolId(b.requestId) || typeof b.requestId === "number" && Number.isSafeInteger(b.requestId))) return invalid();
      if (Object.keys(a).length !== 2 || !(a.type === "request" && ["command", "file", "permission"].includes(String(a.kind)) || a.type === "respond" && ["accept", "decline", "cancel"].includes(String(a.decision)) || a.type === "finish" && ["sent", "outcome_unknown"].includes(String(a.result)))) return invalid();
      return v as IssueWorkerRequest;
    }
    case "document.import":
      keys(["operation", "projectId", "expectedRevision", "bytes"]);
      if (!projectId(v.projectId) || !revision(v.expectedRevision) || !(v.bytes instanceof Uint8Array) || v.bytes.byteLength > MAX_DOCUMENT_BYTES) return invalid();
      return v as IssueWorkerRequest;
    case "document.list":
      keys(["operation", "projectId", "expectedRevision", "limit", "afterId"]);
      if (!projectId(v.projectId) || !revision(v.expectedRevision) || v.limit !== undefined && (!Number.isSafeInteger(v.limit) || Number(v.limit) < 1 || Number(v.limit) > 100) || v.afterId !== undefined && v.afterId !== "" && !issueId(v.afterId)) return invalid();
      return v as IssueWorkerRequest;
    case "document.read":
      keys(["operation", "projectId", "documentId"]); if (!projectId(v.projectId) || !issueId(v.documentId)) return invalid(); return v as IssueWorkerRequest;
    case "document.export":
      keys(["operation", "projectId", "documentId", "expectedRevision"]); if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision)) return invalid(); return v as IssueWorkerRequest;
    case "issue.list":
      keys(["operation", "projectId", "documentId", "expectedRevision", "offset", "filters"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision) || !Number.isSafeInteger(v.offset) || Number(v.offset) < 0 || v.filters !== undefined && !validIssueFilters(v.filters)) return invalid();
      return v as IssueWorkerRequest;
    case "issue.projectSearch":
      keys(["operation", "projectId", "expectedRevision", "cursor", "filters"]);
      if (!projectId(v.projectId) || !revision(v.expectedRevision) || !validProjectIssueCursor(v.cursor) || v.filters !== undefined && !validProjectIssueFilters(v.filters)) return invalid();
      return v as IssueWorkerRequest;
    case "document.diagnostics":
    case "document.sourceTrace":
      keys(["operation", "projectId", "documentId", "expectedRevision", "offset"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision) || !Number.isSafeInteger(v.offset) || Number(v.offset) < 0) return invalid();
      return v as IssueWorkerRequest;
    case "requirement.detail":
      keys(["operation", "projectId", "documentId", "expectedRevision", "requirementId", "offset"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision) || !issueId(v.requirementId) || !Number.isSafeInteger(v.offset) || Number(v.offset) < 0) return invalid();
      return v as IssueWorkerRequest;
    case "category.list":
      keys(["operation", "projectId", "documentId", "expectedRevision", "parentId", "offset"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision) || !(v.parentId === null || issueId(v.parentId)) || !Number.isSafeInteger(v.offset) || Number(v.offset) < 0) return invalid();
      return v as IssueWorkerRequest;
    case "issue.detail":
      keys(["operation", "projectId", "documentId", "expectedRevision", "issueId"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision) || !issueId(v.issueId)) return invalid();
      return v as IssueWorkerRequest;
    case "issue.candidatePreview":
      keys(["operation", "projectId", "documentId", "expectedRevision", "issueIds", "options"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision) || !validCandidateIds(v.issueIds) || v.options !== undefined && !validCandidateOptions(v.options)) return invalid();
      return v as IssueWorkerRequest;
    case "issue.criteria":
    case "issue.requirements":
    case "issue.dependencies":
      keys(["operation", "projectId", "documentId", "expectedRevision", "issueId", "offset"]);
      if (!projectId(v.projectId) || !issueId(v.documentId) || !revision(v.expectedRevision) || !issueId(v.issueId) || !Number.isSafeInteger(v.offset) || Number(v.offset) < 0) return invalid();
      return v as IssueWorkerRequest;
    default: return invalid();
  }
}

export function safeIssueWorkerError(error: unknown): { code: IssueWorkerErrorCode; message: string } {
  if (error instanceof IssueStoreError || error instanceof IssueDocumentError || error instanceof IssueWorkerRequestError) return { code: error.code, message: error.message };
  if (error instanceof StoredIntentError || error instanceof ExecutionJournalError || error instanceof ApprovalJournalError) {
    const messages: Partial<Record<IssueWorkerErrorCode, string>> = {
      NOT_ELIGIBLE: "이 이슈는 현재 실행 조건을 충족하지 않습니다.", INVALID_PLAN: "이슈의 순서 또는 선행 관계를 확인하세요.",
      IDEMPOTENCY_CONFLICT: "같은 실행 요청에 다른 내용이 사용되었습니다.", PROJECT_BUSY: "확인되지 않은 다른 이슈 시도가 있습니다.",
      INVALID_TRANSITION: "이슈 시도의 현재 상태에서는 요청을 처리할 수 없습니다.", CORRUPT_RECORD: "이슈 실행 기록을 확인할 수 없습니다.",
      INVALID_INPUT: "이슈 실행 요청 형식이 올바르지 않습니다.", NOT_FOUND: "요청한 이슈 또는 시도가 없습니다.",
      STALE_SELECTION: "프로젝트 또는 실행 권한이 변경되었습니다.", VERSION_CONFLICT: "이슈 프로젝트가 변경되었습니다.",
      LIMIT_EXCEEDED: "이슈 실행 요청 한도를 초과했습니다.", STORAGE_FAILED: "이슈 저장소 작업에 실패했습니다.",
    };
    return { code: error.code, message: messages[error.code] ?? "이슈 실행 요청을 처리할 수 없습니다." };
  }
  return { code: "STORAGE_FAILED", message: "이슈 저장소 작업에 실패했습니다. 기존 데이터를 확인하세요." };
}

export async function dispatchIssueWorkerRequest(store: IssueStore, input: unknown): Promise<IssueWorkerResult> {
  const request = validateIssueWorkerRequest(input);
  switch (request.operation) {
    case "project.create": return { kind: "project", ...await store.createProject(request.selectedPath) };
    case "project.lookup": return { kind: "project.lookup", project: await store.lookupProject(request.selectedPath) };
    case "project.read": return { kind: "project", ...await store.readProject(request.projectId) };
    case "execution.history": return { kind: "execution.history", page: await store.executionHistory(request.projectId, request.expectedRevision, request.afterId) };
    case "execution.approval": await store.executionApproval(request.binding, request.expectedRevision, request.action); return { kind: "execution.approval" };
    case "execution.invalidateApprovals": return { kind: "execution.invalidateApprovals", ...await store.invalidateUnknownApprovals(request.projectId, request.attemptId, request.expectedRevision) };
    case "execution.reconcile": return { kind: "execution.reconcile", record: await store.reconcileExecution(request.projectId, request.attemptId, request.expectedRevision, request.reason) };
    case "execution.prepare": { const { operation: _operation, ...input } = request; return { kind: "execution.prepare", ...await store.prepareExecution(input) }; }
    case "execution.transition": return { kind: "execution.transition", record: await store.transitionExecution(request.projectId, request.expectedRevision, request.attemptId, request.action) };
    case "document.import": return { kind: "import", ...await store.importDocument(request.projectId, request.expectedRevision, request.bytes) };
    case "document.list": return { kind: "documents", ...await store.listDocuments(request.projectId, request.expectedRevision, request.limit, request.afterId) };
    case "document.read": return { kind: "document", ...await store.readDocument(request.projectId, request.documentId) };
    case "document.export": return { kind: "document.export", bytes: serializeIssueDocument((await store.readDocument(request.projectId, request.documentId, request.expectedRevision)).document) };
    case "issue.list": return { kind: "issue.list", page: await new IssueView(store).list(request.projectId, request.documentId, request.expectedRevision, request.offset, request.filters) };
    case "issue.projectSearch": return { kind: "issue.projectSearch", page: await new IssueView(store).projectSearch(request.projectId, request.expectedRevision, request.cursor, request.filters) };
    case "document.diagnostics": return { kind: "document.diagnostics", report: await new IssueView(store).diagnostics(request.projectId, request.documentId, request.expectedRevision, request.offset) };
    case "document.sourceTrace": return { kind: "document.sourceTrace", page: await new IssueView(store).sourceTrace(request.projectId, request.documentId, request.expectedRevision, request.offset) };
    case "requirement.detail": return { kind: "requirement.detail", ...await new IssueView(store).requirementDetail(request.projectId, request.documentId, request.expectedRevision, request.requirementId, request.offset) };
    case "category.list": return { kind: "category.list", page: await new IssueView(store).categories(request.projectId, request.documentId, request.expectedRevision, request.parentId, request.offset) };
    case "issue.detail": return { kind: "issue.detail", issue: await new IssueView(store).detail(request.projectId, request.documentId, request.expectedRevision, request.issueId) };
    case "issue.candidatePreview": return { kind: "issue.candidatePreview", items: await new IssueView(store).candidatePreview(request.projectId, request.documentId, request.expectedRevision, request.issueIds, request.options) };
    case "issue.criteria": return { kind: "issue.criteria", page: await new IssueView(store).criteria(request.projectId, request.documentId, request.expectedRevision, request.issueId, request.offset) };
    case "issue.requirements": return { kind: "issue.requirements", page: await new IssueView(store).requirements(request.projectId, request.documentId, request.expectedRevision, request.issueId, request.offset) };
    case "issue.dependencies": return { kind: "issue.dependencies", page: await new IssueView(store).dependencies(request.projectId, request.documentId, request.expectedRevision, request.issueId, request.offset) };
  }
}
