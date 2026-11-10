import { MAX_PREVIEW_DEPENDENCIES, validCandidateOptions, validProjectIssueCursor, type IssueViewQuery, type IssueViewResult } from "../../../shared/issues/view.js";
import type { AnalysisFreshness, AnalysisRunStatus, AnalysisSegmentPage, AnalysisSnapshotRequest, AnalysisSnapshotSummary, AnalysisSourceChunk, AnalysisSourceList, SemanticRecord, SemanticStatus } from "../../../shared/issues/sources.js";

import type { IssueDocument } from "../../../server/issues/document.js";
import type { DraftReview, PlanningMessage } from "../../../server/issues/planning-draft.js";
import type { PlanningProposal } from "../../../server/issues/planning-proposal.js";

export type PlanStatus = { state: "idle" | "running" | "complete" | "failed" | "interrupted" | "stale" | "termination-unconfirmed"; result: { revision: number; projectRevision: number; proposals: PlanningProposal[] } | null };

export type DraftState = { projectRevision: number; revision: number; document: IssueDocument; reviews: DraftReview[]; history: { revision: number; review: DraftReview }[]; validations?: SemanticRecord[]; conversation?: PlanningMessage[] };
type DraftInput = { expectedRevision: number; document: IssueDocument } | { draftRevision: number; document: IssueDocument } | { draftRevision: number; review: DraftReview } | { draftRevision: number; findingId: string; decision: "resolved" | "deferred"; reason: string } | { draftRevision: number; request: string } | { draftRevision: number; proposalId: string } | { draftRevision: number };

type Action = "status" | "bind" | "import" | "export" | "authorizeView" | "view" | "releaseView" | "sourceAdd" | "sourceList" | "sourceRead" | "sourceRemove" | "snapshotPrepare" | "snapshotCheck" | "analysisStatus" | "analysisStart" | "analysisInterrupt" | "analysisClear" | "analysisSegment" | "analysisRetry" | "draftCreate" | "draftRead" | "draftReplace" | "draftReview" | "draftRegister" | "draftPersist" | "draftRestore" | "draftInspectSaved" | "draftRebase" | "draftCopy" | "semanticStart" | "semanticStatus" | "semanticInterrupt" | "semanticClear" | "semanticSave" | "semanticReview" | "planStart" | "planStatus" | "planInterrupt" | "planClear" | "planApply";
type FreshnessRequest = { snapshotId: string; expectedRevision: number; expectedIds: string[] };
export class IssueApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export type IssueBindingResult = { bound: boolean; cancelled?: boolean; issueCount?: number; alreadyImported?: boolean; cleanupWarning?: boolean; authorized?: boolean; authorizedForMs?: number; view?: IssueViewResult; sources?: AnalysisSourceList; chunk?: AnalysisSourceChunk; snapshot?: AnalysisSnapshotSummary; freshness?: AnalysisFreshness; analysisStatus?: AnalysisRunStatus; analysisSegment?: AnalysisSegmentPage; draft?: DraftState; savedStale?: boolean; semanticStatus?: SemanticStatus; planStatus?: PlanStatus };
type Pending = { id: string; action: Action; sourceId?: string; offset?: number; segmentIndex?: number; viewQuery?: IssueViewQuery; snapshotRequest?: Pick<AnalysisSnapshotRequest, "expectedRevision" | "expectedSources"> & { hasInstruction: boolean }; freshnessRequest?: FreshnessRequest; promise: Promise<IssueBindingResult>; resolve: (result: IssueBindingResult) => void; reject: (error: IssueApiError) => void; timer: ReturnType<typeof setTimeout> };
const uncertainMessage = (action: Action) => action === "draftRegister" ? "등록 결과가 불명확합니다. 이슈 목록을 확인한 뒤 다시 시도하세요." : ["draftCreate", "draftReplace", "draftReview", "draftPersist", "draftRestore", "draftRebase", "draftCopy", "semanticSave", "semanticReview", "planApply"].includes(action) ? "초안 변경 결과가 불명확합니다. 초안을 다시 조회한 뒤 재시도 여부를 확인하세요." : ["semanticStart", "semanticInterrupt", "semanticClear"].includes(action) ? "의미 검증 요청 결과를 확인하지 못했습니다. 다시 시도하기 전에 검증 상태를 확인하세요." : ["planStart", "planInterrupt", "planClear"].includes(action) ? "계획 제안 요청 결과를 확인하지 못했습니다. 다시 시도하기 전에 제안 상태와 초안 대화 기록을 확인하세요." : action === "analysisStart" || action === "analysisInterrupt" || action === "analysisClear" || action === "analysisRetry" ? "분석 요청 결과를 확인하지 못했습니다. 다시 시도하기 전에 분석 상태를 확인하세요." : action === "import" ? "등록 결과를 확인하지 못했습니다. 같은 문서를 다시 선택하면 중복 등록 없이 확인할 수 있습니다." : action === "export" ? "저장 결과를 확인하지 못했습니다. 다시 시도하기 전에 선택한 위치를 확인하세요." : action === "sourceAdd" || action === "sourceRemove" ? "자료 선택 상태를 확인하지 못했습니다. 목록을 다시 확인하세요." : "연결 결과를 확인하지 못했습니다. 다시 연결한 뒤 상태를 확인하세요.";
const mutating = (action: Action) => action === "bind" || action === "import" || action === "export" || action === "sourceAdd" || action === "sourceRemove" || action === "analysisStart" || action === "analysisInterrupt" || action === "analysisClear" || action === "analysisRetry" || action === "draftCreate" || action === "draftReplace" || action === "draftReview" || action === "draftRegister" || action === "draftPersist" || action === "draftRestore" || action === "draftRebase" || action === "draftCopy" || action === "semanticStart" || action === "semanticInterrupt" || action === "semanticClear" || action === "semanticSave" || action === "semanticReview" || action === "planStart" || action === "planInterrupt" || action === "planClear" || action === "planApply";
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const nonnegative = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const shortId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const label = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
const validDraftReview = (value: unknown): value is DraftReview => record(value) && shortId(value.requirementId) && shortId(value.issueId) && (value.decision === "confirmed" || value.decision === "deferred") && typeof value.reason === "string" && value.reason.length <= 2000 && !!value.reason.trim() && !value.reason.includes("\0");
function validDraft(value: unknown): value is DraftState {
  if (!record(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !Number.isSafeInteger(value.projectRevision) || Number(value.projectRevision) < 1 || !record(value.document) || !Array.isArray(value.reviews) || !Array.isArray(value.history)) return false;
  if (value.history.length > 4096 || value.reviews.length > 4096 || !value.reviews.every(validDraftReview) || !value.history.every(entry => record(entry) && Number.isSafeInteger(entry.revision) && Number(entry.revision) > 0 && Number(entry.revision) <= Number(value.revision) && validDraftReview(entry.review))) return false;
  if (value.conversation !== undefined && (!Array.isArray(value.conversation) || value.conversation.length > 256 || !value.conversation.every(item => record(item) && Number.isSafeInteger(item.revision) && Number(item.revision) > 0 && Number(item.revision) <= Number(value.revision) && (item.role === "user" || item.role === "assistant") && typeof item.text === "string" && !!item.text.trim() && item.text.length <= 65536 && !item.text.includes("\0")))) return false;
  if (value.validations !== undefined && (!Array.isArray(value.validations) || value.validations.length > 32 || !value.validations.every(entry => {
    if (!record(entry) || !Number.isSafeInteger(entry.segmentIndex) || Number(entry.segmentIndex) < 0 || Number(entry.segmentIndex) >= 2048 || !validSemanticStatus({ state: "complete", result: entry.result }) || !record(entry.result) || Number(entry.result.draftRevision) > Number(value.revision) || !Array.isArray(entry.result.findings) || !Array.isArray(entry.decisions) || entry.decisions.length > 512) return false;
    const ids = new Set(entry.result.findings.map((item: { id: string }) => item.id));
    return entry.decisions.every(decision => record(decision) && shortId(decision.findingId) && ids.has(String(decision.findingId)) && (decision.status === "resolved" || decision.status === "deferred") && typeof decision.reason === "string" && !!decision.reason.trim() && decision.reason.length <= 2000 && !decision.reason.includes("\0"));
  }))) return false;
  const doc = value.document;
  return doc.format === "auto-codex-issues" && doc.formatVersion === 1 && shortId(doc.documentId) && Number.isSafeInteger(doc.revision) && Array.isArray(doc.sources) && Array.isArray(doc.categories) && Array.isArray(doc.requirements) && Array.isArray(doc.issues)
    && doc.requirements.every(item => record(item) && shortId(item.id) && typeof item.text === "string")
    && doc.issues.every(item => record(item) && shortId(item.id) && typeof item.title === "string" && typeof item.description === "string" && Array.isArray(item.requirementIds) && item.requirementIds.every(shortId) && Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.every((criterion: unknown) => typeof criterion === "string"));
}
function validAnalysisStatus(value: unknown): value is AnalysisRunStatus {
  if (value === "unavailable") return true;
  if (!record(value) || !["idle", "preparing", "running", "complete", "blocked", "limit", "interrupted", "failed", "termination-unconfirmed"].includes(String(value.state))) return false;
  if (value.progress === null) return ["idle", "preparing", "failed", "interrupted", "termination-unconfirmed"].includes(String(value.state));
  const p = value.progress; if (!record(p) || typeof p.isRunning !== "boolean" || typeof p.disposed !== "boolean") return false;
  const counts = [p.pending, p.running, p.processed, p.failed, p.interrupted];
  return counts.every(nonnegative) && counts.reduce<number>((sum, item) => sum + Number(item), 0) <= 2048;
}
function validSemanticStatus(value: unknown): value is SemanticStatus {
  if (!record(value) || !["idle", "running", "complete", "failed", "interrupted", "stale", "termination-unconfirmed"].includes(String(value.state))) return false;
  if (value.state !== "complete") return value.result === null;
  const result = value.result;
  if (!record(result) || !Number.isSafeInteger(result.projectRevision) || Number(result.projectRevision) < 1 || !Number.isSafeInteger(result.draftRevision) || Number(result.draftRevision) < 1 || typeof result.snapshotId !== "string" || !/^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.snapshotId) || !shortId(result.segmentId) || typeof result.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.sourceSha256) || typeof result.sourcePath !== "string" || !result.sourcePath || result.sourcePath.length > 1024 || result.sourcePath.includes("\\") || result.sourcePath.split("/").some(part => !part || part === "." || part === ".." || part.includes(":")) || !Array.isArray(result.findings) || result.findings.length > 16) return false;
  const ids = new Set<string>();
  return result.findings.every(item => {
    if (!record(item) || !shortId(item.id) || ids.has(String(item.id)) || !["possible-omission", "possible-mismatch", "possible-duplicate", "unclear-criteria"].includes(String(item.kind)) || !label(item.summary, 600) || typeof item.summary !== "string" || !item.summary.trim() || !label(item.uncertainty, 500) || typeof item.uncertainty !== "string" || !item.uncertainty.trim() || !(item.requirementId === null || shortId(item.requirementId)) || !(item.issueId === null || shortId(item.issueId))) return false;
    ids.add(String(item.id)); const e = item.evidence;
    return e === null || record(e) && sourceId(e.sourceId) && e.segmentId === result.segmentId && e.sourceSha256 === result.sourceSha256 && typeof e.quote === "string" && !!e.quote.trim() && e.quote.length <= 300 && nonnegative(e.start) && nonnegative(e.end) && Number(e.end) - Number(e.start) === e.quote.length;
  });
}
function validPlanStatus(value: unknown): value is PlanStatus {
  if (!record(value) || !["idle", "running", "complete", "failed", "interrupted", "stale", "termination-unconfirmed"].includes(String(value.state))) return false;
  if (value.state !== "complete") return value.result === null;
  const result = value.result;
  if (!record(result) || !Number.isSafeInteger(result.revision) || Number(result.revision) < 1 || !Number.isSafeInteger(result.projectRevision) || Number(result.projectRevision) < 1 || !Array.isArray(result.proposals) || result.proposals.length > 16) return false;
  const ids = new Set<string>();
  return result.proposals.every(item => {
    if (!record(item) || !shortId(item.id) || ids.has(String(item.id)) || !shortId(item.targetId) || !(item.target === "requirement" && item.field === "text" || item.target === "issue" && (item.field === "title" || item.field === "description")) || !label(item.before, 32768) || typeof item.after !== "string" || !item.after.trim() || item.after.length > (item.field === "title" ? 255 : 2000) || typeof item.reason !== "string" || !item.reason.trim() || item.reason.length > 600 || typeof item.uncertainty !== "string" || !item.uncertainty.trim() || item.uncertainty.length > 500) return false;
    ids.add(String(item.id)); return true;
  });
}
function validAnalysisSegment(value: unknown, pending: Pending): value is AnalysisSegmentPage {
  if (!record(value) || value.index !== pending.segmentIndex || !["pending", "running", "processed", "failed", "interrupted"].includes(String(value.status)) || !(value.error === null || value.status === "failed" && ["STALE_INPUT", "INVALID_OUTPUT", "MODEL_FAILED", "LIMIT_EXCEEDED"].includes(String(value.error))) || value.status === "failed" && value.error === null || !Array.isArray(value.items) || value.items.length > 32 || value.status !== "processed" && value.items.length !== 0 || !nonnegative(pending.offset)) return false;
  const end = Number(pending.offset) + value.items.length;
  if (!(value.nextOffset === null || value.items.length > 0 && value.nextOffset === end && end <= 512)) return false;
  return value.items.every(item => {
    if (!record(item) || !shortId(item.id) || !label(item.text, 600) || typeof item.text !== "string" || !item.text.trim() || !label(item.uncertainty, 500)) return false;
    if (item.origin === "ai-proposal") return item.evidence === null && typeof item.uncertainty === "string" && !!item.uncertainty.trim();
    const e = item.evidence;
    return item.origin === "source" && record(e) && sourceId(e.sourceId) && label(e.sourcePath, 1024) && typeof e.sourcePath === "string" && !!e.sourcePath && !e.sourcePath.includes("\\") && !e.sourcePath.split("/").some(part => !part || part === "." || part === ".." || part.includes(":")) && typeof e.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(e.sourceSha256) && shortId(e.segmentId) && label(e.quote, 300) && typeof e.quote === "string" && !!e.quote.trim() && nonnegative(e.start) && nonnegative(e.end) && Number(e.end) - Number(e.start) === e.quote.length;
  });
}
const sourceId = (value: unknown) => typeof value === "string" && /^source_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function validSources(value: unknown): value is AnalysisSourceList {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 16 || !nonnegative(value.totalBytes) || Number(value.totalBytes) > 4 * 1024 * 1024) return false;
  let total = 0; const ids = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || !sourceId(item.id) || ids.has(String(item.id)) || !label(item.relativePath, 1024) || typeof item.relativePath !== "string" || !item.relativePath || item.relativePath.includes("\\") || item.relativePath.split("/").some(part => !part || part === "." || part === ".." || part.includes(":")) || !nonnegative(item.bytes) || Number(item.bytes) > 1024 * 1024 || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.projectRevision) || Number(item.projectRevision) < 1) return false;
    total += Number(item.bytes); ids.add(String(item.id));
  }
  return total === value.totalBytes;
}
function validChunk(value: unknown, pending: Pending): value is AnalysisSourceChunk {
  return record(value) && value.sourceId === pending.sourceId && value.offset === pending.offset && label(value.text, 8192) && typeof value.text === "string" && (value.nextOffset === null || nonnegative(value.nextOffset) && value.text.length > 0 && Number(value.nextOffset) === Number(value.offset) + value.text.length);
}
function validSnapshot(value: unknown, pending: Pending): value is AnalysisSnapshotSummary {
  const request = pending.snapshotRequest;
  if (!request || !record(value) || typeof value.id !== "string" || !/^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) || value.projectRevision !== request.expectedRevision || value.hasInstruction !== request.hasInstruction || value.processedSegments !== 0 || !nonnegative(value.totalSegments) || Number(value.totalSegments) > 2048 || !Array.isArray(value.sources) || value.sources.length !== request.expectedSources.length) return false;
  let total = 0;
  for (let index = 0; index < value.sources.length; index++) {
    const item = value.sources[index], expected = request.expectedSources[index];
    if (!record(item) || item.id !== expected.id || item.sha256 !== expected.sha256 || !label(item.relativePath, 1024) || typeof item.relativePath !== "string" || !item.relativePath || item.relativePath.includes("\\") || item.relativePath.split("/").some(part => !part || part === "." || part === ".." || part.includes(":")) || !nonnegative(item.segmentCount) || Number(item.segmentCount) > 2048) return false;
    total += Number(item.segmentCount);
  }
  return total === value.totalSegments;
}
function validFreshness(value: unknown, pending: Pending): value is AnalysisFreshness {
  const request = pending.freshnessRequest;
  return Boolean(request && record(value) && value.snapshotId === request.snapshotId && value.projectRevision === request.expectedRevision && Array.isArray(value.files) && value.files.length === request.expectedIds.length && value.files.every((item, index) => record(item) && item.id === request.expectedIds[index] && typeof item.state === "string" && ["unchanged", "changed", "unavailable"].includes(item.state)));
}
const localStatus = (value: unknown) => ["ready", "retryable", "failed", "needs_review"].includes(String(value));
const dependency = (value: unknown) => record(value) && shortId(value.id) && label(value.title, 255) && localStatus(value.localStatus) && (localStatus(value.importedStatus) || value.importedStatus === "completed");
const summary = (value: unknown) => dependency(value) && record(value) && label(value.version, 1024) && (value.category === null || label(value.category, 255)) && typeof value.missingCriteria === "boolean" && nonnegative(value.unverifiedDependencies);
function validFinding(item: unknown): boolean {
  if (!record(item) || typeof item.code !== "string" || !["source-unlinked", "requirement-unlinked", "requirement-uncategorized", "requirement-same-text", "requirement-ai-proposal", "issue-unlinked", "issue-uncategorized", "issue-missing-description", "issue-missing-criteria", "issue-unverified-completion", "issue-same-title", "issue-same-version-order", "issue-requirement-category-mismatch", "category-empty", "category-no-requirements", "category-no-issues"].includes(item.code) || !shortId(item.entityId) || !(item.title === null || label(item.title, 32768))) return false;
  const duplicate = item.code === "requirement-same-text" || item.code === "issue-same-title" || item.code === "issue-same-version-order" || item.code === "issue-requirement-category-mismatch";
  if (duplicate ? !shortId(item.relatedEntityId) || item.relatedEntityId === item.entityId : item.relatedEntityId !== undefined) return false;
  return item.code.startsWith("requirement-") ? record(item.provenance) && typeof item.provenance.origin === "string" && ["source", "user", "ai-proposal"].includes(item.provenance.origin) && (item.code !== "requirement-ai-proposal" || item.provenance.origin === "ai-proposal") && (item.provenance.sourceName === null || label(item.provenance.sourceName, 255)) && (item.provenance.locator === null || label(item.provenance.locator, 1024)) : item.provenance === null;
}
function validView(value: unknown): value is IssueViewResult {
  if (!record(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return false;
  if (value.kind === "documents") return Array.isArray(value.documents) && value.documents.length <= 32 && value.documents.every(item => record(item) && shortId(item.id) && Number.isSafeInteger(item.documentRevision) && Number(item.documentRevision) > 0 && nonnegative(item.issueCount)) && (value.nextAfterId === null || shortId(value.nextAfterId));
  if (value.kind === "executionHistory") {
    const p = value.page;
    return record(p) && Array.isArray(p.items) && p.items.length <= 32 && p.items.every(item => {
      if (!record(item) || !shortId(item.attemptId) || !shortId(item.issueId) || !Number.isSafeInteger(item.projectRevision) || Number(item.projectRevision) < 1 || !["prepared", "dispatching", "running", "verifying", "outcome_unknown", "settled"].includes(String(item.phase)) || !(item.outcome === null || ["interrupted", "failed", "verification_finished", "reconciled_unknown"].includes(String(item.outcome))) || (item.phase === "settled") !== (item.outcome !== null) || typeof item.hasRuntimeReference !== "boolean" || !record(item.approvals)) return false;
      const keys = ["pending", "responding", "sent", "outcome_unknown", "expired"];
      return Object.keys(item.approvals).length === keys.length && keys.every(key => nonnegative((item.approvals as Record<string, unknown>)[key])) && keys.reduce((sum, key) => sum + Number((item.approvals as Record<string, unknown>)[key]), 0) <= 1024;
    }) && (p.nextAfterId === null || shortId(p.nextAfterId));
  }
  if (value.kind === "diagnostics") {
    const r = value.report;
    return record(r) && Number.isSafeInteger(r.documentRevision) && Number(r.documentRevision) > 0 && nonnegative(r.issueCount) && nonnegative(r.requirementCount) && nonnegative(r.linkedRequirementCount) && Number(r.linkedRequirementCount) <= Number(r.requirementCount) && nonnegative(r.totalFindings) && record(r.findings) && Array.isArray(r.findings.items) && r.findings.items.length <= 32 && r.findings.items.length <= Number(r.totalFindings) && r.findings.items.every(validFinding) && (r.findings.nextOffset === null || r.findings.items.length > 0 && nonnegative(r.findings.nextOffset) && Number(r.findings.nextOffset) < Number(r.totalFindings));
  }
  if (value.kind === "requirementDetail") {
    const r = value.requirement, p = value.page;
    return record(r) && shortId(r.id) && label(r.text, 32768) && ["source", "user", "ai-proposal"].includes(String(r.origin)) && (r.sourceName === null || label(r.sourceName, 255)) && (r.locator === null || label(r.locator, 1024)) && (r.category === null || label(r.category, 255)) && nonnegative(r.linkedIssueCount) && record(p) && Array.isArray(p.items) && p.items.length <= 32 && p.items.length <= Number(r.linkedIssueCount) && p.items.every(summary) && (p.nextOffset === null || p.items.length > 0 && nonnegative(p.nextOffset) && Number(p.nextOffset) < Number(r.linkedIssueCount));
  }
  if (value.kind === "projectIssues") {
    const p = value.page;
    return record(p) && (p.documentId === null || shortId(p.documentId)) && Array.isArray(p.items) && p.items.length <= 32 && p.items.every(summary) && (p.documentId === null ? p.items.length === 0 : p.items.length > 0) && nonnegative(p.scannedDocuments) && Number(p.scannedDocuments) <= 8 && (p.items.length === 0 && p.nextCursor === null || Number(p.scannedDocuments) > 0) && (p.nextCursor === null || validProjectIssueCursor(p.nextCursor));
  }
  if (value.kind === "candidatePreview") return validCandidateOptions(value.options) && Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 8 && value.items.every(item => record(item) && shortId(item.id) && label(item.title, 255) && typeof item.version === "string" && item.version.length <= 1024 && /^\d+\.\d+\.\d+$/.test(item.version) && nonnegative(item.order) && typeof item.localStatus === "string" && localStatus(item.localStatus) && Array.isArray(item.candidateReasons) && item.candidateReasons.length <= 4 && new Set(item.candidateReasons).size === item.candidateReasons.length && item.candidateReasons.every((reason: unknown) => typeof reason === "string" && ["state", "missing-criteria", "review", "dependency"].includes(reason)) && item.candidateReasons.includes("review") === (item.localStatus === "needs_review") && nonnegative(item.unverifiedDependencyCount) && item.candidateReasons.includes("dependency") === (Number(item.unverifiedDependencyCount) > 0) && Array.isArray(item.dependencyPreview) && item.dependencyPreview.length === Math.min(Number(item.unverifiedDependencyCount), MAX_PREVIEW_DEPENDENCIES) && item.dependencyPreview.every((dependency: unknown) => record(dependency) && shortId(dependency.id) && dependency.id !== item.id && label(dependency.title, 255)) && new Set(item.dependencyPreview.map((dependency: { id: string }) => dependency.id)).size === item.dependencyPreview.length);
  if (value.kind === "detail") return summary(value.issue) && record(value.issue) && label(value.issue.description, 32768) && nonnegative(value.issue.criteriaCount) && nonnegative(value.issue.requirementCount) && nonnegative(value.issue.dependencyCount) && Array.isArray(value.issue.candidateReasons) && value.issue.candidateReasons.length <= 4 && new Set(value.issue.candidateReasons).size === value.issue.candidateReasons.length && value.issue.candidateReasons.every((reason: unknown) => typeof reason === "string" && ["state", "missing-criteria", "review", "dependency"].includes(reason));
  if (!record(value.page) || !Array.isArray(value.page.items) || value.page.items.length > 32 || !(value.page.nextOffset === null || nonnegative(value.page.nextOffset))) return false;
  if (value.kind === "issues") return value.page.items.every(summary);
  if (value.kind === "categories") return value.page.items.every(item => record(item) && shortId(item.id) && label(item.title, 255) && typeof item.hasChildren === "boolean");
  if (value.kind === "criteria") return value.page.items.every(item => label(item, 32768));
  if (value.kind === "dependencies") return value.page.items.every(dependency);
  if (value.kind === "requirements") return value.page.items.every(item => record(item) && shortId(item.id) && label(item.text, 32768) && ["source", "user", "ai-proposal"].includes(String(item.origin)) && (item.sourceName === null || label(item.sourceName, 255)) && (item.locator === null || label(item.locator, 1024)));
  if (value.kind === "sourceTrace") return value.page.items.every(item => record(item) && shortId(item.sourceId) && label(item.sourceName, 255) && (item.requirement === null || record(item.requirement) && shortId(item.requirement.id) && label(item.requirement.text, 32768) && ["source", "user", "ai-proposal"].includes(String(item.requirement.origin)) && item.requirement.sourceName === item.sourceName && (item.requirement.locator === null || label(item.requirement.locator, 1024))));
  return false;
}

/** A well-shaped response must also correspond to the particular view request. */
function matchesViewRequest(view: IssueViewResult, query: IssueViewQuery | undefined): boolean {
  if (!query || view.kind !== query.kind || query.expectedRevision !== undefined && view.revision !== query.expectedRevision) return false;
  if (view.kind === "documents" && query.kind === "documents") {
    let previous = query.afterId ?? "";
    for (const item of view.documents) { if (item.id <= previous) return false; previous = item.id; }
    return view.nextAfterId === null || view.documents.length > 0 && view.nextAfterId === previous;
  }
  if (view.kind === "executionHistory" && query.kind === "executionHistory") {
    let previous = query.afterId ?? "";
    for (const item of view.page.items) { if (item.attemptId <= previous) return false; previous = item.attemptId; }
    return view.page.nextAfterId === null || view.page.items.length > 0 && view.page.nextAfterId === previous;
  }
  if (view.kind === "detail" && query.kind === "detail") return view.issue.id === query.issueId;
  if (view.kind === "candidatePreview" && query.kind === "candidatePreview") {
    const options = query.options ?? { includeRetryable: false, includeFailed: false };
    return view.options.includeRetryable === options.includeRetryable && view.options.includeFailed === options.includeFailed && view.items.length === query.issueIds.length && view.items.every((item, index) => item.id === query.issueIds[index] && item.candidateReasons.includes("state") === !(item.localStatus === "ready" || item.localStatus === "retryable" && options.includeRetryable || item.localStatus === "failed" && options.includeFailed));
  }
  if (view.kind === "projectIssues" && query.kind === "projectIssues") {
    const after = query.cursor.afterId ?? "", next = view.page.nextCursor;
    return (view.page.documentId === null || view.page.documentId > after) && (!next || (next.afterId ?? "") > after || (next.afterId ?? "") === after && next.issueOffset > query.cursor.issueOffset);
  }
  if (!("offset" in query)) return false;
  const offset = query.offset;
  const page = view.kind === "diagnostics" ? view.report.findings : "page" in view ? view.page : null;
  if (!page || !("nextOffset" in page)) return false;
  const end = offset + page.items.length;
  if (!Number.isSafeInteger(end) || page.nextOffset !== null && (page.items.length === 0 || page.nextOffset !== end)) return false;
  if (view.kind === "diagnostics") return end <= view.report.totalFindings && (page.nextOffset !== null ? end < view.report.totalFindings : end === view.report.totalFindings);
  if (view.kind === "requirementDetail" && query.kind === "requirementDetail") return view.requirement.id === query.requirementId && end <= view.requirement.linkedIssueCount && (page.nextOffset !== null ? end < view.requirement.linkedIssueCount : end === view.requirement.linkedIssueCount);
  return true;
}

export class IssueApi {
  private send: ((raw: string) => void) | null = null;
  private pending: Pending | null = null;
  private interruptPending: Pending | null = null;
  connect(send: (raw: string) => void): void { this.send = send; }
  disconnect(): void {
    this.send = null;
    const pending = [this.pending, this.interruptPending]; this.pending = null; this.interruptPending = null;
    for (const entry of pending) if (entry) { clearTimeout(entry.timer); entry.reject(new IssueApiError(mutating(entry.action) ? "OUTCOME_UNKNOWN" : "DISCONNECTED", mutating(entry.action) ? uncertainMessage(entry.action) : "브리지 연결이 끊겼습니다.")); }
  }
  request(action: "draftCreate" | "draftReplace" | "draftReview" | "draftRegister" | "draftPersist" | "semanticSave" | "semanticReview" | "planStart" | "planApply", query: DraftInput): Promise<IssueBindingResult>;
  request(action: "draftRead" | "draftRestore" | "draftInspectSaved" | "draftRebase" | "draftCopy"): Promise<IssueBindingResult>;
  request(action: "export", query: { documentId: string; expectedRevision: number }): Promise<IssueBindingResult>;
  request(action: "sourceRead", query: { sourceId: string; offset: number }): Promise<IssueBindingResult>;
  request(action: "sourceRemove", query: { sourceId: string }): Promise<IssueBindingResult>;
  request(action: "snapshotPrepare", query: AnalysisSnapshotRequest): Promise<IssueBindingResult>;
  request(action: "snapshotCheck", query: FreshnessRequest): Promise<IssueBindingResult>;
  request(action: "semanticStart", query: { snapshotId: string; expectedRevision: number; draftRevision: number; index: number }): Promise<IssueBindingResult>;
  request(action: "analysisStart", query: { snapshotId: string; expectedRevision: number }): Promise<IssueBindingResult>;
  request(action: "analysisSegment", query: { index: number; offset: number }): Promise<IssueBindingResult>;
  request(action: "analysisRetry", query: { index: number }): Promise<IssueBindingResult>;
  request(action: Exclude<Action, "export" | "sourceRead" | "sourceRemove" | "snapshotPrepare" | "snapshotCheck" | "analysisStart" | "analysisSegment" | "analysisRetry" | "draftCreate" | "draftRead" | "draftReplace" | "draftReview" | "draftRegister" | "draftPersist" | "draftRestore" | "draftInspectSaved" | "draftRebase" | "draftCopy" | "semanticStart" | "semanticSave" | "semanticReview" | "planStart" | "planApply">, query?: IssueViewQuery): Promise<IssueBindingResult>;
  request(action: Action, query?: IssueViewQuery | { documentId: string; expectedRevision: number } | { sourceId: string; offset?: number } | AnalysisSnapshotRequest | FreshnessRequest | { snapshotId: string; expectedRevision: number; draftRevision?: number; index?: number } | { index: number; offset?: number } | DraftInput): Promise<IssueBindingResult> {
    if (!this.send) return Promise.reject(new IssueApiError("DISCONNECTED", "브리지 연결이 끊겼습니다."));
    const priority = action === "analysisInterrupt" || action === "semanticInterrupt" || action === "planInterrupt";
    if (priority && this.interruptPending) return Promise.reject(new IssueApiError("BUSY", "이전 중단 요청을 기다려 주세요."));
    if (!priority && this.pending) {
      if (action === "status" && this.pending.action === "status") return this.pending.promise;
      return Promise.reject(new IssueApiError("BUSY", "이전 이슈 요청이 끝날 때까지 기다려 주세요."));
    }
    const id = crypto.randomUUID();
    let resolve!: Pending["resolve"], reject!: Pending["reject"];
    const promise = new Promise<IssueBindingResult>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => {
      if ((priority ? this.interruptPending : this.pending)?.id !== id) return;
      if (priority) this.interruptPending = null; else this.pending = null;
      reject(new IssueApiError(mutating(action) ? "OUTCOME_UNKNOWN" : "TIMEOUT", mutating(action) ? uncertainMessage(action) : "이슈 요청 시간이 초과되었습니다."));
    }, action === "bind" || action === "import" || action === "export" || action === "sourceAdd" || action === "authorizeView" || action === "snapshotCheck" ? 360_000 : 45_000);
    const sourceQuery = query && "sourceId" in query ? query : undefined;
    const snapshotQuery = action === "snapshotPrepare" ? query as AnalysisSnapshotRequest : undefined;
    const freshnessQuery = action === "snapshotCheck" ? query as FreshnessRequest : undefined;
    const viewQuery = action === "view" && query && "kind" in query ? query as IssueViewQuery : undefined;
    const segmentQuery = action === "analysisSegment" && query && "index" in query ? query as { index: number; offset?: number } : undefined;
    const entry: Pending = { id, action, ...(sourceQuery ? { sourceId: sourceQuery.sourceId, offset: sourceQuery.offset } : {}), ...(segmentQuery ? { segmentIndex: segmentQuery.index, offset: segmentQuery.offset } : {}), ...(viewQuery ? { viewQuery: viewQuery.kind === "projectIssues" ? { ...viewQuery, cursor: { ...viewQuery.cursor } } : viewQuery.kind === "candidatePreview" ? { ...viewQuery, issueIds: [...viewQuery.issueIds], ...(viewQuery.options ? { options: { ...viewQuery.options } } : {}) } : { ...viewQuery } } : {}), ...(snapshotQuery ? { snapshotRequest: { expectedRevision: snapshotQuery.expectedRevision, expectedSources: snapshotQuery.expectedSources.map(item => ({ ...item })), hasInstruction: !!snapshotQuery.instruction.trim() } } : {}), ...(freshnessQuery ? { freshnessRequest: { ...freshnessQuery, expectedIds: [...freshnessQuery.expectedIds] } } : {}), promise, resolve, reject, timer };
    if (priority) this.interruptPending = entry; else this.pending = entry;
    const type = action === "planStart" ? "issues.plan.start" : action === "planStatus" ? "issues.plan.status" : action === "planInterrupt" ? "issues.plan.interrupt" : action === "planClear" ? "issues.plan.clear" : action === "planApply" ? "issues.plan.apply" : action === "semanticSave" ? "issues.semantic.save" : action === "semanticReview" ? "issues.semantic.review" : action === "semanticStart" ? "issues.semantic.start" : action === "semanticStatus" ? "issues.semantic.status" : action === "semanticInterrupt" ? "issues.semantic.interrupt" : action === "semanticClear" ? "issues.semantic.clear" : action === "draftCopy" ? "issues.draft.copy" : action === "draftInspectSaved" ? "issues.draft.inspectSaved" : action === "draftRebase" ? "issues.draft.rebase" : action === "draftPersist" ? "issues.draft.persist" : action === "draftRestore" ? "issues.draft.restore" : action === "draftCreate" ? "issues.draft.create" : action === "draftRead" ? "issues.draft.read" : action === "draftReplace" ? "issues.draft.replace" : action === "draftReview" ? "issues.draft.review" : action === "draftRegister" ? "issues.draft.register" : action === "import" ? "issues.document.import" : action === "export" ? "issues.document.export" : action === "authorizeView" ? "issues.view.authorize" : action === "view" ? "issues.view.query" : action === "releaseView" ? "issues.view.release" : action === "sourceAdd" ? "issues.sources.add" : action === "sourceList" ? "issues.sources.list" : action === "sourceRead" ? "issues.sources.read" : action === "sourceRemove" ? "issues.sources.remove" : action === "snapshotPrepare" ? "issues.analysis.prepare" : action === "snapshotCheck" ? "issues.analysis.check" : action === "analysisStatus" ? "issues.analysis.status" : action === "analysisStart" ? "issues.analysis.start" : action === "analysisInterrupt" ? "issues.analysis.interrupt" : action === "analysisClear" ? "issues.analysis.clear" : action === "analysisSegment" ? "issues.analysis.segment" : action === "analysisRetry" ? "issues.analysis.retry" : `issues.project.${action}`;
    try { this.send(JSON.stringify({ type, v: 1, clientRequestId: id, ...(action === "view" ? { query } : {}), ...(["draftCreate", "draftReplace", "draftReview", "draftRegister", "draftPersist", "semanticSave", "semanticReview", "planStart", "planApply"].includes(action) ? query : {}), ...(action === "export" || action === "sourceRead" || action === "sourceRemove" || action === "snapshotPrepare" || action === "analysisStart" || action === "analysisSegment" || action === "analysisRetry" || action === "semanticStart" ? query : {}), ...(freshnessQuery ? { snapshotId: freshnessQuery.snapshotId, expectedRevision: freshnessQuery.expectedRevision } : {}) })); }
    catch { clearTimeout(timer); if (priority) this.interruptPending = null; else this.pending = null; reject(new IssueApiError("DISCONNECTED", "브리지에 요청을 전달하지 못했습니다.")); }
    return promise;
  }
  receive(input: unknown): boolean {
    if (!input || typeof input !== "object" || Array.isArray(input) || !("type" in input) || input.type !== "issues.project.result") return false;
    const message = input as Record<string, unknown>, pending = this.interruptPending?.id === message.clientRequestId ? this.interruptPending : this.pending;
    if (!pending || message.v !== 1 || message.clientRequestId !== pending.id || message.action !== pending.action) return true;
    clearTimeout(pending.timer); if (pending === this.interruptPending) this.interruptPending = null; else this.pending = null;
    if (message.ok === true && (!["draftCreate", "draftRead", "draftReplace", "draftReview", "draftPersist", "draftRestore", "draftInspectSaved", "draftRebase", "draftCopy", "semanticSave", "semanticReview", "planApply"].includes(pending.action) || validDraft(message.draft)) && (pending.action !== "draftInspectSaved" || typeof message.savedStale === "boolean") && (pending.action !== "draftRegister" || message.cancelled === true || nonnegative(message.issueCount) && typeof message.alreadyImported === "boolean") && typeof message.bound === "boolean" && (message.cancelled === undefined || message.cancelled === true) && (!["analysisStatus", "analysisStart", "analysisInterrupt", "analysisClear", "analysisRetry"].includes(pending.action) || message.bound && validAnalysisStatus(message.analysisStatus) && message.cancelled === undefined) && (!["semanticStart", "semanticStatus", "semanticInterrupt", "semanticClear"].includes(pending.action) || message.bound && validSemanticStatus(message.semanticStatus)) && (!["planStart", "planStatus", "planInterrupt", "planClear"].includes(pending.action) || message.bound && validPlanStatus(message.planStatus)) && (pending.action !== "analysisSegment" || message.bound && validAnalysisSegment(message.analysisSegment, pending) && message.cancelled === undefined) && (pending.action !== "import" || message.bound && (message.cancelled === true || nonnegative(message.issueCount) && typeof message.alreadyImported === "boolean")) && (pending.action !== "export" || message.bound && (message.cancelled === true || typeof message.cleanupWarning === "boolean")) && (!["sourceAdd", "sourceList", "sourceRemove"].includes(pending.action) || message.bound && (pending.action === "sourceAdd" && message.cancelled === true || validSources(message.sources))) && (pending.action !== "sourceRead" || message.bound && validChunk(message.chunk, pending)) && (pending.action !== "snapshotPrepare" || message.bound && validSnapshot(message.snapshot, pending)) && (pending.action !== "snapshotCheck" || message.bound && validFreshness(message.freshness, pending)) && (pending.action !== "view" || message.bound && validView(message.view) && matchesViewRequest(message.view, pending.viewQuery)) && (pending.action !== "authorizeView" || typeof message.authorized === "boolean" && (!message.authorized || nonnegative(message.authorizedForMs) && Number(message.authorizedForMs) > 0 && Number(message.authorizedForMs) <= 15 * 60_000))) {
      pending.resolve({ bound: message.bound, ...(["planStart", "planStatus", "planInterrupt", "planClear"].includes(pending.action) ? { planStatus: message.planStatus as PlanStatus } : {}), ...(["semanticStart", "semanticStatus", "semanticInterrupt", "semanticClear"].includes(pending.action) ? { semanticStatus: message.semanticStatus as SemanticStatus } : {}), ...(pending.action === "draftInspectSaved" ? { savedStale: message.savedStale as boolean } : {}), ...(["draftCreate", "draftRead", "draftReplace", "draftReview", "draftPersist", "draftRestore", "draftInspectSaved", "draftRebase", "draftCopy", "semanticSave", "semanticReview", "planApply"].includes(pending.action) ? { draft: message.draft as DraftState } : {}), ...(pending.action === "draftRegister" && message.cancelled !== true ? { issueCount: Number(message.issueCount), alreadyImported: message.alreadyImported as boolean } : {}), ...(message.cancelled === true ? { cancelled: true } : {}), ...(["analysisStatus", "analysisStart", "analysisInterrupt", "analysisClear", "analysisRetry"].includes(pending.action) ? { analysisStatus: message.analysisStatus as AnalysisRunStatus } : {}), ...(pending.action === "import" && message.cancelled !== true ? { issueCount: Number(message.issueCount), alreadyImported: message.alreadyImported as boolean } : {}), ...(pending.action === "export" && message.cancelled !== true ? { cleanupWarning: message.cleanupWarning as boolean } : {}), ...(["sourceAdd", "sourceList", "sourceRemove"].includes(pending.action) && message.cancelled !== true ? { sources: message.sources as AnalysisSourceList } : {}), ...(pending.action === "analysisSegment" ? { analysisSegment: message.analysisSegment as AnalysisSegmentPage } : {}), ...(pending.action === "sourceRead" ? { chunk: message.chunk as AnalysisSourceChunk } : {}), ...(pending.action === "snapshotPrepare" ? { snapshot: message.snapshot as AnalysisSnapshotSummary } : {}), ...(pending.action === "snapshotCheck" ? { freshness: message.freshness as AnalysisFreshness } : {}), ...(pending.action === "view" ? { view: message.view as IssueViewResult } : {}), ...(pending.action === "authorizeView" ? { authorized: message.authorized as boolean, ...(message.authorized ? { authorizedForMs: Number(message.authorizedForMs) } : {}) } : {}) });
    } else if (message.ok === false && message.error && typeof message.error === "object") {
      const error = message.error as Record<string, unknown>;
      pending.reject(new IssueApiError(typeof error.code === "string" ? error.code.slice(0, 64) : "INVALID_RESPONSE", error.code === "OUTCOME_UNKNOWN" ? uncertainMessage(pending.action) : typeof error.message === "string" ? error.message.slice(0, 200) : "이슈 응답을 확인할 수 없습니다."));
    } else pending.reject(new IssueApiError(mutating(pending.action) ? "OUTCOME_UNKNOWN" : "INVALID_RESPONSE", mutating(pending.action) ? uncertainMessage(pending.action) : "이슈 응답을 확인할 수 없습니다."));
    return true;
  }
}
