import type { IssueDocument } from "./document.js";
import type { IssueStoreCode } from "./store.js";
import type { IssueCategoryView, IssueDependencyView, IssueDetail, IssueDiagnosticReport, IssueFilters, IssueRequirementView, IssueSummary, Page, ProjectIssueCursor, ProjectIssueFilters, ProjectIssuePage, RequirementDetail, SourceTrace } from "../../shared/issues/view.js";

/** Internal bridge-to-worker messages only. No message is a renderer authorization. */
export type IssueWorkerRequest =
  | { operation: "project.create"; selectedPath: string }
  | { operation: "project.lookup"; selectedPath: string }
  | { operation: "project.read"; projectId: string }
  | { operation: "document.import"; projectId: string; expectedRevision: number; bytes: Uint8Array }
  | { operation: "document.list"; projectId: string; expectedRevision: number; limit?: number; afterId?: string }
  | { operation: "document.read"; projectId: string; documentId: string }
  | { operation: "document.export"; projectId: string; documentId: string; expectedRevision: number }
  | { operation: "issue.list"; projectId: string; documentId: string; expectedRevision: number; offset: number; filters?: IssueFilters }
  | { operation: "issue.projectSearch"; projectId: string; expectedRevision: number; cursor: ProjectIssueCursor; filters?: ProjectIssueFilters }
  | { operation: "category.list"; projectId: string; documentId: string; expectedRevision: number; parentId: string | null; offset: number }
  | { operation: "document.diagnostics"; projectId: string; documentId: string; expectedRevision: number; offset: number }
  | { operation: "document.sourceTrace"; projectId: string; documentId: string; expectedRevision: number; offset: number }
  | { operation: "requirement.detail"; projectId: string; documentId: string; expectedRevision: number; requirementId: string; offset: number }
  | { operation: "issue.detail"; projectId: string; documentId: string; expectedRevision: number; issueId: string }
  | { operation: "issue.criteria" | "issue.requirements" | "issue.dependencies"; projectId: string; documentId: string; expectedRevision: number; issueId: string; offset: number };

export type IssueWorkerResult =
  | { kind: "project"; id: string; revision: number }
  | { kind: "project.lookup"; project: { id: string; revision: number } | null }
  | { kind: "import"; documentId: string; revision: number; alreadyImported: boolean; issueCount: number }
  | { kind: "documents"; revision: number; documents: { id: string; documentRevision: number; issueCount: number }[]; nextAfterId: string | null }
  | { kind: "document"; document: IssueDocument; issues: { issueId: string; importedStatus: IssueDocument["issues"][number]["status"]; localStatus: Exclude<IssueDocument["issues"][number]["status"], "completed"> }[] }
  | { kind: "document.export"; bytes: Uint8Array }
  | { kind: "issue.list"; page: Page<IssueSummary> }
  | { kind: "issue.projectSearch"; page: ProjectIssuePage }
  | { kind: "category.list"; page: Page<IssueCategoryView> }
  | { kind: "document.diagnostics"; report: IssueDiagnosticReport }
  | { kind: "document.sourceTrace"; page: Page<SourceTrace> }
  | { kind: "requirement.detail"; requirement: RequirementDetail; page: Page<IssueSummary> }
  | { kind: "issue.detail"; issue: IssueDetail }
  | { kind: "issue.criteria"; page: Page<string> }
  | { kind: "issue.dependencies"; page: Page<IssueDependencyView> }
  | { kind: "issue.requirements"; page: Page<IssueRequirementView> };

export type IssueWorkerErrorCode = IssueStoreCode | "INVALID_INPUT" | "UNSUPPORTED_FORMAT" | "BUSY" | "WORKER_UNAVAILABLE" | "OUTCOME_UNKNOWN" | "STALE_SELECTION";
export type IssueWorkerReply = { id: number; ok: true; result: IssueWorkerResult } | { id: number; ok: false; error: { code: IssueWorkerErrorCode; message: string } };
