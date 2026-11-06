import type { IssueStore } from "./store.js";
import type { ExecutionJournal, JournalRecord } from "./execution-journal.js";
import { freezeExecutionPolicy, prepareExecutionIntent, type ExecutionIntentInput, type FrozenExecutionIntent } from "./execution-intent.js";
import { selectExecutionCandidates } from "./execution-candidates.js";

export class StoredIntentError extends Error {
  constructor(readonly code: "NOT_FOUND" | "NOT_ELIGIBLE" | "INVALID_PLAN" | "STORAGE_FAILED" | "STALE_SELECTION" | "VERSION_CONFLICT") { super(code); }
}

/**
 * Internal preparation only. The caller must authenticate, hold admission and
 * recheck the project, policy and actual runtime immediately before dispatch.
 * The document text is untrusted data; JSON serialization is not a prompt-injection defense.
 */
export async function prepareStoredIssueIntent(store: IssueStore, journal: ExecutionJournal, input: { projectId: string; documentId: string; expectedRevision: number; issueId: string; idempotencyKey: string; policy: ExecutionIntentInput["policy"]; mayPrepare: () => boolean }): Promise<{ intent: FrozenExecutionIntent; record: JournalRecord; created: boolean }> {
  const { projectId, documentId, expectedRevision, issueId, idempotencyKey, mayPrepare } = input;
  const checkAdmission = () => {
    let allowed = false;
    try { allowed = typeof mayPrepare === "function" && mayPrepare() === true; } catch { /* A failed check is not authorization. */ }
    if (!allowed) throw new StoredIntentError("STALE_SELECTION");
  };
  checkAdmission();
  const policy = freezeExecutionPolicy(input.policy);
  const { document, issues } = await store.readDocument(projectId, documentId, expectedRevision);
  checkAdmission();
  const issue = document.issues.find(item => item.id === issueId), states = new Map(issues.map(item => [item.issueId, item]));
  if (!issue) throw new StoredIntentError("NOT_FOUND");
  const status = states.get(issue.id);
  if (!status) throw new StoredIntentError("STORAGE_FAILED");
  const candidates = selectExecutionCandidates(document.issues.map(item => {
    const state = states.get(item.id);
    if (!state) throw new StoredIntentError("STORAGE_FAILED");
    return { id: item.id, version: item.version, order: item.order, dependencyIds: item.dependencyIds, localState: state.localStatus, locallyVerifiedComplete: false, hasAcceptanceCriteria: item.acceptanceCriteria.length > 0, requiresReview: state.localStatus === "needs_review" };
  }), { selectedIds: [issue.id] });
  if (candidates.kind !== "candidates") throw new StoredIntentError("INVALID_PLAN");
  if (candidates.eligibleIds.length !== 1 || candidates.eligibleIds[0] !== issue.id || candidates.excluded.length !== 0) throw new StoredIntentError("NOT_ELIGIBLE");
  const requirements = new Map(document.requirements.map(item => [item.id, item])), sources = new Map(document.sources.map(item => [item.id, item]));
  const category = document.categories.find(item => item.id === issue.categoryId);
  const instruction = JSON.stringify({ format: "auto-codex-issue-data-v1", issue: { id: issue.id, title: issue.title, description: issue.description, version: issue.version, order: issue.order, acceptanceCriteria: issue.acceptanceCriteria, category: category ? { id: category.id, title: category.title } : null, localStatus: status.localStatus, importedStatus: status.importedStatus }, requirements: issue.requirementIds.map(id => {
    const requirement = requirements.get(id);
    if (!requirement) throw new StoredIntentError("STORAGE_FAILED");
    const source = requirement.sourceId ? sources.get(requirement.sourceId) : undefined;
    if (requirement.sourceId && !source) throw new StoredIntentError("STORAGE_FAILED");
    return { id, text: requirement.text, origin: requirement.origin, sourceId: requirement.sourceId ?? null, sourceName: source?.name ?? null, locator: requirement.locator ?? null };
  }), dependencyIds: issue.dependencyIds });
  checkAdmission();
  const currentProject = await store.readProject(projectId);
  checkAdmission();
  if (currentProject.id !== projectId || currentProject.revision !== expectedRevision) throw new StoredIntentError("VERSION_CONFLICT");
  return prepareExecutionIntent(journal, { projectId, documentId, issueId: issue.id, projectRevision: expectedRevision, documentRevision: document.revision, instruction, policy }, idempotencyKey);
}
