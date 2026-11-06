import { describe, expect, it } from "vitest";
import { selectExecutionCandidates, type ExecutionCandidateIssue } from "./execution-candidates.js";

const issue = (id: string, overrides: Partial<ExecutionCandidateIssue> = {}): ExecutionCandidateIssue => ({
  id, version: "1.0.0", order: 0, dependencyIds: [], localState: "ready",
  locallyVerifiedComplete: false, hasAcceptanceCriteria: true, requiresReview: false, ...overrides,
});

describe("server-only execution candidate preview", () => {
  it("selects only explicitly selected ready issues in numeric version, order and ID order", () => {
    const items = [issue("late", { version: "1.10.0" }), issue("b", { version: "1.2.0" }), issue("a", { version: "1.2.0" }), issue("not-selected")];
    expect(selectExecutionCandidates(items, { selectedIds: ["late", "b", "a"] })).toEqual({ kind: "candidates", eligibleIds: ["a", "b", "late"], excluded: [] });
  });
  it("does not treat an imported completion or another selected issue as verified dependency evidence", () => {
    const parent = issue("parent", { localState: "completed" });
    const child = issue("child", { dependencyIds: ["parent"] });
    expect(selectExecutionCandidates([parent, child], { selectedIds: ["child"] })).toEqual({ kind: "candidates", eligibleIds: [], excluded: [{ id: "child", reasons: ["dependency"] }] });
    expect(selectExecutionCandidates([{ ...parent, locallyVerifiedComplete: true }, child], { selectedIds: ["child"] })).toEqual({ kind: "candidates", eligibleIds: ["child"], excluded: [] });
    expect(selectExecutionCandidates([{ ...parent, localState: "ready", locallyVerifiedComplete: true }, child], { selectedIds: ["parent", "child"] })).toMatchObject({ excluded: [{ id: "child", reasons: ["dependency"] }] });
  });
  it("requires explicit retry and failure states and always excludes review, missing criteria and completed issues", () => {
    const items = [issue("retry", { localState: "retryable" }), issue("failed", { localState: "failed" }), issue("review", { localState: "needs_review", requiresReview: true }), issue("empty", { hasAcceptanceCriteria: false }), issue("done", { localState: "completed" })];
    const ids = items.map(item => item.id);
    expect(selectExecutionCandidates(items, { selectedIds: ids })).toMatchObject({ eligibleIds: [] });
    expect(selectExecutionCandidates(items, { selectedIds: ids, states: ["ready", "retryable", "failed"] })).toEqual({ kind: "candidates", eligibleIds: ["failed", "retry"], excluded: [{ id: "done", reasons: ["state"] }, { id: "empty", reasons: ["missing-criteria"] }, { id: "review", reasons: ["state", "review"] }] });
  });
  it("rejects invalid graph and invalid selections rather than returning a partial plan", () => {
    expect(() => selectExecutionCandidates([issue("../outside")], { selectedIds: ["../outside"] })).toThrow("INVALID_ISSUE_ID");
    expect(() => selectExecutionCandidates([issue("a")], { selectedIds: ["a"], states: ["ready", "ready"] })).toThrow("INVALID_STATES");
    expect(selectExecutionCandidates([issue("a", { dependencyIds: ["missing"] })], { selectedIds: ["a"] })).toMatchObject({ kind: "invalid-plan" });
    expect(selectExecutionCandidates([issue("a", { dependencyIds: ["b"] }), issue("b", { dependencyIds: ["a"] })], { selectedIds: ["a"] })).toMatchObject({ kind: "invalid-plan" });
    expect(() => selectExecutionCandidates([issue("a")], { selectedIds: ["missing"] })).toThrow("INVALID_SELECTION");
    expect(() => selectExecutionCandidates([issue("a")], { selectedIds: ["a", "a"] })).toThrow("INVALID_SELECTION");
  });
  it("fails closed when safety flags are absent in a malformed internal snapshot", () => {
    const malformed = issue("a", { hasAcceptanceCriteria: undefined, requiresReview: undefined });
    expect(selectExecutionCandidates([malformed], { selectedIds: ["a"] })).toEqual({ kind: "candidates", eligibleIds: [], excluded: [{ id: "a", reasons: ["missing-criteria", "review"] }] });
  });
});
