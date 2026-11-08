import type { IssueDocument } from "./document.js";
import type { IssueStoreCode } from "./store.js";
import type { JournalHistoryPage } from "./execution-journal.js";
import type { ApprovalBinding, ApprovalKind, ApprovalDecision } from "./execution-approval-journal.js";
import type { FrozenExecutionIntent, ExecutionIntentInput } from "./execution-intent.js";
import type { JournalRecord } from "./execution-journal.js";
import type { IssueCandidateOptions, IssueCandidatePreview, IssueCategoryView, IssueDependencyView, IssueDetail, IssueDiagnosticReport, IssueFilters, IssueRequirementView, IssueSummary, Page, ProjectIssueCursor, ProjectIssueFilters, ProjectIssuePage, RequirementDetail, SourceTrace } from "../../shared/issues/view.js";

/** Internal bridge-to-worker messages only. No message is a renderer authorization. */
export type IssueWorkerRequest =
  | { operation: "project.create"; selectedPath: string }
  | { operation: "project.lookup"; selectedPath: string }
  | { operation: "project.read"; projectId: string }
  | { operation: "execution.history"; projectId: string; expectedRevision: number; afterId: string | null }
  | { operation: "execution.approval"; binding: ApprovalBinding; expectedRevision: number; action: { type: "request"; kind: ApprovalKind } | { type: "respond"; decision: ApprovalDecision } | { type: "finish"; result: "sent" | "outcome_unknown" } }
  | { operation: "execution.invalidateApprovals"; projectId: string; attemptId: string; expectedRevision: number }
  | { operation: "execution.reconcile"; projectId: string; attemptId: string; expectedRevision: number; reason: string }
  | { operation: "execution.prepare"; projectId: string; documentId: string; issueId: string; expectedRevision: number; idempotencyKey: string; policy: ExecutionIntentInput["policy"] }
  | { operation: "execution.transition"; projectId: string; attemptId: string; expectedRevision: number; action: { type: "dispatch" | "verifying" | "unknown" } | { type: "running"; threadId: string; turnId: string } | { type: "settle"; outcome: "interrupted" | "failed" | "verification_finished" } }
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
  | { operation: "issue.candidatePreview"; projectId: string; documentId: string; expectedRevision: number; issueIds: string[]; options?: IssueCandidateOptions }
  | { operation: "issue.criteria" | "issue.requirements" | "issue.dependencies"; projectId: string; documentId: string; expectedRevision: number; issueId: string; offset: number };

export type IssueWorkerResult =
  | { kind: "project"; id: string; revision: number }
  | { kind: "project.lookup"; project: { id: string; revision: number } | null }
  | { kind: "execution.history"; page: JournalHistoryPage }
  | { kind: "execution.approval" }
  | { kind: "execution.invalidateApprovals"; expired: number; unknown: number }
  | { kind: "execution.reconcile"; record: JournalRecord }
  | { kind: "execution.prepare"; intent: FrozenExecutionIntent; record: JournalRecord; created: boolean }
  | { kind: "execution.transition"; record: JournalRecord }
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
  | { kind: "issue.candidatePreview"; items: IssueCandidatePreview[] }
  | { kind: "issue.criteria"; page: Page<string> }
  | { kind: "issue.dependencies"; page: Page<IssueDependencyView> }
  | { kind: "issue.requirements"; page: Page<IssueRequirementView> };

export type IssueWorkerErrorCode = IssueStoreCode | "INVALID_INPUT" | "UNSUPPORTED_FORMAT" | "BUSY" | "WORKER_UNAVAILABLE" | "OUTCOME_UNKNOWN" | "STALE_SELECTION" | "NOT_ELIGIBLE" | "INVALID_PLAN" | "IDEMPOTENCY_CONFLICT" | "PROJECT_BUSY" | "INVALID_TRANSITION" | "CORRUPT_RECORD";
export type IssueWorkerReply = { id: number; ok: true; result: IssueWorkerResult } | { id: number; ok: false; error: { code: IssueWorkerErrorCode; message: string } };
