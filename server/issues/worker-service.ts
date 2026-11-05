import { IssueDocumentError, MAX_DOCUMENT_BYTES, serializeIssueDocument } from "./document.js";
import { IssueStore, IssueStoreError } from "./store.js";
import type { IssueWorkerErrorCode, IssueWorkerRequest, IssueWorkerResult } from "./worker-contract.js";
import { IssueView } from "./issue-view.js";
import { validCandidateIds, validCandidateOptions, validIssueFilters, validProjectIssueCursor, validProjectIssueFilters } from "../../shared/issues/view.js";

export class IssueWorkerRequestError extends Error {
  readonly code = "INVALID_INPUT";
}
const invalid = (): never => { throw new IssueWorkerRequestError("이슈 저장소 요청 형식이 올바르지 않습니다."); };
const projectId = (value: unknown): value is string => typeof value === "string" && /^project_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const issueId = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

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
  return { code: "STORAGE_FAILED", message: "이슈 저장소 작업에 실패했습니다. 기존 데이터를 확인하세요." };
}

export async function dispatchIssueWorkerRequest(store: IssueStore, input: unknown): Promise<IssueWorkerResult> {
  const request = validateIssueWorkerRequest(input);
  switch (request.operation) {
    case "project.create": return { kind: "project", ...await store.createProject(request.selectedPath) };
    case "project.lookup": return { kind: "project.lookup", project: await store.lookupProject(request.selectedPath) };
    case "project.read": return { kind: "project", ...await store.readProject(request.projectId) };
    case "document.import": return { kind: "import", ...await store.importDocument(request.projectId, request.expectedRevision, request.bytes) };
    case "document.list": return { kind: "documents", ...await store.listDocuments(request.projectId, request.expectedRevision, request.limit, request.afterId) };
    case "document.read": return { kind: "document", ...await store.readDocument(request.projectId, request.documentId) };
    case "document.export": return { kind: "document.export", bytes: serializeIssueDocument((await store.readDocument(request.projectId, request.documentId, request.expectedRevision)).document) };
    case "issue.list": return { kind: "issue.list", page: await new IssueView(store).list(request.projectId, request.documentId, request.expectedRevision, request.offset, request.filters) };
    case "issue.projectSearch": return { kind: "issue.projectSearch", page: await new IssueView(store).projectSearch(request.projectId, request.expectedRevision, request.cursor, request.filters) };
    case "document.diagnostics": return { kind: "document.diagnostics", report: await new IssueView(store).diagnostics(request.projectId, request.documentId, request.expectedRevision, request.offset) };
    case "requirement.detail": return { kind: "requirement.detail", ...await new IssueView(store).requirementDetail(request.projectId, request.documentId, request.expectedRevision, request.requirementId, request.offset) };
    case "category.list": return { kind: "category.list", page: await new IssueView(store).categories(request.projectId, request.documentId, request.expectedRevision, request.parentId, request.offset) };
    case "issue.detail": return { kind: "issue.detail", issue: await new IssueView(store).detail(request.projectId, request.documentId, request.expectedRevision, request.issueId) };
    case "issue.candidatePreview": return { kind: "issue.candidatePreview", items: await new IssueView(store).candidatePreview(request.projectId, request.documentId, request.expectedRevision, request.issueIds, request.options) };
    case "issue.criteria": return { kind: "issue.criteria", page: await new IssueView(store).criteria(request.projectId, request.documentId, request.expectedRevision, request.issueId, request.offset) };
    case "issue.requirements": return { kind: "issue.requirements", page: await new IssueView(store).requirements(request.projectId, request.documentId, request.expectedRevision, request.issueId, request.offset) };
    case "issue.dependencies": return { kind: "issue.dependencies", page: await new IssueView(store).dependencies(request.projectId, request.documentId, request.expectedRevision, request.issueId, request.offset) };
  }
}
