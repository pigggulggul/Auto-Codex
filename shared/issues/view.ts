export type IssueViewStatus = "ready" | "retryable" | "failed" | "needs_review";
export type IssueImportedStatus = IssueViewStatus | "completed";
export type IssueDocumentSummary = { id: string; documentRevision: number; issueCount: number };
export type IssueSummary = { id: string; title: string; version: string; category: string | null; localStatus: IssueViewStatus; importedStatus: IssueImportedStatus; missingCriteria: boolean; unverifiedDependencies: number };
export type IssueDetail = IssueSummary & { description: string; criteriaCount: number; requirementCount: number; dependencyCount: number };
export type IssueRequirementView = { id: string; text: string; origin: "source" | "user" | "ai-proposal"; sourceName: string | null; locator: string | null };
export type IssueDependencyView = { id: string; title: string; localStatus: IssueViewStatus; importedStatus: IssueImportedStatus };
export type IssueCategoryView = { id: string; title: string; hasChildren: boolean };
export type Page<T> = { items: T[]; nextOffset: number | null };
export type IssueFindingCode = "requirement-unlinked" | "requirement-uncategorized" | "issue-unlinked" | "issue-uncategorized" | "issue-missing-description" | "issue-missing-criteria" | "issue-unverified-completion";
export type IssueFinding = { code: IssueFindingCode; entityId: string; title: string | null; provenance: { origin: IssueRequirementView["origin"]; sourceName: string | null; locator: string | null } | null };
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
  | { kind: "issues"; documentId: string; expectedRevision: number; offset: number; filters?: IssueFilters }
  | { kind: "projectIssues"; expectedRevision: number; cursor: ProjectIssueCursor; filters?: ProjectIssueFilters }
  | { kind: "categories"; documentId: string; expectedRevision: number; parentId: string | null; offset: number }
  | { kind: "diagnostics"; documentId: string; expectedRevision: number; offset: number }
  | { kind: "detail"; documentId: string; expectedRevision: number; issueId: string }
  | { kind: "criteria" | "requirements" | "dependencies"; documentId: string; expectedRevision: number; issueId: string; offset: number };
export type IssueViewResult =
  | { kind: "documents"; revision: number; documents: IssueDocumentSummary[]; nextAfterId: string | null }
  | { kind: "issues"; revision: number; page: Page<IssueSummary> }
  | { kind: "projectIssues"; revision: number; page: ProjectIssuePage }
  | { kind: "categories"; revision: number; page: Page<IssueCategoryView> }
  | { kind: "diagnostics"; revision: number; report: IssueDiagnosticReport }
  | { kind: "detail"; revision: number; issue: IssueDetail }
  | { kind: "criteria"; revision: number; page: Page<string> }
  | { kind: "dependencies"; revision: number; page: Page<IssueDependencyView> }
  | { kind: "requirements"; revision: number; page: Page<IssueRequirementView> };
