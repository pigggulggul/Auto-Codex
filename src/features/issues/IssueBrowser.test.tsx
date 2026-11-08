import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactNode } from "react";
import { expect, it } from "vitest";
import { IssueCandidateCheck, IssueCategoryNavigation, IssueDependencyList, IssueDetailBack, IssueDiagnostics, IssueRow, IssueSelectionPreview, ProjectIssueSearch, RequirementDetailPanel } from "./IssueBrowser";
import { AnalysisSources } from "./AnalysisSources";
import { IssueApi } from "./api";

it("offers the linked requirement for a category mismatch instead of treating it as an issue", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 1, requirementCount: 1, linkedRequirementCount: 1, totalFindings: 1, findings: { items: [{ code: "issue-requirement-category-mismatch", entityId: "issue-a", title: "이슈", relatedEntityId: "req-b", provenance: null }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} onOpenIssue={() => {}} onOpenRequirement={() => {}} />);
  expect(html).toContain("연결 요구사항 상세 보기"); expect(html).not.toContain("비교 이슈 상세 보기");
});

it("renders untrusted issue text as escaped text with a readable status", () => {
  const html = renderToStaticMarkup(<IssueRow issue={{ id: "issue-1", title: "<script>alert(1)</script>", version: "1.2.0", category: "<img src=x>", localStatus: "needs_review", importedStatus: "completed", missingCriteria: true, unverifiedDependencies: 2 }} disabled={false} onOpen={() => {}} />);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("검토 필요");
  expect(html).toContain("완료 조건 없음"); expect(html).toContain("선행 이슈 2개 미확인");
});
it("explains basic candidate checks without promising execution or completion", () => {
  const blocked = renderToStaticMarkup(<IssueCandidateCheck reasons={["state", "missing-criteria", "review", "dependency"]} />);
  expect(blocked).toContain("현재 상태가 기본 대상인 대기가 아닙니다."); expect(blocked).toContain("완료 조건이 없습니다."); expect(blocked).toContain("선행 이슈의 로컬 완료 근거가 확인되지 않았습니다.");
  expect(blocked).toContain("실행 허가나 완료 판정이 아닙니다.");
  const ready = renderToStaticMarkup(<IssueCandidateCheck reasons={[]} />);
  expect(ready).toContain("현재 확인한 기본 조건에 제외 사유가 없습니다."); expect(ready).toContain("준비 중입니다.");
});
it("exposes accessible selection controls and labels preview as non-execution", () => {
  const issue = { id: "issue-1", title: "<script>합성</script>", version: "1.0.0", category: null, localStatus: "ready" as const, importedStatus: "ready" as const, missingCriteria: false, unverifiedDependencies: 0 };
  const row = renderToStaticMarkup(<IssueRow issue={issue} disabled={false} selectionDisabled onSelect={() => {}} onOpen={() => {}} />);
  expect(row).toContain('disabled="" aria-label="issue-1 사전 점검에 선택"');
  const result = { ...issue, order: 0, description: "", criteriaCount: 1, requirementCount: 0, dependencyCount: 0, candidateReasons: [], unverifiedDependencyCount: 0, dependencyPreview: [] };
  const html = renderToStaticMarkup(<IssueSelectionPreview selected={[issue]} results={[result]} loading={false} onRemove={() => {}} onPreview={() => {}} onClear={() => {}} />);
  expect(html).toContain("선택 1개"); expect(html).toContain('aria-label="issue-1 선택 해제"');
  expect(html).toContain("실행 순서가 아닙니다"); expect(html).toContain("&lt;script&gt;합성&lt;/script&gt;"); expect(html).not.toContain("<script>");
  const sorted = renderToStaticMarkup(<IssueSelectionPreview selected={[issue]} results={[{ id: "later", title: "나중", version: "1.10.0", order: 0, localStatus: "ready", candidateReasons: [], unverifiedDependencyCount: 0, dependencyPreview: [] }, { id: "first", title: "먼저", version: "1.2.0", order: 1, localStatus: "ready", candidateReasons: ["dependency"], unverifiedDependencyCount: 1, dependencyPreview: [{ id: "dep-1", title: "선행" }] }]} loading={false} onRemove={() => {}} onPreview={() => {}} onClear={() => {}} />);
  expect(sorted.indexOf("먼저 · first")).toBeLessThan(sorted.indexOf("나중 · later")); expect(sorted).toContain("선행 이슈의 로컬 완료 근거가 확인되지 않았습니다."); expect(sorted).toContain("선택한 선행 이슈가 완료된다고 가정하지 않습니다.");
  const empty = renderToStaticMarkup(<IssueSelectionPreview selected={[]} results={null} loading={false} onRemove={() => {}} onPreview={() => {}} onClear={() => {}} />);
  expect(empty).toContain('disabled="">선택 항목 점검');
});
it("opens unverified dependencies and offers the selected issue when more are omitted", () => {
  const issue = { id: "issue-1", title: "후행", version: "1.0.0", order: 0, localStatus: "ready" as const, candidateReasons: ["dependency" as const], unverifiedDependencyCount: 4, dependencyPreview: [{ id: "dep-1", title: "<script>선행</script>" }, { id: "dep-2", title: "둘" }, { id: "dep-3", title: "셋" }] };
  const opened: { id: string; button: HTMLButtonElement }[] = [];
  const props = { selected: [], results: [issue], loading: false, onRemove: () => {}, onPreview: () => {}, onClear: () => {}, onOpenIssue: (id: string, button: HTMLButtonElement) => opened.push({ id, button }) };
  const html = renderToStaticMarkup(<IssueSelectionPreview {...props} />);
  expect(html).toContain("미확인 선행 이슈 4개 중 3개 표시"); expect(html).toContain("&lt;script&gt;선행&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain('aria-label="issue-1 이슈 상세에서 선행 이슈 더 보기"');
  const node = IssueSelectionPreview(props), buttons: { label: string; click: (event: { currentTarget: HTMLButtonElement }) => void }[] = [];
  const visit = (value: ReactNode): void => { Children.forEach(value, child => { if (!isValidElement<{ children?: ReactNode; "aria-label"?: string; onClick?: (event: { currentTarget: HTMLButtonElement }) => void }>(child)) return; if (child.type === "button" && child.props["aria-label"] && child.props.onClick) buttons.push({ label: child.props["aria-label"], click: child.props.onClick }); visit(child.props.children); }); };
  visit(node); const clicked = {} as HTMLButtonElement;
  buttons.find(button => button.label === "dep-1 선행 이슈 상세 보기")?.click({ currentTarget: clicked });
  buttons.find(button => button.label === "issue-1 이슈 상세에서 선행 이슈 더 보기")?.click({ currentTarget: clicked });
  expect(opened).toEqual([{ id: "dep-1", button: clicked }, { id: "issue-1", button: clicked }]);
  expect(renderToStaticMarkup(<IssueSelectionPreview {...props} loading />)).toContain('disabled="" aria-label="dep-1 선행 이슈 상세 보기"');
});
it("requires explicit selection for retry and failed states and displays the applied local state", () => {
  const changes: { includeRetryable: boolean; includeFailed: boolean }[] = [];
  const props = { selected: [], results: null, loading: false, onRemove: () => {}, onPreview: () => {}, onClear: () => {}, options: { includeRetryable: false, includeFailed: false }, onOptionsChange: (value: { includeRetryable: boolean; includeFailed: boolean }) => changes.push(value) };
  const node = IssueSelectionPreview(props), inputs: ((event: { target: { checked: boolean } }) => void)[] = [];
  const visit = (value: ReactNode): void => { Children.forEach(value, child => { if (!isValidElement<{ children?: ReactNode; onChange?: (event: { target: { checked: boolean } }) => void }>(child)) return; if (child.type === "input" && child.props.onChange) inputs.push(child.props.onChange); visit(child.props.children); }); };
  visit(node); expect(inputs).toHaveLength(2); inputs[0]({ target: { checked: true } }); inputs[1]({ target: { checked: true } });
  expect(changes).toEqual([{ includeRetryable: true, includeFailed: false }, { includeRetryable: false, includeFailed: true }]);
  const html = renderToStaticMarkup(<IssueSelectionPreview {...props} options={{ includeRetryable: true, includeFailed: true }} results={[{ id: "failed", title: "실패 이슈", version: "1.0.0", order: 0, localStatus: "failed", candidateReasons: [], unverifiedDependencyCount: 0, dependencyPreview: [] }]} />);
  expect(html).toContain("재시도 필요 포함"); expect(html).toContain("실패 포함"); expect(html).toContain("로컬 상태 ✕ 실패"); expect(html).toContain("선택 조건에 제외 사유가 없습니다"); expect(html).toContain("실행 허가나 완료 판정이 아닙니다");
});
it("opens a dependency without treating imported completion as verified", () => {
  const opened: { id: string; button: HTMLButtonElement }[] = [];
  const dependencies = [{ id: "dep-1", title: "<script>선행</script>", localStatus: "needs_review" as const, importedStatus: "completed" as const }];
  const html = renderToStaticMarkup(<IssueDependencyList dependencies={dependencies} loading={false} onOpen={() => {}} />);
  expect(html).toContain("&lt;script&gt;선행&lt;/script&gt;");
  expect(html).toContain("로컬에서 확인되지 않았습니다");
  expect(html).toContain('aria-label="dep-1 선행 이슈 상세 보기"');
  const node = IssueDependencyList({ dependencies, loading: false, onOpen: (id, button) => opened.push({ id, button }) });
  const item = Children.toArray(node.props.children)[0];
  if (!isValidElement<{ children: ReactNode }>(item)) throw new Error("missing dependency item");
  const button = Children.toArray(item.props.children).find(child => isValidElement(child) && child.type === "button");
  if (!isValidElement<{ onClick: (event: { currentTarget: HTMLButtonElement }) => void }>(button)) throw new Error("missing dependency button");
  const target = {} as HTMLButtonElement; button.props.onClick({ currentTarget: target });
  expect(opened).toEqual([{ id: "dep-1", button: target }]);
});
it("preserves the issue button as the return target and offers a correctly labelled back action", () => {
  const issue = { id: "issue-1", title: "이슈", version: "1.0.0", category: null, localStatus: "ready" as const, importedStatus: "ready" as const, missingCriteria: false, unverifiedDependencies: 0 };
  let target: HTMLButtonElement | undefined, returned = false;
  const row = IssueRow({ issue, disabled: false, onOpen: button => { target = button; } });
  const button = row.props.children;
  const clicked = {} as HTMLButtonElement;
  button.props.onClick({ currentTarget: clicked });
  expect(target).toBe(clicked);
  const back = IssueDetailBack({ kind: "list", loading: false, onBack: () => { returned = true; } });
  expect(renderToStaticMarkup(back)).toContain("이슈 목록으로 돌아가기");
  back.props.onClick({ currentTarget: clicked }); expect(returned).toBe(true);
  expect(renderToStaticMarkup(IssueDetailBack({ kind: "project", loading: true, onBack: () => {} }))).toContain('disabled="">전체 검색 결과로 돌아가기');
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

it("shows an unlinked source without inventing a requirement or issue action", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 0, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "source-unlinked", entityId: "source-1", title: "<자료>", provenance: null }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} onOpenIssue={() => {}} onOpenRequirement={() => {}} />);
  expect(html).toContain("요구사항에 연결되지 않은 자료"); expect(html).toContain("&lt;자료&gt;");
  expect(html).not.toContain("source-1 이슈 상세 보기"); expect(html).not.toContain("source-1 요구사항 상세 보기");
});
it("labels unreferenced document sources without implying their contents were analyzed", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 0, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "source-unlinked", entityId: "source-1", title: "<script>unsafe</script>", provenance: null }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} onOpenIssue={() => {}} onOpenRequirement={() => {}} onOpenCategory={() => {}} />);
  expect(html).toContain("요구사항에 연결되지 않은 자료");
  expect(html).toContain("원본 자료는 문서에 기록된 참조만 확인하며 파일을 읽지 않습니다.");
  expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).not.toContain('aria-label="source-1 이슈 상세 보기"'); expect(html).not.toContain('aria-label="source-1 분류 이슈 보기"');
});

it("offers accessible category navigation and preserves the filter explanation", () => {
  const report = { documentRevision: 1, issueCount: 0, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "category-empty" as const, entityId: "cat-empty", title: "<script>unsafe</script>", provenance: null }], nextOffset: null } };
  const common = { report, revision: 2, offset: 0, history: [], loading: false, onPrevious: () => {}, onNext: () => {} };
  const opened: string[] = [], node = IssueDiagnostics({ ...common, onOpenCategory: id => opened.push(id) });
  const visit = (value: ReactNode): void => { Children.forEach(value, child => { if (!isValidElement<{ children?: ReactNode; "aria-label"?: string; onClick?: () => void }>(child)) return; if (child.type === "button" && child.props["aria-label"] === "cat-empty 분류 이슈 보기") child.props.onClick?.(); visit(child.props.children); }); };
  visit(node); expect(opened).toEqual(["cat-empty"]);
  const html = renderToStaticMarkup(<IssueDiagnostics {...common} loading onOpenCategory={() => {}} />);
  expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain('disabled="" aria-label="cat-empty 분류 이슈 보기"'); expect(html).toContain("현재 검색·상태·버전 필터가 유지됩니다.");
  const nav = renderToStaticMarkup(<IssueCategoryNavigation page={{ items: [], nextOffset: null }} path={[]} selected="cat-empty" history={[]} loading={false} onAll={() => {}} onUncategorized={() => {}} onParent={() => {}} onSelect={() => {}} onPrevious={() => {}} onNext={() => {}} />);
  expect(nav).toContain("cat-empty (점검에서 선택)");
});

it("shows matching text as a review candidate with its comparison ID", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 2, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "issue-same-title", entityId: "issue-2", title: "같은 제목", provenance: null, relatedEntityId: "issue-1" }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} onOpenIssue={() => {}} />);
  expect(html).toContain("제목이 같은 이슈 · 중복 여부 확인");
  expect(html).toContain("비교 대상 ID: "); expect(html).toContain("issue-1");
  expect(html).toContain("실제 중복인지는 확인이 필요합니다");
  expect(html).toContain('aria-label="issue-2 이슈 상세 보기"'); expect(html).toContain('aria-label="issue-1 비교 이슈 상세 보기"');
});

it("shows an order collision with links to both issues and explains the tie break", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 2, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "issue-same-version-order", entityId: "issue-2", title: "이슈", provenance: null, relatedEntityId: "issue-1" }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} onOpenIssue={() => {}} />);
  expect(html).toContain("같은 버전과 순서를 가진 이슈 · 순서 확인");
  expect(html).toContain("같은 버전과 순서의 이슈는 ID 순으로 표시됩니다.");
  expect(html).toContain('aria-label="issue-2 이슈 상세 보기"'); expect(html).toContain('aria-label="issue-1 비교 이슈 상세 보기"');
});

it("shows a recorded AI proposal as needing review with a requirement detail action", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 1, requirementCount: 1, linkedRequirementCount: 1, totalFindings: 1, findings: { items: [{ code: "requirement-ai-proposal", entityId: "req-ai", title: "제안", provenance: { origin: "ai-proposal", sourceName: null, locator: null } }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} onOpenRequirement={() => {}} />);
  expect(html).toContain("AI 제안 요구사항 · 내용과 근거 확인");
  expect(html).toContain("AI 제안은 문서에 기록된 출처이며 내용과 근거를 확인해야 합니다.");
  expect(html).toContain('aria-label="req-ai 요구사항 상세 보기"');
});

it("disables issue navigation while loading and never treats requirement IDs as issues", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 1, requirementCount: 1, linkedRequirementCount: 0, totalFindings: 2, findings: { items: [{ code: "requirement-unlinked", entityId: "req-1", title: "요구사항", provenance: { origin: "user", sourceName: null, locator: null } }, { code: "issue-missing-criteria", entityId: "issue-1", title: "이슈", provenance: null }], nextOffset: null } }} revision={2} offset={0} history={[]} loading onPrevious={() => {}} onNext={() => {}} onOpenIssue={() => {}} />);
  expect(html).toContain('disabled="" aria-label="issue-1 이슈 상세 보기"');
  expect(html).not.toContain('aria-label="req-1 이슈 상세 보기"');
});

it("routes each diagnostic action to the corresponding issue ID", () => {
  const opened: { id: string; button: HTMLButtonElement }[] = [];
  const node = IssueDiagnostics({ report: { documentRevision: 1, issueCount: 2, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "issue-same-title", entityId: "issue-2", title: "이슈", provenance: null, relatedEntityId: "issue-1" }], nextOffset: null } }, revision: 2, offset: 0, history: [], loading: false, onPrevious: () => {}, onNext: () => {}, onOpenIssue: (id, button) => opened.push({ id, button }) });
  const buttons: { label: string; click: (event: { currentTarget: HTMLButtonElement }) => void }[] = [];
  const visit = (value: ReactNode): void => { Children.forEach(value, child => { if (!isValidElement<{ children?: ReactNode; "aria-label"?: string; onClick?: (event: { currentTarget: HTMLButtonElement }) => void }>(child)) return; if (child.type === "button" && child.props["aria-label"] && child.props.onClick) buttons.push({ label: child.props["aria-label"], click: child.props.onClick }); visit(child.props.children); }); };
  visit(node);
  const first = {} as HTMLButtonElement, second = {} as HTMLButtonElement;
  buttons.find(button => button.label === "issue-2 이슈 상세 보기")!.click({ currentTarget: first });
  buttons.find(button => button.label === "issue-1 비교 이슈 상세 보기")!.click({ currentTarget: second });
  expect(opened).toEqual([{ id: "issue-2", button: first }, { id: "issue-1", button: second }]);
});

it("offers requirement and comparison detail actions with distinct accessible IDs", () => {
  const html = renderToStaticMarkup(<IssueDiagnostics report={{ documentRevision: 1, issueCount: 0, requirementCount: 2, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "requirement-same-text", entityId: "req-2", title: "요구사항", provenance: { origin: "source", sourceName: "자료", locator: "1절" }, relatedEntityId: "req-1" }], nextOffset: null } }} revision={2} offset={0} history={[]} loading={false} onPrevious={() => {}} onNext={() => {}} onOpenRequirement={() => {}} />);
  expect(html).toContain('aria-label="req-2 요구사항 상세 보기"'); expect(html).toContain('aria-label="req-1 비교 요구사항 상세 보기"');
});

it("routes a linked requirement issue to the selected issue and preserves its return target", () => {
  const opened: { id: string; button: HTMLButtonElement }[] = [];
  const issue = { id: "issue-1", title: "이슈", version: "1.0.0", category: null, localStatus: "ready" as const, importedStatus: "ready" as const, missingCriteria: false, unverifiedDependencies: 0 };
  const node = RequirementDetailPanel({ requirement: { id: "req-1", text: "요구사항", category: null, origin: "user", sourceName: null, locator: null, linkedIssueCount: 1 }, page: { items: [issue], nextOffset: null }, offset: 0, history: [], loading: false, onBack: () => {}, onOpenIssue: (value, button) => opened.push({ id: value.id, button }), onPrevious: () => {}, onNext: () => {} });
  const buttons: ((event: { currentTarget: HTMLButtonElement }) => void)[] = [];
  const visit = (value: ReactNode): void => { Children.forEach(value, child => { if (!isValidElement<{ children?: ReactNode; onClick?: (event: { currentTarget: HTMLButtonElement }) => void }>(child)) return; if (child.type === "button" && child.props.onClick) buttons.push(child.props.onClick); visit(child.props.children); }); };
  visit(node);
  const target = {} as HTMLButtonElement; buttons[0]({ currentTarget: target });
  expect(opened).toEqual([{ id: "issue-1", button: target }]);
});

it("shows the requirement origin, bounded issue page and honest imported status", () => {
  const issue = { id: "issue-1", title: "<script>unsafe</script>", version: "1.0.0", category: null, localStatus: "needs_review" as const, importedStatus: "completed" as const, missingCriteria: false, unverifiedDependencies: 0 };
  const html = renderToStaticMarkup(<RequirementDetailPanel requirement={{ id: "req-1", text: "<img src=x>", category: null, origin: "source", sourceName: "계획서", locator: "2절", linkedIssueCount: 33 }} page={{ items: [issue], nextOffset: 1 }} offset={0} history={[]} loading={false} onBack={() => {}} onOpenIssue={() => {}} onPrevious={() => {}} onNext={() => {}} />);
  expect(html).toContain("&lt;img src=x&gt;"); expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
  expect(html).toContain("계획서"); expect(html).toContain("2절"); expect(html).toContain("다음 연결 이슈");
  expect(html).toContain("로컬 검증 결과가 아닙니다"); expect(html).not.toContain("<script>");
});

it("offers optional input preparation without claiming analysis was run", () => {
  const html = renderToStaticMarkup(<AnalysisSources api={new IssueApi()} revision={1} loading={false} setLoading={() => {}} onViewExpired={() => {}} />);
  expect(html).toContain("추가 요청 (선택)");
  expect(html).toContain("모델 호출이나 이슈 등록은 시작되지 않습니다");
  expect(html).toContain("disabled=\"\">분석 입력 준비");
});
