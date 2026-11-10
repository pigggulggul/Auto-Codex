import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueApi } from "./api";
import { DraftReviews, PlanningEditor } from "./PlanningEditor";
import { DraftCategories, removeDraftCategory, setDraftRequirementLink, updateDraftCategory } from "./DraftCategories";
import { DraftIndependentEditor, applyIndependentDraftEdit, removeIndependentDraftItem } from "./DraftIndependentEditor";

describe("manual issue draft", () => {
  it("shows independent category controls for requirements and issues", () => {
    const document = { format: "auto-codex-issues" as const, formatVersion: 1 as const, documentId: "doc", revision: 1, sources: [], categories: [{ id: "cat", parentId: null, title: "화면", order: 0 }], requirements: [{ id: "req", categoryId: null, text: "기록 보기", origin: "user" as const }], issues: [{ id: "issue", categoryId: "cat", requirementIds: ["req"], version: "1.0.0", order: 0, title: "구현", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" as const }] };
    const html = renderToStaticMarkup(<DraftCategories document={document} disabled={false} onSave={async () => true} onPendingChange={() => {}} />);
    expect(html).toContain("상위 분류");
    expect(html).toContain("요구사항 분류: 기록 보기");
    expect(html).toContain("이슈 분류: 구현");
    expect(html).toContain("요구사항 연결: 구현");
    expect(html).toContain("이전 연결 검토가 무효화됩니다");
    const unlinked = setDraftRequirementLink(document, "issue", "req", false);
    expect(unlinked?.issues[0].requirementIds).toEqual([]);
    expect(document.issues[0].requirementIds).toEqual(["req"]);
    expect(setDraftRequirementLink(document, "issue", "missing", true)).toBeNull();
    expect(setDraftRequirementLink(document, "issue", "req", true)?.issues[0].requirementIds).toEqual(["req"]);
    expect(removeDraftCategory(document, "cat")).toBeNull();
    const unused = { ...document, categories: [...document.categories, { id: "unused", title: "미사용", parentId: null, order: 1 }] };
    expect(removeDraftCategory(unused, "unused")?.categories.map(item => item.id)).toEqual(["cat"]);
    expect(unused.categories).toHaveLength(2);
    expect(removeDraftCategory({ ...unused, categories: [...unused.categories, { id: "child", title: "하위", parentId: "unused", order: 2 }] }, "unused")).toBeNull();
    const tree = { ...unused, categories: [...unused.categories, { id: "child", title: "하위", parentId: "unused", order: 2 }] };
    expect(updateDraftCategory(tree, "unused", "이름", "child")).toBeNull();
    expect(updateDraftCategory(tree, "unused", "이름", "missing")).toBeNull();
    expect(updateDraftCategory(tree, "unused", "이름", "cat")?.categories[1]).toMatchObject({ title: "이름", parentId: "cat" });
    expect(tree.categories[1].title).toBe("미사용");
    const unlinkedDocument = { ...document, issues: [{ ...document.issues[0], requirementIds: [] }] };
    const updated = applyIndependentDraftEdit(unlinkedDocument, { kind: "issue", id: "issue", title: "새 제목", description: "설명", criteria: "", version: "1.0.1" });
    expect(updated?.issues[0]).toMatchObject({ title: "새 제목", requirementIds: [], acceptanceCriteria: [] });
    expect(unlinkedDocument.issues[0].title).toBe("구현");
    expect(applyIndependentDraftEdit(document, { kind: "requirement", id: "missing", text: "수정" })).toBeNull();
    expect(removeIndependentDraftItem(document, "requirement", "req")).toBeNull();
    expect(removeIndependentDraftItem(unlinkedDocument, "requirement", "req")?.requirements).toEqual([]);
    expect(removeIndependentDraftItem(document, "issue", "issue")?.issues).toEqual([]);
    expect(document.issues).toHaveLength(1);
    const added = applyIndependentDraftEdit(document, { kind: "requirement", id: "req-new", text: "추가", isNew: true });
    expect(added?.requirements[1]).toMatchObject({ id: "req-new", text: "추가", origin: "user" });
    expect(applyIndependentDraftEdit(document, { kind: "requirement", id: "req", text: "중복", isNew: true })).toBeNull();
    expect(applyIndependentDraftEdit(document, { kind: "issue", id: "new-issue", title: "독립", description: "", criteria: "", version: "1.0.0", isNew: true })?.issues[1]).toMatchObject({ id: "new-issue", requirementIds: [], order: 1 });
    expect(renderToStaticMarkup(<DraftIndependentEditor document={unlinkedDocument} disabled={false} onSave={async () => true} onPendingChange={() => {}} />)).toContain("이슈만 수정");
  });
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
    expect(html).toContain("초안 저장 버튼을 누를 때 로컬 저장소에 보관");
  });
  it("distinguishes stale decisions from superseded decisions in the same revision", () => {
    const review = { requirementId: "req", issueId: "issue", decision: "deferred" as const, reason: "추가 확인" };
    const draft = { projectRevision: 1, revision: 2, document: { format: "auto-codex-issues" as const, formatVersion: 1 as const, documentId: "doc", revision: 1, sources: [], categories: [], requirements: [], issues: [] }, reviews: [], history: [{ revision: 1, review }, { revision: 2, review }] };
    const html = renderToStaticMarkup(<DraftReviews draft={draft} loading={false} reasons={{}} setReasons={() => {}} onReview={() => {}} />);
    expect(html).toContain("초안 r1 · 오래된 검토");
    expect(html).toContain("초안 r2 · 이전 결정");
    expect(html).toContain("현재 검토 결과에 포함되지 않습니다");
  });
});
