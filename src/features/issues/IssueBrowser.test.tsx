import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { IssueCategoryNavigation, IssueDiagnostics, IssueRow, ProjectIssueSearch } from "./IssueBrowser";
import { AnalysisSources } from "./AnalysisSources";
import { IssueApi } from "./api";

it("renders untrusted issue text as escaped text with a readable status", () => {
  const html = renderToStaticMarkup(<IssueRow issue={{ id: "issue-1", title: "<script>alert(1)</script>", version: "1.2.0", category: "<img src=x>", localStatus: "needs_review", importedStatus: "completed", missingCriteria: true, unverifiedDependencies: 2 }} disabled={false} onOpen={() => {}} />);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("검토 필요");
  expect(html).toContain("완료 조건 없음"); expect(html).toContain("선행 이슈 2개 미확인");
});
it("escapes category labels and exposes paging and unclassified selection", () => {
  const html = renderToStaticMarkup(<IssueCategoryNavigation page={{ items: [{ id: "cat-1", title: "<script>unsafe</script>", hasChildren: true }], nextOffset: 32 }} path={[]} selected={null} history={[]} loading={false} onAll={() => {}} onUncategorized={() => {}} onParent={() => {}} onSelect={() => {}} onPrevious={() => {}} onNext={() => {}} />);
  expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("미분류"); expect(html).toContain("다음 분류"); expect(html).toContain("하위 분류 있음");
});
it("reports a partial project search without claiming no results remain", () => {
  const html = renderToStaticMarkup(<ProjectIssueSearch page={{ documentId: null, items: [], scannedDocuments: 8, nextCursor: { afterId: "doc-8", issueOffset: 0 } }} filters={{ search: "<script>" }} history={[]} loading={false} onSearch={() => {}} onPrevious={() => {}} onNext={() => {}} onOpen={() => {}} />);
  expect(html).toContain("아직 확인할 결과 또는 문서가 남아 있습니다."); expect(html).toContain("다음 검색 결과");
  expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
});

it("labels diagnostic scope and escapes untrusted titles", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 1, requirementCount: 2, linkedRequirementCount: 1, totalFindings: 1, findings: { items: [{ code: "issue-missing-criteria", entityId: "issue-1", title: "<script>unsafe</script>", provenance: null }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} />);
  expect(html).toContain("원문 누락, 의미적 완전성, 실제 코드 동작은 확인하지 않았습니다.");
  expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("완료 조건이 없는 이슈");
});

it("offers optional input preparation without claiming analysis was run", () => {
  const html = renderToStaticMarkup(<AnalysisSources api={new IssueApi()} revision={1} loading={false} setLoading={() => {}} onViewExpired={() => {}} />);
  expect(html).toContain("추가 요청 (선택)");
  expect(html).toContain("모델 호출이나 이슈 등록은 시작되지 않습니다");
  expect(html).toContain("disabled=\"\">분석 입력 준비");
});
