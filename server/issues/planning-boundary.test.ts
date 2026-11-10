import { describe, expect, it } from "vitest";
import { PlanningDraft } from "./planning-draft.js";
import { PlanningProposalSession, parsePlanningProposals } from "./planning-proposal.js";
import { parseSemanticFindings, SemanticValidationRun } from "./semantic-validation.js";

const document = () => ({ format: "auto-codex-issues", formatVersion: 1, documentId: "doc-1", revision: 1, sources: [], categories: [], requirements: [{ id: "req-1", categoryId: null, text: "기록 보기", origin: "user" }], issues: [{ id: "issue-1", categoryId: null, requirementIds: ["req-1"], version: "1.0.0", order: 0, title: "기록", description: "기록 표시", acceptanceCriteria: ["기록 확인"], dependencyIds: [], status: "ready" }] });
const segment = { snapshotId: "snapshot-1", projectRevision: 4, sourceId: "source-1", sourcePath: "synthetic.txt", sourceSha256: "a".repeat(64), segmentId: "segment-1", offset: 20, text: "사용자는 기록을 확인한다." };
const semanticInput = () => ({ projectRevision: 4, draftRevision: 1, document: new PlanningDraft(document(), 4).read().document, segment });
const finding = { kind: "possible-mismatch", summary: "조건 확인", uncertainty: "추가 검토 필요", requirementId: "req-1", issueId: "issue-1", quote: "기록을 확인" };
const proposal = { target: "issue", targetId: "issue-1", field: "title", after: "기록 보기", reason: "의도 명확화", uncertainty: "확인 필요" };

describe("model output and draft trust boundary", () => {
  it("binds source evidence to trusted input and rejects fabricated targets or quotes", () => {
    const input = semanticInput();
    const result = parseSemanticFindings(JSON.stringify({ findings: [finding] }), input);
    expect(result.findings[0].evidence).toMatchObject({ sourceId: segment.sourceId, sourceSha256: segment.sourceSha256, start: 25, end: 31 });
    for (const bad of [{ ...finding, requirementId: "other" }, { ...finding, quote: "없는 문구" }, { ...finding, command: "synthetic-command" }]) expect(() => parseSemanticFindings(JSON.stringify({ findings: [bad] }), input)).toThrow();
    expect(() => parseSemanticFindings('{"findings":[],"findings":[]}', input)).toThrow();
  });

  it("persists semantic decisions and makes them stale after a draft change", () => {
    const draft = new PlanningDraft(document(), 4), result = parseSemanticFindings(JSON.stringify({ findings: [finding] }), semanticInput());
    draft.addSemanticResult(1, 0, result);
    draft.reviewSemantic(1, result.findings[0].id, "deferred", "원문 확인 필요");
    const restored = PlanningDraft.restore(JSON.parse(JSON.stringify(draft.read())));
    expect(restored.read().validations[0].decisions[0].reason).toBe("원문 확인 필요");
    restored.replace(1, restored.read().document);
    expect(() => restored.reviewSemantic(2, result.findings[0].id, "resolved", "확인")).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
  });

  it("does not publish a result after the source changes during the model call", async () => {
    let count = 0;
    const run = new SemanticValidationRun(async () => { const input = semanticInput(); if (++count > 1) input.segment = { ...segment, text: "변경된 자료" }; return input; });
    await run.start(async () => JSON.stringify({ findings: [finding] }));
    expect(run.read()).toEqual({ state: "stale", result: null });
  });

  it("only applies a selected allowed proposal to the captured draft revision", () => {
    const draft = new PlanningDraft(document(), 4), snapshot = draft.read();
    expect(() => parsePlanningProposals(JSON.stringify({ proposals: [{ ...proposal, targetId: "other" }] }), snapshot)).toThrow();
    expect(() => parsePlanningProposals(JSON.stringify({ proposals: [{ ...proposal, field: "status" }] }), snapshot)).toThrow();
    const session = new PlanningProposalSession(snapshot, JSON.stringify({ proposals: [proposal] }));
    expect(draft.read().document.issues[0].title).toBe("기록");
    session.apply(draft, 1, session.read().proposals[0].id);
    expect(draft.read().document.issues[0]).toMatchObject({ title: "기록 보기", status: "needs_review" });
    expect(() => session.read()).toThrow();
    const stale = new PlanningProposalSession(snapshot, JSON.stringify({ proposals: [proposal] }));
    expect(() => stale.apply(draft, 1, stale.read().proposals[0].id)).toThrowError(expect.objectContaining({ code: "STALE_INPUT" }));
  });
});
