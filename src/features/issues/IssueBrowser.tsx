import { useEffect, useRef, useState } from "react";
<<<<<<< HEAD
import type { IssueCategoryView, IssueDependencyView, IssueDetail, IssueDiagnosticReport, IssueDocumentSummary, IssueFindingCode, IssueFilters, IssueRequirementView, IssueSummary, IssueViewQuery, IssueViewResult, IssueViewStatus, Page, ProjectIssueCursor, ProjectIssueFilters, ProjectIssuePage, RequirementDetail, SourceTrace } from "../../../shared/issues/view";
import { IssueApiError, type IssueApi } from "./api";
import { AnalysisSources } from "./AnalysisSources";
import { validDetailPage } from "./detail-page";

const STATUS: Record<IssueSummary["localStatus"], string> = { ready: "□ 대기", retryable: "△ 재시도 필요", failed: "✕ 실패", needs_review: "? 검토 필요" };
const ORIGIN: Record<IssueRequirementView["origin"], string> = { source: "원본 자료", user: "사용자 입력", "ai-proposal": "AI 제안" };
const FINDING: Record<IssueFindingCode, string> = { "source-unlinked": "요구사항에 연결되지 않은 자료", "requirement-unlinked": "이슈에 연결되지 않은 요구사항", "requirement-uncategorized": "분류가 없는 요구사항", "requirement-same-text": "내용이 같은 요구사항 · 중복 여부 확인", "requirement-ai-proposal": "AI 제안 요구사항 · 내용과 근거 확인", "issue-unlinked": "요구사항에 연결되지 않은 이슈", "issue-uncategorized": "분류가 없는 이슈", "issue-missing-description": "설명이 없는 이슈", "issue-missing-criteria": "완료 조건이 없는 이슈", "issue-unverified-completion": "문서의 완료 표시를 로컬에서 확인하지 않은 이슈", "issue-same-title": "제목이 같은 이슈 · 중복 여부 확인", "issue-same-version-order": "같은 버전과 순서를 가진 이슈 · 순서 확인", "issue-requirement-category-mismatch": "연결된 요구사항과 이슈가 서로 다른 분류에 있음 · 확인 필요" };
=======
import { MAX_PREVIEW_SELECTION, type IssueCandidateOptions, type IssueCandidatePreview, type IssueCandidateReason, type IssueCategoryView, type IssueDependencyView, type IssueDetail, type IssueDiagnosticReport, type IssueDocumentSummary, type IssueFindingCode, type IssueFilters, type IssueRequirementView, type IssueSummary, type IssueViewQuery, type IssueViewResult, type IssueViewStatus, type Page, type ProjectIssueCursor, type ProjectIssueFilters, type ProjectIssuePage, type RequirementDetail } from "../../../shared/issues/view";
import { IssueApiError, type IssueApi } from "./api";
import { AnalysisSources } from "./AnalysisSources";
import { orderCandidatePreviews, previewCandidateSelection } from "./candidate-preview";

const STATUS: Record<IssueSummary["localStatus"], string> = { ready: "□ 대기", retryable: "△ 재시도 필요", failed: "✕ 실패", needs_review: "? 검토 필요" };
const ORIGIN: Record<IssueRequirementView["origin"], string> = { source: "원본 자료", user: "사용자 입력", "ai-proposal": "AI 제안" };
const FINDING: Record<IssueFindingCode, string> = { "requirement-unlinked": "이슈에 연결되지 않은 요구사항", "requirement-uncategorized": "분류가 없는 요구사항", "requirement-same-text": "내용이 같은 요구사항 · 중복 여부 확인", "requirement-ai-proposal": "AI 제안 요구사항 · 내용과 근거 확인", "issue-unlinked": "요구사항에 연결되지 않은 이슈", "issue-uncategorized": "분류가 없는 이슈", "issue-missing-description": "설명이 없는 이슈", "issue-missing-criteria": "완료 조건이 없는 이슈", "issue-unverified-completion": "문서의 완료 표시를 로컬에서 확인하지 않은 이슈", "issue-same-title": "제목이 같은 이슈 · 중복 여부 확인", "issue-same-version-order": "같은 버전과 순서를 가진 이슈 · 순서 확인", "category-empty": "요구사항과 이슈가 없는 말단 분류", "category-no-requirements": "요구사항이 지정되지 않은 말단 분류", "category-no-issues": "이슈가 지정되지 않은 말단 분류", "source-unreferenced": "요구사항에서 참조하지 않은 문서상 원본 자료" };
>>>>>>> 3819e49eb81bc37c76378b17f332ab2b116bc8d0
type Props = { api: IssueApi; active: boolean; importRevision: number };
type CategoryCrumb = IssueCategoryView & { parentOffset: number; parentHistory: number[] };

export function IssueListControls({ loading, onRefresh, onClose }: { loading: boolean; onRefresh: () => void; onClose: () => void }) {
  return <div className="issues-list-controls"><button type="button" disabled={loading} onClick={onRefresh}>목록 새로고침</button><button type="button" disabled={loading} onClick={onClose}>목록 닫기</button></div>;
}

export function IssueCategoryNavigation({ page, path, selected, history, loading, onAll, onUncategorized, onParent, onSelect, onPrevious, onNext, headingRef }: { page: Page<IssueCategoryView>; path: CategoryCrumb[]; selected: string | null | undefined; history: number[]; loading: boolean; onAll: () => void; onUncategorized: () => void; onParent: () => void; onSelect: (item: IssueCategoryView) => void; onPrevious: () => void; onNext: () => void; headingRef?: React.Ref<HTMLHeadingElement> }) {
  const current = selected === null ? "미분류" : path.length ? path.map(item => `${item.title} (${item.id})`).join(" / ") : selected === undefined ? "전체" : `${selected} (점검에서 선택)`;
  return <nav className="issues-categories" aria-label="문서 분류 탐색"><h3 tabIndex={-1} ref={headingRef}>분류 탐색</h3><p className="issues-view-note">현재: {current}</p><p className="issues-view-note">선택한 분류의 모든 하위 분류도 포함합니다.</p><div className="issues-category-actions"><button type="button" disabled={loading} aria-pressed={selected === undefined} onClick={onAll}>전체 이슈</button><button type="button" disabled={loading} aria-pressed={selected === null} onClick={onUncategorized}>미분류</button>{path.length > 0 && <button type="button" disabled={loading} onClick={onParent}>상위 분류</button>}</div>{page.items.length ? <ul className="issues-category-list">{page.items.map(item => <li key={item.id}><button type="button" disabled={loading} onClick={() => onSelect(item)}><strong>{item.title}</strong><small>{item.id}{item.hasChildren ? " · 하위 분류 있음" : ""}</small></button></li>)}</ul> : <p className="issues-view-note">표시할 하위 분류가 없습니다.</p>}<div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={onPrevious}>이전 분류</button>}{page.nextOffset !== null && <button type="button" disabled={loading} onClick={onNext}>다음 분류</button>}</div></nav>;
}

export function IssueRow({ issue, disabled, onOpen, selected, selectionDisabled, onSelect }: { issue: IssueSummary; disabled: boolean; onOpen: (button: HTMLButtonElement) => void; selected?: boolean; selectionDisabled?: boolean; onSelect?: (checked: boolean) => void }) {
  const open = <button type="button" onClick={event => onOpen(event.currentTarget)} disabled={disabled}><span><strong>{issue.title}</strong><small>{issue.category || "미분류"} · v{issue.version}</small>{issue.missingCriteria && <small className="issues-block-reason">완료 조건 없음</small>}{issue.unverifiedDependencies > 0 && <small className="issues-block-reason">선행 이슈 {issue.unverifiedDependencies}개 미확인</small>}</span><span className="issues-status">{STATUS[issue.localStatus]}</span></button>;
  return onSelect ? <li><label className="issues-selection-checkbox"><input type="checkbox" checked={!!selected} disabled={disabled || selectionDisabled} onChange={event => onSelect(event.target.checked)} aria-label={`${issue.id} 사전 점검에 선택`} /> 점검 선택</label>{open}</li> : <li>{open}</li>;
}
export function IssueCandidateCheck({ reasons, selectedOptions = false }: { reasons: IssueCandidateReason[]; selectedOptions?: boolean }) {
  const labels: Record<IssueCandidateReason, string> = { state: selectedOptions ? "현재 상태가 선택한 점검 대상에 포함되지 않습니다." : "현재 상태가 기본 대상인 대기가 아닙니다.", "missing-criteria": "완료 조건이 없습니다.", review: "로컬 상태가 검토 필요입니다.", dependency: "선행 이슈의 로컬 완료 근거가 확인되지 않았습니다." };
  const heading = selectedOptions ? "선택 조건 사전 점검" : "기본 실행 후보 사전 점검";
  return <section className="issues-prerequisites" aria-label={heading}><strong>{heading}</strong>{reasons.length ? <ul>{reasons.map(reason => <li key={reason}>{labels[reason]}</li>)}</ul> : <p>{selectedOptions ? "현재 확인한 선택 조건에 제외 사유가 없습니다." : "현재 확인한 기본 조건에 제외 사유가 없습니다."}</p>}<p>선택 문서의 저장된 상태와 완료 조건·선행 관계만 확인했습니다. 이 결과는 실행 허가나 완료 판정이 아닙니다. 이슈 실행과 로컬 완료 판정 기능은 준비 중입니다.</p></section>;
}
export function IssueSelectionPreview({ selected, results, loading, onRemove, onPreview, onClear, onOpenIssue, options = { includeRetryable: false, includeFailed: false }, onOptionsChange }: { selected: IssueSummary[]; results: IssueCandidatePreview[] | null; loading: boolean; onRemove: (id: string) => void; onPreview: () => void; onClear: () => void; onOpenIssue?: (id: string, button: HTMLButtonElement) => void; options?: IssueCandidateOptions; onOptionsChange?: (options: IssueCandidateOptions) => void }) {
  return <section className="issues-prerequisites" aria-label="선택 이슈 사전 점검"><h4>선택 이슈 사전 점검</h4><p>최대 {MAX_PREVIEW_SELECTION}개 · 선택 {selected.length}개. 페이지와 검색 조건을 바꿔도 이 문서의 선택은 유지됩니다.</p>{selected.length > 0 && <ul>{selected.map(item => <li key={item.id}>{item.title} · {item.id} <button type="button" disabled={loading} aria-label={`${item.id} 선택 해제`} onClick={() => onRemove(item.id)}>선택 해제</button></li>)}</ul>}<fieldset><legend>점검 대상 상태</legend><p>대기는 항상 포함됩니다. 아래 선택은 점검에만 적용됩니다.</p><label className="issues-selection-checkbox"><input type="checkbox" checked={options.includeRetryable} disabled={loading || !onOptionsChange} onChange={event => onOptionsChange?.({ ...options, includeRetryable: event.target.checked })} /> 재시도 필요 포함</label> <label className="issues-selection-checkbox"><input type="checkbox" checked={options.includeFailed} disabled={loading || !onOptionsChange} onChange={event => onOptionsChange?.({ ...options, includeFailed: event.target.checked })} /> 실패 포함</label></fieldset><button type="button" disabled={loading || selected.length === 0} onClick={onPreview}>선택 항목 점검</button> <button type="button" disabled={loading || selected.length === 0} onClick={onClear}>선택 모두 해제</button><p>결과는 버전·지정 순서·ID 순으로 표시하는 참고용이며 실제 실행 순서가 아닙니다. 선택한 선행 이슈가 완료된다고 가정하지 않습니다. 저장 상태의 선택 조건만 확인하며 실제 실행이나 완료 판정은 하지 않습니다.</p>{results && <div aria-live="polite"><h4>점검 결과</h4><ol>{orderCandidatePreviews(results).map(item => <li key={item.id}><strong>{item.title} · {item.id}</strong><p>버전 {item.version} · 지정 순서 {item.order} · 로컬 상태 {STATUS[item.localStatus]}</p><IssueCandidateCheck reasons={item.candidateReasons} selectedOptions />{item.unverifiedDependencyCount > 0 && <div><p>미확인 선행 이슈 {item.unverifiedDependencyCount}개 중 {item.dependencyPreview.length}개 표시</p><ul>{item.dependencyPreview.map(dependency => <li key={dependency.id}>{onOpenIssue ? <button type="button" disabled={loading} aria-label={`${dependency.id} 선행 이슈 상세 보기`} onClick={event => onOpenIssue(dependency.id, event.currentTarget)}>{dependency.title} · {dependency.id}</button> : <span>{dependency.title} · {dependency.id}</span>}</li>)}</ul>{item.unverifiedDependencyCount > item.dependencyPreview.length && <p>나머지는 이슈 상세에서 확인하세요. {onOpenIssue && <button type="button" disabled={loading} aria-label={`${item.id} 이슈 상세에서 선행 이슈 더 보기`} onClick={event => onOpenIssue(item.id, event.currentTarget)}>이슈 상세 보기</button>}</p>}</div>}</li>)}</ol></div>}</section>;
}
export function IssueDetailBack({ kind, loading, onBack }: { kind: "diagnostics" | "requirement" | "list" | "project" | "dependency"; loading: boolean; onBack: (button: HTMLButtonElement) => void }) {
  const label = kind === "dependency" ? "이전 이슈 상세로 돌아가기" : kind === "requirement" ? "요구사항 상세로 돌아가기" : kind === "diagnostics" ? "점검 결과로 돌아가기" : kind === "project" ? "전체 검색 결과로 돌아가기" : "이슈 목록으로 돌아가기";
  return <button type="button" disabled={loading} onClick={event => onBack(event.currentTarget)}>{label}</button>;
}
export function IssueDependencyList({ dependencies, loading, onOpen }: { dependencies: IssueDependencyView[]; loading: boolean; onOpen: (id: string, button: HTMLButtonElement) => void }) {
  return <ul>{dependencies.map(dependency => <li key={dependency.id}><button type="button" disabled={loading} onClick={event => onOpen(dependency.id, event.currentTarget)} aria-label={`${dependency.id} 선행 이슈 상세 보기`}>{dependency.title} · {dependency.id}</button> · {STATUS[dependency.localStatus]}{dependency.importedStatus === "completed" && <small> 문서의 완료 표시는 로컬에서 확인되지 않았습니다.</small>}</li>)}</ul>;
}
export function ProjectIssueSearch({ page, filters, history, loading, onSearch, onPrevious, onNext, onOpen, headingRef }: { page: ProjectIssuePage | null; filters: ProjectIssueFilters; history: ProjectIssueCursor[]; loading: boolean; onSearch: (filters: ProjectIssueFilters) => void; onPrevious: () => void; onNext: () => void; onOpen: (documentId: string, issue: IssueSummary, button: HTMLButtonElement) => void; headingRef?: React.Ref<HTMLHeadingElement> }) {
  const [text, setText] = useState(""), [status, setStatus] = useState<IssueViewStatus | "">(""), [version, setVersion] = useState("");
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); onSearch({ ...(text.trim() ? { search: text.trim() } : {}), ...(status ? { status } : {}), ...(version.trim() ? { version: version.trim() } : {}) }); };
  const applied = [filters.search ? `검색: ${filters.search}` : "검색어 전체", filters.status ? `상태: ${STATUS[filters.status]}` : "상태 전체", filters.version ? `버전: ${filters.version}` : "버전 전체"].join(" · ");
  return <section className="issues-project-search" aria-labelledby="project-issue-search-heading"><h3 id="project-issue-search-heading" tabIndex={-1} ref={headingRef}>프로젝트 전체 이슈 검색</h3><p className="issues-view-note">등록된 이슈 문서를 ID 순으로 한 번에 최대 8개 확인합니다. 추가 범위는 다음 결과를 눌러 계속 검색하세요.</p><form className="issues-filters" onSubmit={submit}><label>전체 문서 검색 <input type="search" value={text} onChange={event => setText(event.target.value)} maxLength={120} placeholder="제목, 설명, 분류, ID" /></label><label>전체 문서 상태 <select value={status} onChange={event => setStatus(event.target.value as IssueViewStatus | "")}><option value="">전체</option><option value="ready">대기</option><option value="retryable">재시도 필요</option><option value="failed">실패</option><option value="needs_review">검토 필요</option></select></label><label>전체 문서 개발 버전 <input value={version} onChange={event => setVersion(event.target.value)} maxLength={1024} pattern="[0-9]+\.[0-9]+\.[0-9]+" title="예: 1.2.0" placeholder="예: 1.2.0" /></label><button type="submit" disabled={loading}>전체 문서 검색</button></form>{page && <div><p className="issues-view-note">적용 조건: {applied}</p><p>이번 요청에서 확인한 문서 {page.scannedDocuments}개{page.documentId ? ` · 결과 문서: ${page.documentId}` : ""}</p>{page.items.length && page.documentId ? <ul className="issues-list">{page.items.map(issue => <IssueRow key={issue.id} issue={issue} disabled={loading} onOpen={button => onOpen(page.documentId!, issue, button)} />)}</ul> : <p>이번 검색 범위에는 일치하는 이슈가 없습니다.</p>}<p className="issues-view-note">{page.nextCursor ? "아직 확인할 결과 또는 문서가 남아 있습니다." : "더 확인할 결과나 문서가 없습니다."}</p><div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={onPrevious}>이전 검색 결과</button>}{page.nextCursor && <button type="button" disabled={loading} onClick={onNext}>다음 검색 결과</button>}</div></div>}</section>;
}
export function IssueDiagnostics({ report, revision, offset, history, loading, onPrevious, onNext, onOpenIssue, onOpenRequirement, onOpenCategory, headingRef, documentId }: { report: IssueDiagnosticReport; revision: number; offset: number; history: number[]; loading: boolean; onPrevious: () => void; onNext: () => void; onOpenIssue?: (issueId: string, returnFocus: HTMLButtonElement) => void; onOpenRequirement?: (requirementId: string, returnFocus: HTMLButtonElement) => void; onOpenCategory?: (categoryId: string) => void; headingRef?: React.Ref<HTMLHeadingElement>; documentId?: string }) {
  return <section className="issues-diagnostics" aria-label="문서 연결 점검 결과">
    <h3 tabIndex={-1} ref={headingRef}>문서 연결 점검 결과</h3>
    <p>{documentId ? `문서 ${documentId} · ` : ""}문서 r{report.documentRevision} · 프로젝트 r{revision}</p>
    <p>요구사항 {report.requirementCount}개 중 이슈에 연결된 항목 {report.linkedRequirementCount}개 · 이슈 {report.issueCount}개</p>
    <p>확인할 항목 {report.totalFindings}개{report.totalFindings > 0 ? ` · ${offset + 1}–${offset + report.findings.items.length} 표시` : ""}</p>
<<<<<<< HEAD
    <p className="issues-view-note">문서에 기록된 연결, 빈 항목, AI 제안 출처, 같은 문구와 같은 버전의 순서 중복을 점검했습니다. AI 제안은 문서에 기록된 출처이며 내용과 근거를 확인해야 합니다. 같은 문구가 실제 중복인지는 확인이 필요합니다. 같은 버전과 순서의 이슈는 ID 순으로 표시됩니다. 원문 누락, 의미적 완전성, 실제 코드 동작은 확인하지 않았습니다. 결과는 저장되지 않습니다.</p>
    {report.findings.items.length ? <ul>{report.findings.items.map(item => <li key={`${item.code}:${item.entityId}:${item.relatedEntityId ?? ""}`}>
=======
    <p className="issues-view-note">문서에 기록된 연결, 빈 항목, AI 제안 출처, 같은 문구와 같은 버전의 순서 중복을 점검했습니다. 원본 자료는 문서에 기록된 참조만 확인하며 파일을 읽지 않습니다. 참조가 있어도 내용의 분석이나 완전성을 보장하지 않습니다. 말단 분류는 직접 지정된 요구사항과 이슈를 확인합니다. 분류 이슈 보기에는 현재 검색·상태·버전 필터가 유지됩니다. AI 제안은 문서에 기록된 출처이며 내용과 근거를 확인해야 합니다. 같은 문구가 실제 중복인지는 확인이 필요합니다. 같은 버전과 순서의 이슈는 ID 순으로 표시됩니다. 원문 누락, 의미적 완전성, 실제 코드 동작은 확인하지 않았습니다. 결과는 저장되지 않습니다.</p>
    {report.findings.items.length ? <ul>{report.findings.items.map(item => <li key={`${item.code}:${item.entityId}`}>
>>>>>>> 3819e49eb81bc37c76378b17f332ab2b116bc8d0
      <strong>{FINDING[item.code]}</strong><br /><span>{item.title ? `${item.title} · ` : ""}{item.entityId}</span>
      {item.relatedEntityId && <small className="issues-finding-origin">{item.code === "issue-requirement-category-mismatch" ? "연결 요구사항 ID" : "비교 대상 ID"}: {item.relatedEntityId}</small>}
      {item.provenance && <small className="issues-finding-origin">{ORIGIN[item.provenance.origin]}{item.provenance.sourceName ? ` · ${item.provenance.sourceName}` : ""}{item.provenance.locator ? ` · ${item.provenance.locator}` : ""}</small>}
      {onOpenIssue && item.code.startsWith("issue-") && <div className="issues-finding-actions">
        <button type="button" disabled={loading} aria-label={`${item.entityId} 이슈 상세 보기`} onClick={event => onOpenIssue(item.entityId, event.currentTarget)}>이슈 상세 보기</button>
        {item.relatedEntityId && item.code !== "issue-requirement-category-mismatch" && <button type="button" disabled={loading} aria-label={`${item.relatedEntityId} 비교 이슈 상세 보기`} onClick={event => onOpenIssue(item.relatedEntityId!, event.currentTarget)}>비교 이슈 상세 보기</button>}
        {item.relatedEntityId && item.code === "issue-requirement-category-mismatch" && onOpenRequirement && <button type="button" disabled={loading} aria-label={`${item.relatedEntityId} 연결 요구사항 상세 보기`} onClick={event => onOpenRequirement(item.relatedEntityId!, event.currentTarget)}>연결 요구사항 상세 보기</button>}
      </div>}
      {onOpenRequirement && item.code.startsWith("requirement-") && <div className="issues-finding-actions">
        <button type="button" disabled={loading} aria-label={`${item.entityId} 요구사항 상세 보기`} onClick={event => onOpenRequirement(item.entityId, event.currentTarget)}>요구사항 상세 보기</button>
        {item.relatedEntityId && <button type="button" disabled={loading} aria-label={`${item.relatedEntityId} 비교 요구사항 상세 보기`} onClick={event => onOpenRequirement(item.relatedEntityId!, event.currentTarget)}>비교 요구사항 상세 보기</button>}
      </div>}
      {onOpenCategory && item.code.startsWith("category-") && <div className="issues-finding-actions"><button type="button" disabled={loading} aria-label={`${item.entityId} 분류 이슈 보기`} onClick={() => onOpenCategory(item.entityId)}>분류 이슈 보기</button></div>}
    </li>)}</ul> : <p>이 점검 범위에서 표시할 항목이 없습니다.</p>}
    <div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={onPrevious}>이전 점검 항목</button>}{report.findings.nextOffset !== null && <button type="button" disabled={loading} onClick={onNext}>다음 점검 항목</button>}</div>
  </section>;
}

export function RequirementDetailPanel({ requirement, page, offset, history, loading, headingRef, onBack, onOpenIssue, onPrevious, onNext }: { requirement: RequirementDetail; page: Page<IssueSummary>; offset: number; history: number[]; loading: boolean; headingRef?: React.Ref<HTMLHeadingElement>; onBack: () => void; onOpenIssue: (issue: IssueSummary, returnFocus: HTMLButtonElement) => void; onPrevious: () => void; onNext: () => void }) {
  return <article className="issues-detail" aria-label="요구사항 상세">
    <h3 tabIndex={-1} ref={headingRef}>요구사항 상세</h3>
    <p>요구사항 ID: {requirement.id} · {requirement.category || "미분류"}</p>
    <p className="issues-prewrap">{requirement.text}</p>
    <p>{ORIGIN[requirement.origin]}{requirement.sourceName ? ` · ${requirement.sourceName}` : ""}{requirement.locator ? ` · ${requirement.locator}` : ""}</p>
    <h4>연결된 이슈 {requirement.linkedIssueCount}개</h4>
    {page.items.length ? <ul className="issues-list">{page.items.map(issue => <li key={issue.id}><button type="button" disabled={loading} onClick={event => onOpenIssue(issue, event.currentTarget)}><span><strong>{issue.title}</strong><small>{issue.id} · v{issue.version}</small></span><span className="issues-status">{STATUS[issue.localStatus]}</span></button></li>)}</ul> : <p>연결된 이슈가 없습니다.</p>}
    <p className="issues-view-note">{requirement.linkedIssueCount ? `${offset + 1}–${offset + page.items.length} 표시 · ` : ""}가져온 완료 표시는 로컬 검증 결과가 아닙니다.</p>
    <div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={onPrevious}>이전 연결 이슈</button>}{page.nextOffset !== null && <button type="button" disabled={loading} onClick={onNext}>다음 연결 이슈</button>}<button type="button" disabled={loading} onClick={onBack}>점검 결과로 돌아가기</button></div>
  </article>;
}

export function IssueBrowser({ api, active, importRevision }: Props) {
  const [authorized, setAuthorized] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [documents, setDocuments] = useState<IssueDocumentSummary[]>([]), [revision, setRevision] = useState<number | null>(null);
  const [docNext, setDocNext] = useState<string | null>(null), [docAfter, setDocAfter] = useState(""), [docHistory, setDocHistory] = useState<string[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null), [issues, setIssues] = useState<IssueSummary[]>([]), [issueNext, setIssueNext] = useState<number | null>(null), [issueOffset, setIssueOffset] = useState(0), [issueHistory, setIssueHistory] = useState<number[]>([]);
  const [selection, setSelection] = useState<{ documentId: string; revision: number; items: IssueSummary[] } | null>(null);
  const [selectionResults, setSelectionResults] = useState<IssueCandidatePreview[] | null>(null);
  const [candidateOptions, setCandidateOptions] = useState<IssueCandidateOptions>({ includeRetryable: false, includeFailed: false });
  const selectedIssues = selection?.documentId === documentId && selection.revision === revision ? selection.items : [];
  const [detail, setDetail] = useState<IssueDetail | null>(null), [criteria, setCriteria] = useState<string[]>([]), [criteriaNext, setCriteriaNext] = useState<number | null>(null), [requirements, setRequirements] = useState<IssueRequirementView[]>([]), [requirementsNext, setRequirementsNext] = useState<number | null>(null);
  const [detailDocumentId, setDetailDocumentId] = useState<string | null>(null);
  const [detailReturnKind, setDetailReturnKind] = useState<"diagnostics" | "requirement" | "list" | "project" | null>(null);
  const [detailTrail, setDetailTrail] = useState<{ id: string; documentId: string }[]>([]);
  const [requirementDetail, setRequirementDetail] = useState<RequirementDetail | null>(null), [requirementPage, setRequirementPage] = useState<Page<IssueSummary> | null>(null), [requirementOffset, setRequirementOffset] = useState(0), [requirementHistory, setRequirementHistory] = useState<number[]>([]);
  const [dependencies, setDependencies] = useState<IssueDependencyView[]>([]), [dependenciesNext, setDependenciesNext] = useState<number | null>(null);
  const [search, setSearch] = useState(""), [status, setStatus] = useState<IssueViewStatus | "">(""), [version, setVersion] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<IssueFilters>({});
  const [exportNotice, setExportNotice] = useState("");
  const [categoryPage, setCategoryPage] = useState<Page<IssueCategoryView> | null>(null), [categoryPath, setCategoryPath] = useState<CategoryCrumb[]>([]), [categoryOffset, setCategoryOffset] = useState(0), [categoryHistory, setCategoryHistory] = useState<number[]>([]);
  const [diagnostics, setDiagnostics] = useState<IssueDiagnosticReport | null>(null), [diagnosticOffset, setDiagnosticOffset] = useState(0), [diagnosticHistory, setDiagnosticHistory] = useState<number[]>([]);
  const [sourceTrace, setSourceTrace] = useState<{ documentId: string; revision: number; page: Page<SourceTrace>; offset: number; history: number[] } | null>(null);
  const [projectPage, setProjectPage] = useState<ProjectIssuePage | null>(null), [projectCursor, setProjectCursor] = useState<ProjectIssueCursor>({ issueOffset: 0 }), [projectHistory, setProjectHistory] = useState<ProjectIssueCursor[]>([]), [projectFilters, setProjectFilters] = useState<ProjectIssueFilters>({});
  const alive = useRef(true), sequence = useRef(0), detailHeading = useRef<HTMLHeadingElement>(null), diagnosticHeading = useRef<HTMLHeadingElement>(null), categoryHeading = useRef<HTMLHeadingElement>(null), projectHeading = useRef<HTMLHeadingElement>(null);
  const loadedImportRevision = useRef<number | null>(null);
  const diagnosticReturn = useRef<HTMLButtonElement | null>(null), requirementReturn = useRef<HTMLButtonElement | null>(null), requirementHeading = useRef<HTMLHeadingElement>(null), issueListHeading = useRef<HTMLHeadingElement>(null), detailFallback = useRef<HTMLElement | null>(null);
  const dependencyReturn = useRef<HTMLButtonElement | null>(null);
  const expiry = useRef<{ timer: ReturnType<typeof setTimeout>; wall: number; monotonic: number } | null>(null);
  const forgetView = (message: string) => {
<<<<<<< HEAD
    setSourceTrace(null);
=======
    setSelection(null); setSelectionResults(null);
>>>>>>> 3819e49eb81bc37c76378b17f332ab2b116bc8d0
    sequence.current++; loadedImportRevision.current = null; if (expiry.current) clearTimeout(expiry.current.timer); expiry.current = null; diagnosticReturn.current = null; requirementReturn.current = null; dependencyReturn.current = null; detailFallback.current = null; setDetailReturnKind(null); setDetailTrail([]); setRequirementDetail(null); setRequirementPage(null); setRequirementOffset(0); setRequirementHistory([]);
    setAuthorized(false); setDocuments([]); setRevision(null); setDocNext(null); setDocAfter(""); setDocHistory([]); setDocumentId(null); setIssues([]); setIssueNext(null); setIssueOffset(0); setIssueHistory([]); setDetail(null); setDetailDocumentId(null); setCriteria([]); setCriteriaNext(null); setRequirements([]); setRequirementsNext(null); setDependencies([]); setDependenciesNext(null); setSearch(""); setStatus(""); setVersion(""); setAppliedFilters({}); setExportNotice(""); setDiagnostics(null); setDiagnosticOffset(0); setDiagnosticHistory([]); setCategoryPage(null); setCategoryPath([]); setCategoryOffset(0); setCategoryHistory([]); setProjectPage(null); setProjectCursor({ issueOffset: 0 }); setProjectHistory([]); setProjectFilters({}); setLoading(false); setError(message);
  };
  useEffect(() => { setSelection(null); setSelectionResults(null); setCandidateOptions({ includeRetryable: false, includeFailed: false }); }, [documentId, revision, authorized]);
  useEffect(() => {
    alive.current = true;
    const checkExpiry = () => { const deadline = expiry.current; if (deadline && (Date.now() >= deadline.wall || performance.now() >= deadline.monotonic)) forgetView("이슈 보기 시간이 만료되었습니다. 다시 확인해 주세요."); };
    window.addEventListener("focus", checkExpiry); document.addEventListener("visibilitychange", checkExpiry);
    return () => { alive.current = false; sequence.current++; if (expiry.current) clearTimeout(expiry.current.timer); window.removeEventListener("focus", checkExpiry); document.removeEventListener("visibilitychange", checkExpiry); };
  }, []);
  useEffect(() => { if (detail && active) detailHeading.current?.focus(); }, [detail]);
  useEffect(() => { if (requirementDetail && active) requirementHeading.current?.focus(); }, [requirementDetail]);
  useEffect(() => { if (diagnostics && active) diagnosticHeading.current?.focus(); }, [diagnostics]);
  useEffect(() => { if (categoryPage && active) categoryHeading.current?.focus(); }, [categoryPage]);
  useEffect(() => { if (projectPage && active) projectHeading.current?.focus(); }, [projectPage]);
  useEffect(() => { if (!loading && error && dependencyReturn.current) { const target = dependencyReturn.current; dependencyReturn.current = null; if (target.isConnected) target.focus(); else detailHeading.current?.focus(); return; } if (!loading && error && (diagnosticReturn.current || requirementReturn.current)) { const target = diagnosticReturn.current || requirementReturn.current; diagnosticReturn.current = null; if (target?.isConnected) target.focus(); else (detailFallback.current?.isConnected ? detailFallback.current : diagnosticHeading.current)?.focus(); detailFallback.current = null; } }, [loading, error]);
  const request = async (query: IssueViewQuery): Promise<IssueViewResult> => {
    const response = await api.request("view", query);
    if (!response.view) throw new IssueApiError("INVALID_RESPONSE", "이슈 내용을 확인할 수 없습니다.");
    return response.view;
  };
  const changeSelection = (item: IssueSummary, checked: boolean) => {
    if (!documentId || !revision) return;
    const without = selectedIssues.filter(selected => selected.id !== item.id);
    if (checked && without.length >= MAX_PREVIEW_SELECTION) return;
    setSelection({ documentId, revision, items: checked ? [...without, item] : without }); setSelectionResults(null);
  };
  const previewSelection = async () => {
    if (!documentId || !revision || !selectedIssues.length) return;
    const turn = ++sequence.current, ids = selectedIssues.map(item => item.id); setLoading(true); setError(""); setSelectionResults(null);
    try {
      const results = await previewCandidateSelection(documentId, revision, ids, request, () => alive.current && turn === sequence.current, candidateOptions);
      if (alive.current && turn === sequence.current) setSelectionResults(results);
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const failure = (caught: unknown) => {
    const text = caught instanceof Error ? caught.message : "이슈를 불러오지 못했습니다.";
    if (caught instanceof IssueApiError && caught.code === "VIEW_AUTH_REQUIRED") { forgetView(text); return; }
    if (caught instanceof IssueApiError && caught.code === "VERSION_CONFLICT") {
      setSourceTrace(null);
      loadedImportRevision.current = null;
      setDocuments([]); setRevision(null); setDocNext(null); setDocAfter(""); setDocHistory([]); setDocumentId(null); setIssues([]); setIssueNext(null); setIssueOffset(0); setIssueHistory([]); setDiagnostics(null); setDiagnosticOffset(0); setDiagnosticHistory([]); setCategoryPage(null); setCategoryPath([]); setCategoryOffset(0); setCategoryHistory([]); setProjectPage(null); setProjectHistory([]); clearDetails();
    }
    setError(text);
  };
  const clearDetails = (keepRequirement = false) => { diagnosticReturn.current = null; dependencyReturn.current = null; detailFallback.current = null; setDetailReturnKind(null); setDetailTrail([]); setDetail(null); setDetailDocumentId(null); setCriteria([]); setCriteriaNext(null); setRequirements([]); setRequirementsNext(null); setDependencies([]); setDependenciesNext(null); if (!keepRequirement) { requirementReturn.current = null; setRequirementDetail(null); setRequirementPage(null); setRequirementOffset(0); setRequirementHistory([]); } };
  const loadDocuments = async (afterId?: string, expectedRevision?: number, history: string[] = []) => {
    setSourceTrace(null);
    const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind: "documents", ...(afterId ? { afterId } : {}), ...(expectedRevision ? { expectedRevision } : {}) });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "documents") throw new Error("문서 목록 응답이 올바르지 않습니다.");
      loadedImportRevision.current = importRevision;
      setDocuments(result.documents); setRevision(result.revision); setDocNext(result.nextAfterId); setDocAfter(afterId || ""); setDocHistory(history); setDocumentId(null); setIssues([]); setDiagnostics(null); setDiagnosticOffset(0); setDiagnosticHistory([]); setCategoryPage(null); setCategoryPath([]); setCategoryOffset(0); setCategoryHistory([]); setProjectPage(null); setProjectHistory([]); clearDetails();
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  useEffect(() => { if (authorized && active && loadedImportRevision.current !== importRevision) void loadDocuments(); }, [authorized, active, importRevision]);
  const authorize = async () => {
    setLoading(true); setError(""); const turn = ++sequence.current;
    try {
      const result = await api.request("authorizeView");
      if (alive.current && turn === sequence.current && result.authorized && !result.cancelled && result.authorizedForMs) {
        const duration = Math.max(1, result.authorizedForMs - 1000);
        if (expiry.current) clearTimeout(expiry.current.timer);
        expiry.current = { wall: Date.now() + duration, monotonic: performance.now() + duration, timer: setTimeout(() => forgetView("이슈 보기 시간이 만료되었습니다. 다시 확인해 주세요."), duration) };
        setAuthorized(true);
      }
    }
    catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const loadIssues = async (doc: string, offset: number, history: number[] = [], filters: IssueFilters = appliedFilters) => {
    if (!revision) return; const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const nextFilters = { ...filters }; if (doc !== documentId) delete nextFilters.categoryId;
      const result = await request({ kind: "issues", documentId: doc, expectedRevision: revision, offset, filters: nextFilters });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "issues" || result.revision !== revision) throw new Error("이슈 목록 응답이 올바르지 않습니다.");
      if (doc !== documentId) {
        const categories = await request({ kind: "categories", documentId: doc, expectedRevision: revision, parentId: null, offset: 0 });
        if (!alive.current || turn !== sequence.current) return;
        if (categories.kind !== "categories" || categories.revision !== revision) throw new Error("분류 목록 응답이 올바르지 않습니다.");
        setCategoryPage(categories.page); setCategoryPath([]); setCategoryOffset(0); setCategoryHistory([]); setDiagnostics(null); setDiagnosticOffset(0); setDiagnosticHistory([]);
      }
      if (doc !== documentId) setSourceTrace(null);
      setDocumentId(doc); setIssues(result.page.items); setIssueNext(result.page.nextOffset); setIssueOffset(offset); setIssueHistory(history); setAppliedFilters(nextFilters); setExportNotice(""); clearDetails();
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!documentId) return;
    const filters: IssueFilters = { ...(appliedFilters.categoryId !== undefined ? { categoryId: appliedFilters.categoryId } : {}), ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}), ...(version.trim() ? { version: version.trim() } : {}) };
    void loadIssues(documentId, 0, [], filters);
  };
  const loadProjectIssues = async (cursor: ProjectIssueCursor, history: ProjectIssueCursor[], filters: ProjectIssueFilters) => {
    if (!revision) return;
    const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind: "projectIssues", expectedRevision: revision, cursor, filters });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "projectIssues" || result.revision !== revision) throw new IssueApiError("INVALID_RESPONSE", "전체 검색 결과를 확인할 수 없습니다.");
      const next = result.page.nextCursor, previousId = cursor.afterId ?? "", nextId = next?.afterId ?? "";
      if (result.page.documentId !== null && result.page.documentId <= previousId || next && (nextId < previousId || nextId === previousId && next.issueOffset <= cursor.issueOffset)) throw new IssueApiError("INVALID_RESPONSE", "전체 검색 위치를 확인할 수 없습니다.");
      setProjectPage(result.page); setProjectCursor(cursor); setProjectHistory(history); setProjectFilters(filters); clearDetails();
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const changeCategory = async (path: CategoryCrumb[], selected: string | null | undefined, offset = 0, history: number[] = []) => {
    if (!documentId || !revision) return;
    const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const categories = await request({ kind: "categories", documentId, expectedRevision: revision, parentId: path.at(-1)?.id ?? null, offset });
      if (!alive.current || turn !== sequence.current) return;
      if (categories.kind !== "categories" || categories.revision !== revision) throw new Error("분류 목록 응답이 올바르지 않습니다.");
      const filters = { ...appliedFilters }; if (selected === undefined) delete filters.categoryId; else filters.categoryId = selected;
      const result = await request({ kind: "issues", documentId, expectedRevision: revision, offset: 0, filters });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "issues" || result.revision !== revision) throw new Error("이슈 목록 응답이 올바르지 않습니다.");
      setCategoryPage(categories.page); setCategoryPath(path); setCategoryOffset(offset); setCategoryHistory(history);
      setIssues(result.page.items); setIssueNext(result.page.nextOffset); setIssueOffset(0); setIssueHistory([]); setAppliedFilters(filters); clearDetails();
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const loadCategoryPage = async (offset: number, history: number[]) => {
    if (!documentId || !revision) return;
    const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind: "categories", documentId, expectedRevision: revision, parentId: categoryPath.at(-1)?.id ?? null, offset });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "categories" || result.revision !== revision) throw new Error("분류 목록 응답이 올바르지 않습니다.");
      setCategoryPage(result.page); setCategoryOffset(offset); setCategoryHistory(history);
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const loadDiagnostics = async (offset = 0, history: number[] = []) => {
    if (!documentId || !revision) return;
    const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind: "diagnostics", documentId, expectedRevision: revision, offset });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "diagnostics" || result.revision !== revision) throw new IssueApiError("INVALID_RESPONSE", "문서 점검 결과를 확인할 수 없습니다.");
      setDiagnostics(result.report); setDiagnosticOffset(offset); setDiagnosticHistory(history);
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const loadSourceTrace = async (offset = 0, history: number[] = []) => {
    if (!documentId || !revision) return;
    const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind: "sourceTrace", documentId, expectedRevision: revision, offset });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "sourceTrace" || result.revision !== revision) throw new IssueApiError("INVALID_RESPONSE", "자료 연결을 확인할 수 없습니다.");
      setSourceTrace({ documentId, revision, page: result.page, offset, history });
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const exportDocument = async () => {
    if (!documentId || !revision) return;
    const turn = ++sequence.current; setLoading(true); setError(""); setExportNotice("");
    try {
      const result = await api.request("export", { documentId, expectedRevision: revision });
      if (!alive.current || turn !== sequence.current) return;
      if (!result.cancelled) setExportNotice(result.cleanupWarning ? "새 문서를 저장했지만 임시 파일을 정리하지 못했습니다. 선택한 폴더를 확인하세요." : "새 규격 문서를 저장했습니다. 기존 파일은 변경하지 않았습니다.");
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const openRequirement = async (requirementId: string, offset: number, history: number[], returnFocus?: HTMLButtonElement) => {
    if (!documentId || !revision) return;
    const turn = ++sequence.current; setLoading(true); setError("");
    clearDetails(!returnFocus); if (returnFocus) requirementReturn.current = returnFocus;
    try {
      const result = await request({ kind: "requirementDetail", documentId, expectedRevision: revision, requirementId, offset });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "requirementDetail" || result.revision !== revision || result.requirement.id !== requirementId || offset + result.page.items.length > result.requirement.linkedIssueCount || (result.page.nextOffset === null ? offset + result.page.items.length !== result.requirement.linkedIssueCount : result.page.nextOffset !== offset + result.page.items.length)) throw new IssueApiError("INVALID_RESPONSE", "요구사항 상세 응답이 올바르지 않습니다.");
      setRequirementDetail(result.requirement); setRequirementPage(result.page); setRequirementOffset(offset); setRequirementHistory(history);
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const openDetail = async (issue: Pick<IssueSummary, "id">, requestedDocumentId?: string, returnFocus?: HTMLButtonElement, fromRequirement = false, listSource?: "list" | "project", dependencyDirection?: "forward" | "back") => {
    const targetDocumentId = requestedDocumentId ?? documentId;
    if (!targetDocumentId || !revision || dependencyDirection && (!detail || !detailDocumentId || detailDocumentId !== targetDocumentId)) return; const turn = ++sequence.current; setLoading(true); setError("");
    if (dependencyDirection) dependencyReturn.current = returnFocus ?? null;
    else { clearDetails(fromRequirement); diagnosticReturn.current = returnFocus ?? null; detailFallback.current = fromRequirement ? requirementHeading.current : listSource === "list" ? issueListHeading.current : listSource === "project" ? projectHeading.current : diagnosticHeading.current; }
    try {
      const result = await request({ kind: "detail", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "detail" || result.revision !== revision || result.issue.id !== issue.id) throw new Error("이슈 상세 응답이 올바르지 않습니다.");
      const firstCriteria = await request({ kind: "criteria", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id, offset: 0 });
      if (!alive.current || turn !== sequence.current) return;
      if (firstCriteria.kind !== "criteria" || firstCriteria.revision !== revision || !validDetailPage(firstCriteria.page, 0, result.issue.criteriaCount)) throw new Error("완료 조건 응답이 올바르지 않습니다.");
      const firstRequirements = await request({ kind: "requirements", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id, offset: 0 });
      if (firstRequirements.kind !== "requirements" || firstRequirements.revision !== revision || !validDetailPage(firstRequirements.page, 0, result.issue.requirementCount, [], item => item.id)) throw new Error("요구사항 응답이 올바르지 않습니다.");
      if (!alive.current || turn !== sequence.current) return;
      const firstDependencies = await request({ kind: "dependencies", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id, offset: 0 });
      if (firstDependencies.kind !== "dependencies" || firstDependencies.revision !== revision || !validDetailPage(firstDependencies.page, 0, result.issue.dependencyCount, [], item => item.id)) throw new Error("선행 이슈 응답이 올바르지 않습니다.");
      if (!alive.current || turn !== sequence.current) return;
      if (dependencyDirection === "forward" && detail && detailDocumentId) setDetailTrail(current => [...current, { id: detail.id, documentId: detailDocumentId }]);
      else if (dependencyDirection === "back") setDetailTrail(current => current.slice(0, -1));
      dependencyReturn.current = null;
      setDetail(result.issue); setDetailDocumentId(targetDocumentId); if (!dependencyDirection) setDetailReturnKind(returnFocus ? fromRequirement ? "requirement" : listSource ?? "diagnostics" : null); setCriteria(firstCriteria.page.items); setCriteriaNext(firstCriteria.page.nextOffset); setRequirements(firstRequirements.page.items); setRequirementsNext(firstRequirements.page.nextOffset); setDependencies(firstDependencies.page.items); setDependenciesNext(firstDependencies.page.nextOffset);
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const more = async (kind: "criteria" | "requirements" | "dependencies", offset: number) => {
    if (!detail || !detailDocumentId || !revision) return; const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind, documentId: detailDocumentId, expectedRevision: revision, issueId: detail.id, offset });
      if (!alive.current || turn !== sequence.current) return;
      if (result.revision !== revision) throw new Error("이슈 상세 응답이 올바르지 않습니다.");
      if (kind === "criteria" && result.kind === "criteria" && validDetailPage(result.page, offset, detail.criteriaCount, criteria)) { setCriteria(current => [...current, ...result.page.items]); setCriteriaNext(result.page.nextOffset); }
      else if (kind === "requirements" && result.kind === "requirements" && validDetailPage(result.page, offset, detail.requirementCount, requirements, item => item.id)) { setRequirements(current => [...current, ...result.page.items]); setRequirementsNext(result.page.nextOffset); }
      else if (kind === "dependencies" && result.kind === "dependencies" && validDetailPage(result.page, offset, detail.dependencyCount, dependencies, item => item.id)) { setDependencies(current => [...current, ...result.page.items]); setDependenciesNext(result.page.nextOffset); }
      else throw new Error("이슈 상세 응답이 올바르지 않습니다.");
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const close = async () => {
    forgetView("");
    try { await api.request("releaseView"); } catch { /* The local view is already closed; the server also expires the grant. */ }
  };
  return <section className="issues-browser" hidden={!active} aria-labelledby="issues-list-heading">
    <div className="issues-browser-heading"><div><p className="issues-kicker">REGISTERED ISSUES</p><h2 id="issues-list-heading">등록된 이슈</h2></div>{authorized && <IssueListControls loading={loading} onRefresh={() => void loadDocuments()} onClose={() => void close()} />}</div>
    {!authorized && <div className="issues-empty"><p>저장된 이슈에는 선택한 문서의 내용이 포함됩니다. 현재 프로젝트 폴더를 확인한 뒤 이 창에서 볼 수 있습니다.</p><button type="button" onClick={() => void authorize()} disabled={loading}>{loading ? "폴더 선택을 기다리는 중…" : "이슈 목록 열기"}</button></div>}
    {authorized && <>
      <p className="issues-view-note">보기 권한은 이 연결에서 최대 15분 동안 유지됩니다. 목록을 새로고침하면 선택한 문서와 상세 화면이 닫힙니다. 가져온 완료 표시는 로컬 검증 결과가 아닙니다.</p>
      {revision !== null && <AnalysisSources api={api} revision={revision} loading={loading} setLoading={setLoading} onViewExpired={forgetView} />}
      {loading && <p role="status">이슈 내용을 불러오는 중…</p>}
      {revision && <ProjectIssueSearch page={projectPage} filters={projectFilters} history={projectHistory} loading={loading} headingRef={projectHeading} onSearch={filters => void loadProjectIssues({ issueOffset: 0 }, [], filters)} onPrevious={() => void loadProjectIssues(projectHistory.at(-1)!, projectHistory.slice(0, -1), projectFilters)} onNext={() => { if (projectPage?.nextCursor) void loadProjectIssues(projectPage.nextCursor, [...projectHistory, projectCursor], projectFilters); }} onOpen={(doc, issue, button) => void openDetail(issue, doc, button, false, "project")} />}
      {!loading && !error && documents.length === 0 && <p className="issues-empty">등록된 이슈 문서가 없습니다. 규격 문서를 가져오면 여기에 표시됩니다.</p>}
      {documents.length > 0 && <div className="issues-browser-columns"><div><h3>문서</h3><ul className="issues-document-list">{documents.map(doc => <li key={doc.id}><button type="button" onClick={() => void loadIssues(doc.id, 0)} disabled={loading} aria-current={documentId === doc.id ? "true" : undefined}><strong>{doc.id}</strong><small>이슈 {doc.issueCount}개 · 문서 r{doc.documentRevision}</small></button></li>)}</ul><div className="issues-pagination">{docHistory.length > 0 && <button type="button" disabled={loading} onClick={() => void loadDocuments(docHistory.at(-1) || undefined, revision || undefined, docHistory.slice(0, -1))}>이전 문서</button>}{docNext && <button type="button" disabled={loading} onClick={() => void loadDocuments(docNext, revision || undefined, [...docHistory, docAfter])}>다음 문서</button>}</div>{documentId && categoryPage && <IssueCategoryNavigation page={categoryPage} path={categoryPath} selected={appliedFilters.categoryId} history={categoryHistory} loading={loading} headingRef={categoryHeading} onAll={() => void changeCategory([], undefined)} onUncategorized={() => void changeCategory([], null)} onParent={() => { const previous = categoryPath.at(-1); if (previous) { const path = categoryPath.slice(0, -1); void changeCategory(path, path.at(-1)?.id, previous.parentOffset, previous.parentHistory); } }} onSelect={item => void changeCategory([...categoryPath, { ...item, parentOffset: categoryOffset, parentHistory: categoryHistory }], item.id)} onPrevious={() => void loadCategoryPage(categoryHistory.at(-1)!, categoryHistory.slice(0, -1))} onNext={() => { if (categoryPage.nextOffset !== null) void loadCategoryPage(categoryPage.nextOffset, [...categoryHistory, categoryOffset]); }} />}</div>
      <div><h3 tabIndex={-1} ref={issueListHeading}>이슈</h3>{!documentId ? <p>문서를 선택하세요.</p> : <><div className="issues-export"><button type="button" onClick={() => void exportDocument()} disabled={loading}>선택 문서 새 파일로 내보내기</button><p className="issues-view-note">프로젝트 안에 새 Markdown 파일을 만듭니다. 기존 파일은 덮어쓰지 않습니다. 문서의 완료 표시는 로컬 검증 결과가 아닙니다.</p>{exportNotice && <p role="status">{exportNotice}</p>}</div><form className="issues-filters" onSubmit={applyFilters}><label>검색 <input type="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="제목, 설명, 분류, ID" /></label><label>상태 <select value={status} onChange={event => setStatus(event.target.value as IssueViewStatus | "")}><option value="">전체</option><option value="ready">대기</option><option value="retryable">재시도 필요</option><option value="failed">실패</option><option value="needs_review">검토 필요</option></select></label><label>개발 버전 <input value={version} onChange={event => setVersion(event.target.value)} maxLength={1024} pattern="[0-9]+\.[0-9]+\.[0-9]+" title="예: 1.2.0" placeholder="예: 1.2.0" /></label><button type="submit" disabled={loading}>적용</button></form><p className="issues-view-note">선택한 문서에서 검색합니다. 상태는 로컬 상태 기준입니다.</p><IssueSelectionPreview selected={selectedIssues} results={selection?.documentId === documentId && selection.revision === revision ? selectionResults : null} loading={loading} onRemove={id => { const item = selectedIssues.find(selected => selected.id === id); if (item) changeSelection(item, false); }} onPreview={() => void previewSelection()} onClear={() => { setSelection(null); setSelectionResults(null); }} options={candidateOptions} onOptionsChange={options => { setCandidateOptions(options); setSelectionResults(null); }} onOpenIssue={(id, button) => void openDetail({ id }, documentId, button, false, "list")} />{issues.length === 0 ? <p>조건에 맞는 이슈가 없습니다.</p> : <ul className="issues-list">{issues.map(issue => <IssueRow key={issue.id} issue={issue} disabled={loading} selected={selectedIssues.some(item => item.id === issue.id)} selectionDisabled={selectedIssues.length >= MAX_PREVIEW_SELECTION && !selectedIssues.some(item => item.id === issue.id)} onSelect={checked => changeSelection(issue, checked)} onOpen={button => void openDetail(issue, undefined, button, false, "list")} />)}</ul>}<div className="issues-pagination">{issueHistory.length > 0 && <button type="button" disabled={loading} onClick={() => void loadIssues(documentId, issueHistory.at(-1)!, issueHistory.slice(0, -1))}>이전 이슈</button>}{issueNext !== null && <button type="button" disabled={loading} onClick={() => void loadIssues(documentId, issueNext, [...issueHistory, issueOffset])}>다음 이슈</button>}</div></>}</div></div>}
      {documentId && <div className="issues-diagnostics-action"><button type="button" disabled={loading} onClick={() => void loadDiagnostics()}>선택 문서 연결 점검</button><p className="issues-view-note">저장된 연결, 빈 항목, AI 제안 출처, 같은 문구와 같은 버전의 순서 중복을 읽기 전용으로 확인합니다.</p></div>}
<<<<<<< HEAD
      {documentId && <div><button type="button" disabled={loading} onClick={() => void loadSourceTrace()}>자료와 요구사항 연결 보기</button><p className="issues-view-note">문서에 기록된 연결만 표시하며 원문 내용이나 연결의 정확성은 확인하지 않습니다.</p></div>}
      {sourceTrace && sourceTrace.documentId === documentId && sourceTrace.revision === revision && <section aria-label="자료와 요구사항 연결"><h3>자료와 요구사항 연결</h3>{sourceTrace.page.items.length ? <ul>{sourceTrace.page.items.map((row, index) => <li key={`${row.sourceId}:${row.requirement?.id ?? index}`}><strong>{row.sourceName}</strong> · {row.sourceId}{row.requirement ? <><p className="issues-prewrap">{row.requirement.text}</p><small>{ORIGIN[row.requirement.origin]}{row.requirement.locator ? ` · ${row.requirement.locator}` : ""}</small><div><button type="button" disabled={loading} onClick={event => void openRequirement(row.requirement!.id, 0, [], event.currentTarget)}>요구사항 및 연결 이슈 보기</button></div></> : <p>연결된 요구사항이 없습니다.</p>}</li>)}</ul> : <p>문서에 등록된 자료가 없습니다.</p>}<div className="issues-pagination">{sourceTrace.history.length > 0 && <button type="button" disabled={loading} onClick={() => void loadSourceTrace(sourceTrace.history.at(-1)!, sourceTrace.history.slice(0, -1))}>이전 연결</button>}{sourceTrace.page.nextOffset !== null && <button type="button" disabled={loading} onClick={() => void loadSourceTrace(sourceTrace.page.nextOffset!, [...sourceTrace.history, sourceTrace.offset])}>다음 연결</button>}</div></section>}
      {diagnostics && revision && <IssueDiagnostics report={diagnostics} revision={revision} documentId={documentId ?? undefined} offset={diagnosticOffset} history={diagnosticHistory} loading={loading} headingRef={diagnosticHeading} onOpenIssue={(id, button) => void openDetail({ id }, undefined, button)} onOpenRequirement={(id, button) => void openRequirement(id, 0, [], button)} onPrevious={() => void loadDiagnostics(diagnosticHistory.at(-1)!, diagnosticHistory.slice(0, -1))} onNext={() => { if (diagnostics.findings.nextOffset !== null) void loadDiagnostics(diagnostics.findings.nextOffset, [...diagnosticHistory, diagnosticOffset]); }} />}
=======
      {diagnostics && revision && <IssueDiagnostics report={diagnostics} revision={revision} documentId={documentId ?? undefined} offset={diagnosticOffset} history={diagnosticHistory} loading={loading} headingRef={diagnosticHeading} onOpenIssue={(id, button) => void openDetail({ id }, undefined, button)} onOpenRequirement={(id, button) => void openRequirement(id, 0, [], button)} onOpenCategory={id => void changeCategory([], id)} onPrevious={() => void loadDiagnostics(diagnosticHistory.at(-1)!, diagnosticHistory.slice(0, -1))} onNext={() => { if (diagnostics.findings.nextOffset !== null) void loadDiagnostics(diagnostics.findings.nextOffset, [...diagnosticHistory, diagnosticOffset]); }} />}
>>>>>>> 3819e49eb81bc37c76378b17f332ab2b116bc8d0
      {requirementDetail && requirementPage && <RequirementDetailPanel requirement={requirementDetail} page={requirementPage} offset={requirementOffset} history={requirementHistory} loading={loading} headingRef={requirementHeading} onBack={() => { const target = requirementReturn.current; clearDetails(); if (target?.isConnected) target.focus(); else diagnosticHeading.current?.focus(); }} onOpenIssue={(issue, button) => void openDetail(issue, undefined, button, true)} onPrevious={() => void openRequirement(requirementDetail.id, requirementHistory.at(-1)!, requirementHistory.slice(0, -1))} onNext={() => { if (requirementPage.nextOffset !== null) void openRequirement(requirementDetail.id, requirementPage.nextOffset, [...requirementHistory, requirementOffset]); }} />}
      {detail && detailDocumentId && <p className="issues-view-note">이슈 상세 기준 문서: {detailDocumentId} · 이슈 ID: {detail.id}</p>}
      {detail && detailReturnKind && <IssueDetailBack kind={detailTrail.length ? "dependency" : detailReturnKind} loading={loading} onBack={button => { const previous = detailTrail.at(-1); if (previous) { void openDetail({ id: previous.id }, previous.documentId, button, false, undefined, "back"); return; } const target = diagnosticReturn.current, fallback = detailFallback.current, fromRequirement = detailReturnKind === "requirement"; clearDetails(fromRequirement); if (target?.isConnected) target.focus(); else if (fallback?.isConnected) fallback.focus(); }} />}
      {detail && detailTrail.length > 0 && <p className="issues-view-note">이전 이슈로 돌아가면 상세 항목을 첫 페이지부터 다시 불러옵니다.</p>}
      {detail && <article className="issues-detail" aria-label="이슈 상세"><div className="issues-detail-heading"><h3 tabIndex={-1} ref={detailHeading}>{detail.title}</h3><span className="issues-status">{STATUS[detail.localStatus]}</span></div><p>{detail.category || "미분류"} · v{detail.version}</p>{detail.importedStatus === "completed" && <p className="issues-view-note">가져온 문서에는 완료로 표시되어 있습니다. 현재 프로젝트에서의 완료는 확인되지 않았습니다.</p>}<IssueCandidateCheck reasons={detail.candidateReasons} /><h4>설명</h4><p className="issues-prewrap">{detail.description || "설명이 없습니다."}</p><h4>완료 조건 <small>{criteria.length}/{detail.criteriaCount}</small></h4>{criteria.length ? <ul>{criteria.map((criterion, index) => <li key={index} className="issues-prewrap">{criterion}</li>)}</ul> : <p>완료 조건이 없어 검토가 필요합니다.</p>}{criteriaNext !== null && <button type="button" disabled={loading} onClick={() => void more("criteria", criteriaNext)}>완료 조건 더 보기</button>}<h4>연결된 요구사항 <small>{requirements.length}/{detail.requirementCount}</small></h4>{requirements.length ? <ul>{requirements.map(requirement => <li key={requirement.id}><p className="issues-prewrap">{requirement.text}</p><small>{ORIGIN[requirement.origin]}{requirement.sourceName ? ` · ${requirement.sourceName}` : ""}{requirement.locator ? ` · ${requirement.locator}` : ""}</small></li>)}</ul> : <p>연결된 요구사항이 없습니다.</p>}{requirementsNext !== null && <button type="button" disabled={loading} onClick={() => void more("requirements", requirementsNext)}>요구사항 더 보기</button>}<h4>선행 이슈 <small>{dependencies.length}/{detail.dependencyCount}</small></h4>{dependencies.length ? <IssueDependencyList dependencies={dependencies} loading={loading} onOpen={(id, button) => void openDetail({ id }, detailDocumentId ?? undefined, button, false, undefined, "forward")} /> : <p>선행 이슈가 없습니다.</p>}{dependenciesNext !== null && <button type="button" disabled={loading} onClick={() => void more("dependencies", dependenciesNext)}>선행 이슈 더 보기</button>}</article>}
    </>}
    {error && <div className="issues-notice" role="alert"><p>{error}</p>{authorized && <button type="button" onClick={() => void loadDocuments()} disabled={loading}>목록 다시 불러오기</button>}</div>}
  </section>;
}
