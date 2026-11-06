import { comparePlannedIssues, validateIssuePlan, type PlannedIssue, type PlanFinding } from "../../shared/issues/planning.js";

type LocalState = "ready" | "retryable" | "failed" | "needs_review" | "completed";
export type ExecutionCandidateIssue = PlannedIssue & {
  localState: LocalState;
  /** Set only by a future trusted local verification, never by an imported document. */
  locallyVerifiedComplete: boolean;
  hasAcceptanceCriteria: boolean;
  requiresReview: boolean;
};
type EligibleState = "ready" | "retryable" | "failed";
type Exclusion = "state" | "missing-criteria" | "review" | "dependency";
export type CandidateResult =
  | { kind: "invalid-plan"; findings: PlanFinding[] }
  | { kind: "candidates"; eligibleIds: string[]; excluded: { id: string; reasons: Exclusion[] }[] };

/**
 * Pure, server-internal preview of eligibility, not permission to dispatch.
 * The caller must supply a complete trusted project snapshot, validate its revision,
 * re-evaluate before each dispatch, and enforce admission and actual local evidence.
 * In particular, imported completed status is not local verification.
 */
export function selectExecutionCandidates(
  issues: readonly ExecutionCandidateIssue[],
  options: { selectedIds: readonly string[]; states?: readonly EligibleState[] },
): CandidateResult {
  if (issues.some(issue => typeof issue.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(issue.id))) throw new Error("INVALID_ISSUE_ID");
  const findings = validateIssuePlan(issues);
  if (findings.length) return { kind: "invalid-plan", findings };
  const byId = new Map(issues.map(issue => [issue.id, issue]));
  const selected = new Set(options.selectedIds);
  if (selected.size !== options.selectedIds.length || [...selected].some(id => !byId.has(id))) throw new Error("INVALID_SELECTION");
  const states = new Set(options.states ?? ["ready"]);
  if (options.states && states.size !== options.states.length || [...states].some(state => !["ready", "retryable", "failed"].includes(state))) throw new Error("INVALID_STATES");
  const eligibleIds: string[] = [], excluded: { id: string; reasons: Exclusion[] }[] = [];
  for (const issue of issues.filter(item => selected.has(item.id)).sort(comparePlannedIssues)) {
    const reasons: Exclusion[] = [];
    if (!states.has(issue.localState as EligibleState)) reasons.push("state");
    if (issue.hasAcceptanceCriteria !== true) reasons.push("missing-criteria");
    if (issue.requiresReview !== false) reasons.push("review");
    if (issue.dependencyIds.some(id => {
      const dependency = byId.get(id)!;
      return dependency.localState !== "completed" || dependency.locallyVerifiedComplete !== true;
    })) reasons.push("dependency");
    if (reasons.length) excluded.push({ id: issue.id, reasons });
    else eligibleIds.push(issue.id);
  }
  return { kind: "candidates", eligibleIds, excluded };
}
