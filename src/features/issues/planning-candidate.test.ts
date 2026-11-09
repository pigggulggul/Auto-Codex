import { describe, expect, it } from "vitest";
import type { IssueDocument } from "../../../server/issues/document";
import type { AnalysisCandidate } from "../../../shared/issues/sources";
import { addCandidateRequirement } from "./planning-candidate";
import { parseIssueDocument, serializeIssueDocument } from "../../../server/issues/document";

const document = (): IssueDocument => ({ format: "auto-codex-issues", formatVersion: 1, documentId: "doc-1", revision: 1, sources: [], categories: [], requirements: [], issues: [] });
const candidate: AnalysisCandidate = { id: "candidate-1", text: "제안", origin: "source", uncertainty: "검토 필요", evidence: { sourceId: "source-1", sourcePath: "docs/plan.md", sourceSha256: "a".repeat(64), segmentId: "segment-1", quote: "원문", start: 4, end: 6 } };

describe("selected analysis candidate", () => {
  it("preserves evidence and uncertainty while marking the requirement as an AI proposal", () => {
    const draft = document();
    addCandidateRequirement(draft, candidate, "req-1", "사용자가 수정한 제안");
    expect(draft.requirements[0]).toMatchObject({ text: "사용자가 수정한 제안", origin: "ai-proposal", sourceId: "source-1" });
    expect(draft.requirements[0].locator).toContain("인용: 원문");
    expect(draft.requirements[0].locator).toContain("불확실성: 검토 필요");
    expect(draft.sources).toEqual([{ id: "source-1", name: "docs/plan.md", contentHash: `sha256:${"a".repeat(64)}` }]);
    expect(parseIssueDocument(serializeIssueDocument(draft)).requirements[0]).toEqual(draft.requirements[0]);
    addCandidateRequirement(draft, candidate, "req-2", "두 번째");
    expect(draft.sources).toHaveLength(1);
  });
  it("rejects conflicting source metadata rather than replacing it", () => {
    const draft = document(); draft.sources.push({ id: "source-1", name: "다른 자료", contentHash: `sha256:${"b".repeat(64)}` });
    expect(() => addCandidateRequirement(draft, candidate, "req-1", "내용")).toThrow();
    expect(draft.requirements).toHaveLength(0);
  });
  it("keeps uncertainty for proposals without a source", () => {
    const draft = document(); addCandidateRequirement(draft, { id: "candidate-2", text: "제안", origin: "ai-proposal", uncertainty: "확인", evidence: null }, "req-1", "제안");
    expect(draft.requirements[0]).toMatchObject({ origin: "ai-proposal", locator: "불확실성: 확인" });
    expect(draft.sources).toHaveLength(0);
  });
});
