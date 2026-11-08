import { describe, expect, it } from "vitest";
import { parseIssueDocument } from "./document.js";
import { PlanningDraft, PlanningDraftError } from "./planning-draft.js";

function example() {
  return {
    format: "auto-codex-issues", formatVersion: 1, documentId: "doc-1", revision: 1,
    sources: [], categories: [],
    requirements: [{ id: "req-1", categoryId: null, text: "사용자는 기록을 볼 수 있다", origin: "user" }],
    issues: [{ id: "issue-1", categoryId: null, requirementIds: ["req-1"], version: "1.0.0", order: 0, title: "기록 보기", description: "기록을 표시한다", acceptanceCriteria: ["기록이 보인다"], dependencyIds: [], status: "ready" }],
  };
}

describe("planning draft review boundary", () => {
  it("records a human decision for a real link without claiming completeness", () => {
    const draft = new PlanningDraft(example(), 4);
    expect(draft.coverage(1)).toMatchObject({ links: 1, reviewed: 0, unreviewed: 1, semanticCompleteness: "unverified" });
    draft.review(1, { requirementId: "req-1", issueId: "issue-1", decision: "confirmed", reason: "표시 동작을 비교함" });
    expect(draft.coverage(1)).toMatchObject({ reviewed: 1, deferred: 0, unreviewed: 0, semanticCompleteness: "unverified" });
    expect(parseIssueDocument(draft.exportForRegistration(1, 4)).issues[0].title).toBe("기록 보기");
  });

  it("rejects forged or unrelated links and requires a bounded reason", () => {
    const draft = new PlanningDraft(example(), 4);
    for (const review of [
      { requirementId: "other", issueId: "issue-1", decision: "confirmed", reason: "확인" },
      { requirementId: "req-1", issueId: "issue-1", decision: "confirmed", reason: " " },
      { requirementId: "req-1", issueId: "issue-1", decision: "deferred", reason: "확인", permission: "all" },
    ]) expect(() => draft.review(1, review)).toThrow(PlanningDraftError);
    expect(draft.coverage(1).reviewed).toBe(0);
  });

  it("invalidates decisions on edits, rejects stale updates and isolates returned copies", () => {
    const draft = new PlanningDraft(example(), 4);
    draft.review(1, { requirementId: "req-1", issueId: "issue-1", decision: "deferred", reason: "근거 확인 필요" });
    const copy = draft.read();
    copy.document.issues[0].title = "수정";
    expect(draft.read().document.issues[0].title).toBe("기록 보기");
    draft.replace(1, copy.document);
    expect(draft.coverage(2)).toMatchObject({ reviewed: 0, unreviewed: 1 });
    expect(draft.read().history).toEqual([{ revision: 1, review: { requirementId: "req-1", issueId: "issue-1", decision: "deferred", reason: "근거 확인 필요" } }]);
    const historyCopy = draft.read();
    historyCopy.history[0].review.reason = "변조";
    expect(draft.read().history[0].review.reason).toBe("근거 확인 필요");
    expect(() => draft.review(1, { requirementId: "req-1", issueId: "issue-1", decision: "confirmed", reason: "확인" })).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
    expect(() => draft.exportForRegistration(2, 5)).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
  });

  it("preserves previous decisions when a review is changed", () => {
    const draft = new PlanningDraft(example(), 4);
    draft.review(1, { requirementId: "req-1", issueId: "issue-1", decision: "deferred", reason: "검토 필요" });
    draft.review(1, { requirementId: "req-1", issueId: "issue-1", decision: "confirmed", reason: "검토함" });
    expect(draft.read().history[0]).toMatchObject({ revision: 1, review: { decision: "deferred" } });
    expect(draft.coverage(1)).toMatchObject({ reviewed: 1, deferred: 0 });
  });

  it("rejects invalid documents and preserves the last valid state", () => {
    const draft = new PlanningDraft(example(), 4);
    const original = example();
    const bad = { ...original, issues: [{ ...original.issues[0], dependencyIds: ["missing"] }] };
    expect(() => draft.replace(1, bad)).toThrow(PlanningDraftError);
    expect(draft.read().revision).toBe(1);
    expect(() => draft.replace(1, { ...example(), documentId: "other" })).toThrow(PlanningDraftError);
    expect(() => new PlanningDraft({ ...example(), extra: true }, 4)).toThrow(PlanningDraftError);
  });
});
