import { useEffect, useRef, useState } from "react";
import type { IssueCategoryView, IssueDependencyView, IssueDetail, IssueDiagnosticReport, IssueDocumentSummary, IssueFindingCode, IssueFilters, IssueRequirementView, IssueSummary, IssueViewQuery, IssueViewResult, IssueViewStatus, Page, ProjectIssueCursor, ProjectIssueFilters, ProjectIssuePage, RequirementDetail } from "../../../shared/issues/view";
import { IssueApiError, type IssueApi } from "./api";
import { AnalysisSources } from "./AnalysisSources";

const STATUS: Record<IssueSummary["localStatus"], string> = { ready: "□ 대기", retryable: "△ 재시도 필요", failed: "✕ 실패", needs_review: "? 검토 필요" };
const ORIGIN: Record<IssueRequirementView["origin"], string> = { source: "원본 자료", user: "사용자 입력", "ai-proposal": "AI 제안" };
const FINDING: Record<IssueFindingCode, string> = { "requirement-unlinked": "이슈에 연결되지 않은 요구사항", "requirement-uncategorized": "분류가 없는 요구사항", "requirement-same-text": "내용이 같은 요구사항 · 중복 여부 확인", "issue-unlinked": "요구사항에 연결되지 않은 이슈", "issue-uncategorized": "분류가 없는 이슈", "issue-missing-description": "설명이 없는 이슈", "issue-missing-criteria": "완료 조건이 없는 이슈", "issue-unverified-completion": "문서의 완료 표시를 로컬에서 확인하지 않은 이슈", "issue-same-title": "제목이 같은 이슈 · 중복 여부 확인" };
type Props = { api: IssueApi; active: boolean; importRevision: number };
type CategoryCrumb = IssueCategoryView & { parentOffset: number; parentHistory: number[] };

export function IssueCategoryNavigation({ page, path, selected, history, loading, onAll, onUncategorized, onParent, onSelect, onPrevious, onNext, headingRef }: { page: Page<IssueCategoryView>; path: CategoryCrumb[]; selected: string | null | undefined; history: number[]; loading: boolean; onAll: () => void; onUncategorized: () => void; onParent: () => void; onSelect: (item: IssueCategoryView) => void; onPrevious: () => void; onNext: () => void; headingRef?: React.Ref<HTMLHeadingElement> }) {
  const current = selected === null ? "미분류" : path.length ? path.map(item => `${item.title} (${item.id})`).join(" / ") : "전체";
  return <nav className="issues-categories" aria-label="문서 분류 탐색"><h3 tabIndex={-1} ref={headingRef}>분류 탐색</h3><p className="issues-view-note">현재: {current}</p><p className="issues-view-note">선택한 분류의 모든 하위 분류도 포함합니다.</p><div className="issues-category-actions"><button type="button" disabled={loading} aria-pressed={selected === undefined} onClick={onAll}>전체 이슈</button><button type="button" disabled={loading} aria-pressed={selected === null} onClick={onUncategorized}>미분류</button>{path.length > 0 && <button type="button" disabled={loading} onClick={onParent}>상위 분류</button>}</div>{page.items.length ? <ul className="issues-category-list">{page.items.map(item => <li key={item.id}><button type="button" disabled={loading} onClick={() => onSelect(item)}><strong>{item.title}</strong><small>{item.id}{item.hasChildren ? " · 하위 분류 있음" : ""}</small></button></li>)}</ul> : <p className="issues-view-note">표시할 하위 분류가 없습니다.</p>}<div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={onPrevious}>이전 분류</button>}{page.nextOffset !== null && <button type="button" disabled={loading} onClick={onNext}>다음 분류</button>}</div></nav>;
}

export function IssueRow({ issue, disabled, onOpen }: { issue: IssueSummary; disabled: boolean; onOpen: () => void }) {
  return <li><button type="button" onClick={onOpen} disabled={disabled}><span><strong>{issue.title}</strong><small>{issue.category || "미분류"} · v{issue.version}</small>{issue.missingCriteria && <small className="issues-block-reason">완료 조건 없음</small>}{issue.unverifiedDependencies > 0 && <small className="issues-block-reason">선행 이슈 {issue.unverifiedDependencies}개 미확인</small>}</span><span className="issues-status">{STATUS[issue.localStatus]}</span></button></li>;
}
export function ProjectIssueSearch({ page, filters, history, loading, onSearch, onPrevious, onNext, onOpen, headingRef }: { page: ProjectIssuePage | null; filters: ProjectIssueFilters; history: ProjectIssueCursor[]; loading: boolean; onSearch: (filters: ProjectIssueFilters) => void; onPrevious: () => void; onNext: () => void; onOpen: (documentId: string, issue: IssueSummary) => void; headingRef?: React.Ref<HTMLHeadingElement> }) {
  const [text, setText] = useState(""), [status, setStatus] = useState<IssueViewStatus | "">(""), [version, setVersion] = useState("");
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); onSearch({ ...(text.trim() ? { search: text.trim() } : {}), ...(status ? { status } : {}), ...(version.trim() ? { version: version.trim() } : {}) }); };
  const applied = [filters.search ? `검색: ${filters.search}` : "검색어 전체", filters.status ? `상태: ${STATUS[filters.status]}` : "상태 전체", filters.version ? `버전: ${filters.version}` : "버전 전체"].join(" · ");
  return <section className="issues-project-search" aria-labelledby="project-issue-search-heading"><h3 id="project-issue-search-heading" tabIndex={-1} ref={headingRef}>프로젝트 전체 이슈 검색</h3><p className="issues-view-note">등록된 이슈 문서를 ID 순으로 한 번에 최대 8개 확인합니다. 추가 범위는 다음 결과를 눌러 계속 검색하세요.</p><form className="issues-filters" onSubmit={submit}><label>전체 문서 검색 <input type="search" value={text} onChange={event => setText(event.target.value)} maxLength={120} placeholder="제목, 설명, 분류, ID" /></label><label>전체 문서 상태 <select value={status} onChange={event => setStatus(event.target.value as IssueViewStatus | "")}><option value="">전체</option><option value="ready">대기</option><option value="retryable">재시도 필요</option><option value="failed">실패</option><option value="needs_review">검토 필요</option></select></label><label>전체 문서 개발 버전 <input value={version} onChange={event => setVersion(event.target.value)} maxLength={1024} pattern="[0-9]+\.[0-9]+\.[0-9]+" title="예: 1.2.0" placeholder="예: 1.2.0" /></label><button type="submit" disabled={loading}>전체 문서 검색</button></form>{page && <div><p className="issues-view-note">적용 조건: {applied}</p><p>이번 요청에서 확인한 문서 {page.scannedDocuments}개{page.documentId ? ` · 결과 문서: ${page.documentId}` : ""}</p>{page.items.length && page.documentId ? <ul className="issues-list">{page.items.map(issue => <IssueRow key={issue.id} issue={issue} disabled={loading} onOpen={() => onOpen(page.documentId!, issue)} />)}</ul> : <p>이번 검색 범위에는 일치하는 이슈가 없습니다.</p>}<p className="issues-view-note">{page.nextCursor ? "아직 확인할 결과 또는 문서가 남아 있습니다." : "더 확인할 결과나 문서가 없습니다."}</p><div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={onPrevious}>이전 검색 결과</button>}{page.nextCursor && <button type="button" disabled={loading} onClick={onNext}>다음 검색 결과</button>}</div></div>}</section>;
}
export function IssueDiagnostics({ report, revision, offset, history, loading, onPrevious, onNext, onOpenIssue, onOpenRequirement, headingRef, documentId }: { report: IssueDiagnosticReport; revision: number; offset: number; history: number[]; loading: boolean; onPrevious: () => void; onNext: () => void; onOpenIssue?: (issueId: string, returnFocus: HTMLButtonElement) => void; onOpenRequirement?: (requirementId: string, returnFocus: HTMLButtonElement) => void; headingRef?: React.Ref<HTMLHeadingElement>; documentId?: string }) {
  return <section className="issues-diagnostics" aria-label="문서 연결 점검 결과">
    <h3 tabIndex={-1} ref={headingRef}>문서 연결 점검 결과</h3>
    <p>{documentId ? `문서 ${documentId} · ` : ""}문서 r{report.documentRevision} · 프로젝트 r{revision}</p>
    <p>요구사항 {report.requirementCount}개 중 이슈에 연결된 항목 {report.linkedRequirementCount}개 · 이슈 {report.issueCount}개</p>
    <p>확인할 항목 {report.totalFindings}개{report.totalFindings > 0 ? ` · ${offset + 1}–${offset + report.findings.items.length} 표시` : ""}</p>
    <p className="issues-view-note">문서에 기록된 연결, 빈 항목과 같은 문구를 점검했습니다. 같은 문구가 실제 중복인지는 확인이 필요합니다. 원문 누락, 의미적 완전성, 실제 코드 동작은 확인하지 않았습니다. 결과는 저장되지 않습니다.</p>
    {report.findings.items.length ? <ul>{report.findings.items.map(item => <li key={`${item.code}:${item.entityId}`}>
      <strong>{FINDING[item.code]}</strong><br /><span>{item.title ? `${item.title} · ` : ""}{item.entityId}</span>
      {item.relatedEntityId && <small className="issues-finding-origin">비교 대상 ID: {item.relatedEntityId}</small>}
      {item.provenance && <small className="issues-finding-origin">{ORIGIN[item.provenance.origin]}{item.provenance.sourceName ? ` · ${item.provenance.sourceName}` : ""}{item.provenance.locator ? ` · ${item.provenance.locator}` : ""}</small>}
      {onOpenIssue && item.code.startsWith("issue-") && <div className="issues-finding-actions">
        <button type="button" disabled={loading} aria-label={`${item.entityId} 이슈 상세 보기`} onClick={event => onOpenIssue(item.entityId, event.currentTarget)}>이슈 상세 보기</button>
        {item.relatedEntityId && <button type="button" disabled={loading} aria-label={`${item.relatedEntityId} 비교 이슈 상세 보기`} onClick={event => onOpenIssue(item.relatedEntityId!, event.currentTarget)}>비교 이슈 상세 보기</button>}
      </div>}
      {onOpenRequirement && item.code.startsWith("requirement-") && <div className="issues-finding-actions">
        <button type="button" disabled={loading} aria-label={`${item.entityId} 요구사항 상세 보기`} onClick={event => onOpenRequirement(item.entityId, event.currentTarget)}>요구사항 상세 보기</button>
        {item.relatedEntityId && <button type="button" disabled={loading} aria-label={`${item.relatedEntityId} 비교 요구사항 상세 보기`} onClick={event => onOpenRequirement(item.relatedEntityId!, event.currentTarget)}>비교 요구사항 상세 보기</button>}
      </div>}
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
  const [detail, setDetail] = useState<IssueDetail | null>(null), [criteria, setCriteria] = useState<string[]>([]), [criteriaNext, setCriteriaNext] = useState<number | null>(null), [requirements, setRequirements] = useState<IssueRequirementView[]>([]), [requirementsNext, setRequirementsNext] = useState<number | null>(null);
  const [detailDocumentId, setDetailDocumentId] = useState<string | null>(null);
  const [detailReturnKind, setDetailReturnKind] = useState<"diagnostics" | "requirement" | null>(null);
  const [requirementDetail, setRequirementDetail] = useState<RequirementDetail | null>(null), [requirementPage, setRequirementPage] = useState<Page<IssueSummary> | null>(null), [requirementOffset, setRequirementOffset] = useState(0), [requirementHistory, setRequirementHistory] = useState<number[]>([]);
  const [dependencies, setDependencies] = useState<IssueDependencyView[]>([]), [dependenciesNext, setDependenciesNext] = useState<number | null>(null);
  const [search, setSearch] = useState(""), [status, setStatus] = useState<IssueViewStatus | "">(""), [version, setVersion] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<IssueFilters>({});
  const [exportNotice, setExportNotice] = useState("");
  const [categoryPage, setCategoryPage] = useState<Page<IssueCategoryView> | null>(null), [categoryPath, setCategoryPath] = useState<CategoryCrumb[]>([]), [categoryOffset, setCategoryOffset] = useState(0), [categoryHistory, setCategoryHistory] = useState<number[]>([]);
  const [diagnostics, setDiagnostics] = useState<IssueDiagnosticReport | null>(null), [diagnosticOffset, setDiagnosticOffset] = useState(0), [diagnosticHistory, setDiagnosticHistory] = useState<number[]>([]);
  const [projectPage, setProjectPage] = useState<ProjectIssuePage | null>(null), [projectCursor, setProjectCursor] = useState<ProjectIssueCursor>({ issueOffset: 0 }), [projectHistory, setProjectHistory] = useState<ProjectIssueCursor[]>([]), [projectFilters, setProjectFilters] = useState<ProjectIssueFilters>({});
  const alive = useRef(true), sequence = useRef(0), detailHeading = useRef<HTMLHeadingElement>(null), diagnosticHeading = useRef<HTMLHeadingElement>(null), categoryHeading = useRef<HTMLHeadingElement>(null), projectHeading = useRef<HTMLHeadingElement>(null);
  const diagnosticReturn = useRef<HTMLButtonElement | null>(null), requirementReturn = useRef<HTMLButtonElement | null>(null), requirementHeading = useRef<HTMLHeadingElement>(null);
  const expiry = useRef<{ timer: ReturnType<typeof setTimeout>; wall: number; monotonic: number } | null>(null);
  const forgetView = (message: string) => {
    sequence.current++; if (expiry.current) clearTimeout(expiry.current.timer); expiry.current = null; diagnosticReturn.current = null; requirementReturn.current = null; setDetailReturnKind(null); setRequirementDetail(null); setRequirementPage(null); setRequirementOffset(0); setRequirementHistory([]);
    setAuthorized(false); setDocuments([]); setRevision(null); setDocNext(null); setDocAfter(""); setDocHistory([]); setDocumentId(null); setIssues([]); setIssueNext(null); setIssueOffset(0); setIssueHistory([]); setDetail(null); setDetailDocumentId(null); setCriteria([]); setCriteriaNext(null); setRequirements([]); setRequirementsNext(null); setDependencies([]); setDependenciesNext(null); setSearch(""); setStatus(""); setVersion(""); setAppliedFilters({}); setExportNotice(""); setDiagnostics(null); setDiagnosticOffset(0); setDiagnosticHistory([]); setCategoryPage(null); setCategoryPath([]); setCategoryOffset(0); setCategoryHistory([]); setProjectPage(null); setProjectCursor({ issueOffset: 0 }); setProjectHistory([]); setProjectFilters({}); setLoading(false); setError(message);
  };
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
  useEffect(() => { if (!loading && error && (diagnosticReturn.current || requirementReturn.current)) { const target = diagnosticReturn.current || requirementReturn.current; diagnosticReturn.current = null; if (target?.isConnected) target.focus(); else diagnosticHeading.current?.focus(); } }, [loading, error]);
  const request = async (query: IssueViewQuery): Promise<IssueViewResult> => {
    const response = await api.request("view", query);
    if (!response.view) throw new IssueApiError("INVALID_RESPONSE", "이슈 내용을 확인할 수 없습니다.");
    return response.view;
  };
  const failure = (caught: unknown) => {
    const text = caught instanceof Error ? caught.message : "이슈를 불러오지 못했습니다.";
    if (caught instanceof IssueApiError && caught.code === "VIEW_AUTH_REQUIRED") { forgetView(text); return; }
    if (caught instanceof IssueApiError && caught.code === "VERSION_CONFLICT") {
      setDocuments([]); setRevision(null); setDocNext(null); setDocAfter(""); setDocHistory([]); setDocumentId(null); setIssues([]); setIssueNext(null); setIssueOffset(0); setIssueHistory([]); setDiagnostics(null); setDiagnosticOffset(0); setDiagnosticHistory([]); setCategoryPage(null); setCategoryPath([]); setCategoryOffset(0); setCategoryHistory([]); setProjectPage(null); setProjectHistory([]); clearDetails();
    }
    setError(text);
  };
  const clearDetails = (keepRequirement = false) => { diagnosticReturn.current = null; setDetailReturnKind(null); setDetail(null); setDetailDocumentId(null); setCriteria([]); setCriteriaNext(null); setRequirements([]); setRequirementsNext(null); setDependencies([]); setDependenciesNext(null); if (!keepRequirement) { requirementReturn.current = null; setRequirementDetail(null); setRequirementPage(null); setRequirementOffset(0); setRequirementHistory([]); } };
  const loadDocuments = async (afterId?: string, expectedRevision?: number, history: string[] = []) => {
    const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind: "documents", ...(afterId ? { afterId } : {}), ...(expectedRevision ? { expectedRevision } : {}) });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "documents") throw new Error("문서 목록 응답이 올바르지 않습니다.");
      setDocuments(result.documents); setRevision(result.revision); setDocNext(result.nextAfterId); setDocAfter(afterId || ""); setDocHistory(history); setDocumentId(null); setIssues([]); setDiagnostics(null); setDiagnosticOffset(0); setDiagnosticHistory([]); setCategoryPage(null); setCategoryPath([]); setCategoryOffset(0); setCategoryHistory([]); setProjectPage(null); setProjectHistory([]); clearDetails();
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  useEffect(() => { if (authorized && active) void loadDocuments(); }, [authorized, active, importRevision]);
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
  const openDetail = async (issue: Pick<IssueSummary, "id">, requestedDocumentId?: string, returnFocus?: HTMLButtonElement, fromRequirement = false) => {
    const targetDocumentId = requestedDocumentId ?? documentId;
    if (!targetDocumentId || !revision) return; const turn = ++sequence.current; setLoading(true); setError(""); clearDetails(fromRequirement); diagnosticReturn.current = returnFocus ?? null;
    try {
      const result = await request({ kind: "detail", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id });
      if (!alive.current || turn !== sequence.current) return;
      if (result.kind !== "detail" || result.revision !== revision || result.issue.id !== issue.id) throw new Error("이슈 상세 응답이 올바르지 않습니다.");
      const firstCriteria = await request({ kind: "criteria", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id, offset: 0 });
      if (!alive.current || turn !== sequence.current) return;
      if (firstCriteria.kind !== "criteria" || firstCriteria.revision !== revision) throw new Error("완료 조건 응답이 올바르지 않습니다.");
      const firstRequirements = await request({ kind: "requirements", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id, offset: 0 });
      if (firstRequirements.kind !== "requirements" || firstRequirements.revision !== revision) throw new Error("요구사항 응답이 올바르지 않습니다.");
      if (!alive.current || turn !== sequence.current) return;
      const firstDependencies = await request({ kind: "dependencies", documentId: targetDocumentId, expectedRevision: revision, issueId: issue.id, offset: 0 });
      if (firstDependencies.kind !== "dependencies" || firstDependencies.revision !== revision) throw new Error("선행 이슈 응답이 올바르지 않습니다.");
      if (!alive.current || turn !== sequence.current) return;
      setDetail(result.issue); setDetailDocumentId(targetDocumentId); setDetailReturnKind(returnFocus ? fromRequirement ? "requirement" : "diagnostics" : null); setCriteria(firstCriteria.page.items); setCriteriaNext(firstCriteria.page.nextOffset); setRequirements(firstRequirements.page.items); setRequirementsNext(firstRequirements.page.nextOffset); setDependencies(firstDependencies.page.items); setDependenciesNext(firstDependencies.page.nextOffset);
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const more = async (kind: "criteria" | "requirements" | "dependencies", offset: number) => {
    if (!detail || !detailDocumentId || !revision) return; const turn = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await request({ kind, documentId: detailDocumentId, expectedRevision: revision, issueId: detail.id, offset });
      if (!alive.current || turn !== sequence.current) return;
      if (result.revision !== revision) throw new Error("이슈 상세 응답이 올바르지 않습니다.");
      if (kind === "criteria" && result.kind === "criteria") { setCriteria(current => [...current, ...result.page.items]); setCriteriaNext(result.page.nextOffset); }
      else if (kind === "requirements" && result.kind === "requirements") { setRequirements(current => [...current, ...result.page.items]); setRequirementsNext(result.page.nextOffset); }
      else if (kind === "dependencies" && result.kind === "dependencies") { setDependencies(current => [...current, ...result.page.items]); setDependenciesNext(result.page.nextOffset); }
      else throw new Error("이슈 상세 응답이 올바르지 않습니다.");
    } catch (caught) { if (alive.current && turn === sequence.current) failure(caught); }
    finally { if (alive.current && turn === sequence.current) setLoading(false); }
  };
  const close = async () => {
    forgetView("");
    try { await api.request("releaseView"); } catch { /* The local view is already closed; the server also expires the grant. */ }
  };
  return <section className="issues-browser" hidden={!active} aria-labelledby="issues-list-heading">
    <div className="issues-browser-heading"><div><p className="issues-kicker">REGISTERED ISSUES</p><h2 id="issues-list-heading">등록된 이슈</h2></div>{authorized && <button type="button" onClick={() => void close()} disabled={loading}>목록 닫기</button>}</div>
    {!authorized && <div className="issues-empty"><p>저장된 이슈에는 선택한 문서의 내용이 포함됩니다. 현재 프로젝트 폴더를 확인한 뒤 이 창에서 볼 수 있습니다.</p><button type="button" onClick={() => void authorize()} disabled={loading}>{loading ? "폴더 선택을 기다리는 중…" : "이슈 목록 열기"}</button></div>}
    {authorized && <>
      <p className="issues-view-note">보기 권한은 이 연결에서 15분 동안 유지됩니다. 가져온 완료 표시는 로컬 검증 결과가 아닙니다.</p>
      {revision !== null && <AnalysisSources api={api} revision={revision} loading={loading} setLoading={setLoading} onViewExpired={forgetView} />}
      {loading && <p role="status">이슈 내용을 불러오는 중…</p>}
      {revision && <ProjectIssueSearch page={projectPage} filters={projectFilters} history={projectHistory} loading={loading} headingRef={projectHeading} onSearch={filters => void loadProjectIssues({ issueOffset: 0 }, [], filters)} onPrevious={() => void loadProjectIssues(projectHistory.at(-1)!, projectHistory.slice(0, -1), projectFilters)} onNext={() => { if (projectPage?.nextCursor) void loadProjectIssues(projectPage.nextCursor, [...projectHistory, projectCursor], projectFilters); }} onOpen={(doc, issue) => void openDetail(issue, doc)} />}
      {!loading && !error && documents.length === 0 && <p className="issues-empty">등록된 이슈 문서가 없습니다. 규격 문서를 가져오면 여기에 표시됩니다.</p>}
      {documents.length > 0 && <div className="issues-browser-columns"><div><h3>문서</h3><ul className="issues-document-list">{documents.map(doc => <li key={doc.id}><button type="button" onClick={() => void loadIssues(doc.id, 0)} disabled={loading} aria-current={documentId === doc.id ? "true" : undefined}><strong>{doc.id}</strong><small>이슈 {doc.issueCount}개 · 문서 r{doc.documentRevision}</small></button></li>)}</ul><div className="issues-pagination">{docHistory.length > 0 && <button type="button" disabled={loading} onClick={() => void loadDocuments(docHistory.at(-1) || undefined, revision || undefined, docHistory.slice(0, -1))}>이전 문서</button>}{docNext && <button type="button" disabled={loading} onClick={() => void loadDocuments(docNext, revision || undefined, [...docHistory, docAfter])}>다음 문서</button>}</div>{documentId && categoryPage && <IssueCategoryNavigation page={categoryPage} path={categoryPath} selected={appliedFilters.categoryId} history={categoryHistory} loading={loading} headingRef={categoryHeading} onAll={() => void changeCategory([], undefined)} onUncategorized={() => void changeCategory([], null)} onParent={() => { const previous = categoryPath.at(-1); if (previous) { const path = categoryPath.slice(0, -1); void changeCategory(path, path.at(-1)?.id, previous.parentOffset, previous.parentHistory); } }} onSelect={item => void changeCategory([...categoryPath, { ...item, parentOffset: categoryOffset, parentHistory: categoryHistory }], item.id)} onPrevious={() => void loadCategoryPage(categoryHistory.at(-1)!, categoryHistory.slice(0, -1))} onNext={() => { if (categoryPage.nextOffset !== null) void loadCategoryPage(categoryPage.nextOffset, [...categoryHistory, categoryOffset]); }} />}</div>
      <div><h3>이슈</h3>{!documentId ? <p>문서를 선택하세요.</p> : <><div className="issues-export"><button type="button" onClick={() => void exportDocument()} disabled={loading}>선택 문서 새 파일로 내보내기</button><p className="issues-view-note">프로젝트 안에 새 Markdown 파일을 만듭니다. 기존 파일은 덮어쓰지 않습니다. 문서의 완료 표시는 로컬 검증 결과가 아닙니다.</p>{exportNotice && <p role="status">{exportNotice}</p>}</div><form className="issues-filters" onSubmit={applyFilters}><label>검색 <input type="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="제목, 설명, 분류, ID" /></label><label>상태 <select value={status} onChange={event => setStatus(event.target.value as IssueViewStatus | "")}><option value="">전체</option><option value="ready">대기</option><option value="retryable">재시도 필요</option><option value="failed">실패</option><option value="needs_review">검토 필요</option></select></label><label>개발 버전 <input value={version} onChange={event => setVersion(event.target.value)} maxLength={1024} pattern="[0-9]+\.[0-9]+\.[0-9]+" title="예: 1.2.0" placeholder="예: 1.2.0" /></label><button type="submit" disabled={loading}>적용</button></form><p className="issues-view-note">선택한 문서에서 검색합니다. 상태는 로컬 상태 기준입니다.</p>{issues.length === 0 ? <p>조건에 맞는 이슈가 없습니다.</p> : <ul className="issues-list">{issues.map(issue => <IssueRow key={issue.id} issue={issue} disabled={loading} onOpen={() => void openDetail(issue)} />)}</ul>}<div className="issues-pagination">{issueHistory.length > 0 && <button type="button" disabled={loading} onClick={() => void loadIssues(documentId, issueHistory.at(-1)!, issueHistory.slice(0, -1))}>이전 이슈</button>}{issueNext !== null && <button type="button" disabled={loading} onClick={() => void loadIssues(documentId, issueNext, [...issueHistory, issueOffset])}>다음 이슈</button>}</div></>}</div></div>}
      {documentId && <div className="issues-diagnostics-action"><button type="button" disabled={loading} onClick={() => void loadDiagnostics()}>선택 문서 연결 점검</button><p className="issues-view-note">저장된 연결, 빈 항목과 같은 문구를 읽기 전용으로 확인합니다.</p></div>}
      {diagnostics && revision && <IssueDiagnostics report={diagnostics} revision={revision} documentId={documentId ?? undefined} offset={diagnosticOffset} history={diagnosticHistory} loading={loading} headingRef={diagnosticHeading} onOpenIssue={(id, button) => void openDetail({ id }, undefined, button)} onOpenRequirement={(id, button) => void openRequirement(id, 0, [], button)} onPrevious={() => void loadDiagnostics(diagnosticHistory.at(-1)!, diagnosticHistory.slice(0, -1))} onNext={() => { if (diagnostics.findings.nextOffset !== null) void loadDiagnostics(diagnostics.findings.nextOffset, [...diagnosticHistory, diagnosticOffset]); }} />}
      {requirementDetail && requirementPage && <RequirementDetailPanel requirement={requirementDetail} page={requirementPage} offset={requirementOffset} history={requirementHistory} loading={loading} headingRef={requirementHeading} onBack={() => { const target = requirementReturn.current; clearDetails(); if (target?.isConnected) target.focus(); else diagnosticHeading.current?.focus(); }} onOpenIssue={(issue, button) => void openDetail(issue, undefined, button, true)} onPrevious={() => void openRequirement(requirementDetail.id, requirementHistory.at(-1)!, requirementHistory.slice(0, -1))} onNext={() => { if (requirementPage.nextOffset !== null) void openRequirement(requirementDetail.id, requirementPage.nextOffset, [...requirementHistory, requirementOffset]); }} />}
      {detail && detailDocumentId && <p className="issues-view-note">이슈 상세 기준 문서: {detailDocumentId} · 이슈 ID: {detail.id}</p>}
      {detail && detailReturnKind && <button type="button" disabled={loading} onClick={() => { const target = diagnosticReturn.current, fromRequirement = detailReturnKind === "requirement"; clearDetails(fromRequirement); if (target?.isConnected) target.focus(); else if (fromRequirement) requirementHeading.current?.focus(); else diagnosticHeading.current?.focus(); }}>{detailReturnKind === "requirement" ? "요구사항 상세로 돌아가기" : "점검 결과로 돌아가기"}</button>}
      {detail && <article className="issues-detail" aria-label="이슈 상세"><div className="issues-detail-heading"><h3 tabIndex={-1} ref={detailHeading}>{detail.title}</h3><span className="issues-status">{STATUS[detail.localStatus]}</span></div><p>{detail.category || "미분류"} · v{detail.version}</p>{detail.importedStatus === "completed" && <p className="issues-view-note">가져온 문서에는 완료로 표시되어 있습니다. 현재 프로젝트에서의 완료는 확인되지 않았습니다.</p>}{(detail.missingCriteria || detail.unverifiedDependencies > 0) && <div className="issues-prerequisites"><strong>실행 전 확인할 사항</strong><ul>{detail.missingCriteria && <li>완료 조건이 없습니다.</li>}{detail.unverifiedDependencies > 0 && <li>선행 이슈 {detail.unverifiedDependencies}개의 로컬 완료가 확인되지 않았습니다.</li>}</ul><p>이슈 실행과 로컬 완료 판정 기능은 준비 중입니다.</p></div>}<h4>설명</h4><p className="issues-prewrap">{detail.description || "설명이 없습니다."}</p><h4>완료 조건 <small>{criteria.length}/{detail.criteriaCount}</small></h4>{criteria.length ? <ul>{criteria.map((criterion, index) => <li key={index} className="issues-prewrap">{criterion}</li>)}</ul> : <p>완료 조건이 없어 검토가 필요합니다.</p>}{criteriaNext !== null && <button type="button" disabled={loading} onClick={() => void more("criteria", criteriaNext)}>완료 조건 더 보기</button>}<h4>연결된 요구사항 <small>{requirements.length}/{detail.requirementCount}</small></h4>{requirements.length ? <ul>{requirements.map(requirement => <li key={requirement.id}><p className="issues-prewrap">{requirement.text}</p><small>{ORIGIN[requirement.origin]}{requirement.sourceName ? ` · ${requirement.sourceName}` : ""}{requirement.locator ? ` · ${requirement.locator}` : ""}</small></li>)}</ul> : <p>연결된 요구사항이 없습니다.</p>}{requirementsNext !== null && <button type="button" disabled={loading} onClick={() => void more("requirements", requirementsNext)}>요구사항 더 보기</button>}<h4>선행 이슈 <small>{dependencies.length}/{detail.dependencyCount}</small></h4>{dependencies.length ? <ul>{dependencies.map(dependency => <li key={dependency.id}><strong>{dependency.title}</strong> · {dependency.id} · {STATUS[dependency.localStatus]}{dependency.importedStatus === "completed" && <small> 문서의 완료 표시는 로컬에서 확인되지 않았습니다.</small>}</li>)}</ul> : <p>선행 이슈가 없습니다.</p>}{dependenciesNext !== null && <button type="button" disabled={loading} onClick={() => void more("dependencies", dependenciesNext)}>선행 이슈 더 보기</button>}</article>}
    </>}
    {error && <div className="issues-notice" role="alert"><p>{error}</p>{authorized && <button type="button" onClick={() => void loadDocuments()} disabled={loading}>목록 다시 불러오기</button>}</div>}
  </section>;
}
