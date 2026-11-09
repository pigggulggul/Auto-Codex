import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueApi } from "./api";
import { DraftReviews, PlanningEditor } from "./PlanningEditor";

describe("manual issue draft", () => {
  it("presents labelled inputs and requires content before adding", () => {
    const html = renderToStaticMarkup(<PlanningEditor api={new IssueApi()} revision={1} loading={false} setLoading={() => {}} onRegistered={() => {}} onError={() => {}} />);
    expect(html).toContain("이슈 초안");
    expect(html).toContain("요구사항");
    expect(html).toContain("완료 조건 (한 줄에 하나씩)");
    expect(html).toMatch(/<button type="button" disabled="">초안에 추가/);
    expect(html).not.toContain("초안 등록</button>");
  });
  it("shows the selected candidate as a proposal requiring an explicit action", () => {
    const candidate = { id: "candidate-1", text: "분석 제안", origin: "ai-proposal" as const, uncertainty: "확인 필요", evidence: null };
    const html = renderToStaticMarkup(<PlanningEditor api={new IssueApi()} revision={1} loading={false} setLoading={() => {}} onRegistered={() => {}} onError={() => {}} candidate={candidate} onCandidateConsumed={() => {}} />);
    expect(html).toContain("분석 제안");
    expect(html).toContain("확인 필요");
    expect(html).toContain("후보를 입력에 불러오기");
    expect(html).not.toContain("초안 등록</button>");
  });
  it("shows review status and requires a reason for decisions", () => {
    const draft = { projectRevision: 1, revision: 1, document: { format: "auto-codex-issues" as const, formatVersion: 1 as const, documentId: "doc", revision: 1, sources: [], categories: [], requirements: [{ id: "req", categoryId: null, text: "요구사항", origin: "user" as const }], issues: [{ id: "issue", categoryId: null, requirementIds: ["req"], version: "1.0.0", order: 0, title: "작업", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" as const }] }, reviews: [{ requirementId: "req", issueId: "issue", decision: "deferred" as const, reason: "근거 확인" }], history: [] };
    const html = renderToStaticMarkup(<DraftReviews draft={draft} loading={false} reasons={{}} setReasons={() => {}} onReview={() => {}} />);
    expect(html).toContain("보류: 근거 확인");
    expect(html).toMatch(/<button type="button" disabled="">연결 확인/);
    expect(html).toContain("등록 시 저장되지 않습니다");
  });
});
