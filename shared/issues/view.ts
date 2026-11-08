export type IssueViewStatus = "ready" | "retryable" | "failed" | "needs_review";
export type IssueExecutionHistoryEntry = { attemptId: string; issueId: string; projectRevision: number; phase: "prepared" | "dispatching" | "running" | "verifying" | "outcome_unknown" | "settled"; outcome: "interrupted" | "failed" | "verification_finished" | "reconciled_unknown" | null; hasRuntimeReference: boolean; approvals: { pending: number; responding: number; sent: number; outcome_unknown: number; expired: number } };
export type IssueImportedStatus = IssueViewStatus | "completed";
export type IssueDocumentSummary = { id: string; documentRevision: number; issueCount: number };
export type IssueSummary = { id: string; title: string; version: string; category: string | null; localStatus: IssueViewStatus; importedStatus: IssueImportedStatus; missingCriteria: boolean; unverifiedDependencies: number };
export type IssueCandidateReason = "state" | "missing-criteria" | "review" | "dependency";
export const MAX_PREVIEW_SELECTION = 8;
export const MAX_PREVIEW_DEPENDENCIES = 3;
export type IssueCandidateOptions = { includeRetryable: boolean; includeFailed: boolean };
export type IssueCandidatePreview = { id: string; title: string; version: string; order: number; localStatus: IssueViewStatus; candidateReasons: IssueCandidateReason[]; unverifiedDependencyCount: number; dependencyPreview: { id: string; title: string }[] };
export function validCandidateOptions(value: unknown): value is IssueCandidateOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;
  return Object.keys(options).length === 2 && Object.keys(options).every(key => key === "includeRetryable" || key === "includeFailed") && typeof options.includeRetryable === "boolean" && typeof options.includeFailed === "boolean";
}
export function validCandidateIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_PREVIEW_SELECTION && value.every(id => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) && new Set(value).size === value.length;
}
export type IssueDetail = IssueSummary & { description: string; criteriaCount: number; requirementCount: number; dependencyCount: number; candidateReasons: IssueCandidateReason[] };
export type IssueRequirementView = { id: string; text: string; origin: "source" | "user" | "ai-proposal"; sourceName: string | null; locator: string | null };
export type RequirementDetail = IssueRequirementView & { category: string | null; linkedIssueCount: number };
export type SourceTrace = { sourceId: string; sourceName: string; requirement: IssueRequirementView | null };
export type IssueDependencyView = { id: string; title: string; localStatus: IssueViewStatus; importedStatus: IssueImportedStatus };
export type IssueCategoryView = { id: string; title: string; hasChildren: boolean };
export type Page<T> = { items: T[]; nextOffset: number | null };
export type IssueFindingCode = "source-unlinked" | "requirement-unlinked" | "requirement-uncategorized" | "requirement-same-text" | "requirement-ai-proposal" | "issue-unlinked" | "issue-uncategorized" | "issue-missing-description" | "issue-missing-criteria" | "issue-unverified-completion" | "issue-same-title" | "issue-same-version-order" | "issue-requirement-category-mismatch" | "category-empty" | "category-no-requirements" | "category-no-issues";
export type IssueFinding = { code: IssueFindingCode; entityId: string; title: string | null; provenance: { origin: IssueRequirementView["origin"]; sourceName: string | null; locator: string | null } | null; relatedEntityId?: string };
export type IssueDiagnosticReport = { documentRevision: number; issueCount: number; requirementCount: number; linkedRequirementCount: number; totalFindings: number; findings: Page<IssueFinding> };
export type IssueFilters = { search?: string; status?: IssueViewStatus; version?: string; categoryId?: string | null };
export type ProjectIssueFilters = Omit<IssueFilters, "categoryId">;
export type ProjectIssueCursor = { afterId?: string; issueOffset: number };
export type ProjectIssuePage = { documentId: string | null; items: IssueSummary[]; scannedDocuments: number; nextCursor: ProjectIssueCursor | null };
export function validIssueFilters(value: unknown): value is IssueFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const f = value as Record<string, unknown>;
  return Object.keys(f).every(key => ["search", "status", "version", "categoryId"].includes(key))
    && (f.search === undefined || typeof f.search === "string" && f.search.length <= 120)
    && (f.status === undefined || typeof f.status === "string" && ["ready", "retryable", "failed", "needs_review"].includes(f.status))
    && (f.version === undefined || typeof f.version === "string" && f.version.length <= 1024 && /^\d+\.\d+\.\d+$/.test(f.version))
    && (f.categoryId === undefined || f.categoryId === null || typeof f.categoryId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(f.categoryId));
}
export function validProjectIssueFilters(value: unknown): value is ProjectIssueFilters {
  return validIssueFilters(value) && !Object.prototype.hasOwnProperty.call(value, "categoryId");
}
export function validProjectIssueCursor(value: unknown): value is ProjectIssueCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  return Object.keys(cursor).every(key => ["afterId", "issueOffset"].includes(key))
    && (cursor.afterId === undefined || typeof cursor.afterId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(cursor.afterId))
    && Number.isSafeInteger(cursor.issueOffset) && Number(cursor.issueOffset) >= 0;
}
export type IssueViewQuery =
  | { kind: "documents"; expectedRevision?: number; afterId?: string }
  | { kind: "executionHistory"; expectedRevision: number; afterId: string | null }
  | { kind: "issues"; documentId: string; expectedRevision: number; offset: number; filters?: IssueFilters }
  | { kind: "projectIssues"; expectedRevision: number; cursor: ProjectIssueCursor; filters?: ProjectIssueFilters }
  | { kind: "categories"; documentId: string; expectedRevision: number; parentId: string | null; offset: number }
  | { kind: "diagnostics"; documentId: string; expectedRevision: number; offset: number }
  | { kind: "sourceTrace"; documentId: string; expectedRevision: number; offset: number }
  | { kind: "requirementDetail"; documentId: string; expectedRevision: number; requirementId: string; offset: number }
  | { kind: "detail"; documentId: string; expectedRevision: number; issueId: string }
  | { kind: "candidatePreview"; documentId: string; expectedRevision: number; issueIds: string[]; options?: IssueCandidateOptions }
  | { kind: "criteria" | "requirements" | "dependencies"; documentId: string; expectedRevision: number; issueId: string; offset: number };
export type IssueViewResult =
  | { kind: "documents"; revision: number; documents: IssueDocumentSummary[]; nextAfterId: string | null }
  | { kind: "executionHistory"; revision: number; page: { items: IssueExecutionHistoryEntry[]; nextAfterId: string | null } }
  | { kind: "issues"; revision: number; page: Page<IssueSummary> }
  | { kind: "projectIssues"; revision: number; page: ProjectIssuePage }
  | { kind: "categories"; revision: number; page: Page<IssueCategoryView> }
  | { kind: "diagnostics"; revision: number; report: IssueDiagnosticReport }
  | { kind: "sourceTrace"; revision: number; page: Page<SourceTrace> }
  | { kind: "requirementDetail"; revision: number; requirement: RequirementDetail; page: Page<IssueSummary> }
  | { kind: "detail"; revision: number; issue: IssueDetail }
  | { kind: "candidatePreview"; revision: number; options: IssueCandidateOptions; items: IssueCandidatePreview[] }
  | { kind: "criteria"; revision: number; page: Page<string> }
  | { kind: "dependencies"; revision: number; page: Page<IssueDependencyView> }
  | { kind: "requirements"; revision: number; page: Page<IssueRequirementView> };
