import { useEffect, useRef, useState } from "react";
import type { IssueDocument } from "../../../server/issues/document";
import type { AnalysisCandidate } from "../../../shared/issues/sources";
import { IssueApiError, type DraftState, type IssueApi, type IssueBindingResult } from "./api";
import { addCandidateRequirement } from "./planning-candidate";
import { DraftCategories } from "./DraftCategories";
import { DraftIndependentEditor } from "./DraftIndependentEditor";
import { PlanningConversation } from "./PlanningConversation";

type Props = { api: IssueApi; revision: number; loading: boolean; setLoading: (value: boolean) => void; onRegistered: () => void; onError: (error: unknown) => void; candidate?: AnalysisCandidate | null; onCandidateConsumed?: () => void; onDraftRevision?: (revision: number | null) => void; onDraftReady?: (ready: boolean) => void; externalDraft?: DraftState | null };

export function DraftReviews({ draft, loading, reasons, setReasons, onReview }: { draft: NonNullable<IssueBindingResult["draft"]>; loading: boolean; reasons: Record<string, string>; setReasons: (value: Record<string, string>) => void; onReview: (requirementId: string, issueId: string, decision: "confirmed" | "deferred") => void }) {
  const links = draft.document.issues.flatMap(issue => issue.requirementIds.map(requirementId => ({ issue, requirementId })));
  const linked = new Set(links.map(link => link.requirementId));
  const unlinked = draft.document.requirements.filter(requirement => !linked.has(requirement.id)).length;
  return <section aria-label="초안 연결 검토"><h4>요구사항과 이슈 연결 검토</h4><p>각 연결을 확인하거나 이유와 함께 보류할 수 있습니다. 검토는 초안 저장 버튼을 누를 때 로컬 저장소에 보관되며 이슈 문서 등록에는 포함되지 않습니다. 초안을 수정하면 이전 검토는 현재 결과에서 제외됩니다. 검토는 전체 누락이 없다는 증거가 아닙니다.</p>
    <p>연결 {links.length}개 · 검토 {draft.reviews.length}개 · 연결 없는 요구사항 {unlinked}개 · 연결 없는 이슈 {draft.document.issues.filter(issue => issue.requirementIds.length === 0).length}개</p>
    {links.length ? <ul>{links.map(({ issue, requirementId }) => {
      const key = JSON.stringify([requirementId, issue.id]), item = draft.document.requirements.find(requirement => requirement.id === requirementId), result = draft.reviews.find(review => review.issueId === issue.id && review.requirementId === requirementId);
      return <li key={key}><p>{item?.text ?? requirementId} → {issue.title}</p><p>{result ? `${result.decision === "confirmed" ? "확인" : "보류"}: ${result.reason}` : "아직 검토하지 않았습니다."}</p><label>검토 사유<textarea maxLength={2000} disabled={loading} value={reasons[key] ?? ""} onChange={event => setReasons({ ...reasons, [key]: event.target.value })} /></label><button type="button" disabled={loading || !(reasons[key] ?? "").trim()} onClick={() => onReview(requirementId, issue.id, "confirmed")}>연결 확인</button><button type="button" disabled={loading || !(reasons[key] ?? "").trim()} onClick={() => onReview(requirementId, issue.id, "deferred")}>검토 보류</button></li>;
    })}</ul> : <p>검토할 연결이 없습니다.</p>}
    {draft.history.length > 0 && <details><summary>이전 검토 기록 {draft.history.length}개</summary><p>이 기록은 현재 검토 결과에 포함되지 않습니다. 초안의 내용이나 연결이 바뀐 뒤에는 다시 확인해야 합니다.</p><ul>{draft.history.map((entry, index) => <li key={`${entry.revision}:${entry.review.requirementId}:${entry.review.issueId}:${index}`}><p>초안 r{entry.revision} · {entry.revision === draft.revision ? "이전 결정" : "오래된 검토"} · {entry.review.requirementId} → {entry.review.issueId}</p><p>{entry.review.decision === "confirmed" ? "확인" : "보류"}: {entry.review.reason}</p></li>)}</ul></details>}
  </section>;
}

export function SemanticReviews({ draft, loading, reasons, setReasons, onReview }: { draft: DraftState; loading: boolean; reasons: Record<string, string>; setReasons: (value: Record<string, string>) => void; onReview: (findingId: string, decision: "resolved" | "deferred") => void }) {
  const records = draft.validations ?? [];
  return <section aria-label="기록된 의미 검증"><h4>기록된 의미 검증</h4><p>각 결과는 선택된 한 구간만 검토한 제안입니다. 저장된 사유는 내용이나 구현의 완전성을 증명하지 않습니다. 초안을 변경하면 이전 결과는 오래된 검증으로 표시됩니다.</p>{records.length ? records.map((record, index) => {
    const stale = record.result.draftRevision !== draft.revision || record.result.projectRevision !== draft.projectRevision;
    return <article key={`${record.result.snapshotId}:${record.segmentIndex}:${index}`}><h5>구간 {record.segmentIndex + 1} · 초안 r{record.result.draftRevision} · {stale ? "오래된 검증" : "초안 revision 기준"}</h5><p>자료: {record.result.sourcePath} · 원본 최신성은 검토 사유 기록 시 다시 확인합니다.</p>{record.result.findings.length ? <ul>{record.result.findings.map(finding => {
      const history = record.decisions.filter(item => item.findingId === finding.id), latest = history.at(-1);
      return <li key={finding.id}><p>{finding.summary}</p><p>확인 필요: {finding.uncertainty}</p>{finding.evidence && <p>자료 인용: {finding.evidence.quote} · 위치 {finding.evidence.start}–{finding.evidence.end}</p>}<p>{latest ? `${latest.status === "resolved" ? "해결" : "보류"}: ${latest.reason}` : "검토 전"}</p>{history.length > 1 && <details><summary>이전 사유 {history.length - 1}개</summary><ul>{history.slice(0, -1).map((item, i) => <li key={i}>{item.status === "resolved" ? "해결" : "보류"}: {item.reason}</li>)}</ul></details>}<label>의미 검증 사유<textarea maxLength={2000} disabled={loading || stale} value={reasons[finding.id] ?? ""} onChange={event => setReasons({ ...reasons, [finding.id]: event.target.value })} /></label><button type="button" disabled={loading || stale || !(reasons[finding.id] ?? "").trim()} onClick={() => onReview(finding.id, "resolved")}>해결 기록</button><button type="button" disabled={loading || stale || !(reasons[finding.id] ?? "").trim()} onClick={() => onReview(finding.id, "deferred")}>보류 기록</button></li>;
    })}</ul> : <p>제안된 항목이 없습니다. 누락이 없다는 뜻은 아닙니다.</p>}</article>;
  }) : <p>초안에 기록된 의미 검증이 없습니다.</p>}<p>검토 사유를 재시작 후에도 보관하려면 초안과 검토 이력 저장을 누르세요.</p></section>;
}

export function PlanningEditor({ api, revision, loading, setLoading, onRegistered, onError, candidate, onCandidateConsumed, onDraftRevision, onDraftReady, externalDraft }: Props) {
  const [draft, setDraft] = useState<NonNullable<IssueBindingResult["draft"]> | null>(null);
  const [requirement, setRequirement] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<AnalysisCandidate | null>(null);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [semanticReasons, setSemanticReasons] = useState<Record<string, string>>({});
  const [categoryPending, setCategoryPending] = useState(false);
  const [independentPending, setIndependentPending] = useState(false);
  const [planPending, setPlanPending] = useState(false);
  const [planRunning, setPlanRunning] = useState(false);
  const [savedPreview, setSavedPreview] = useState<{ draft: NonNullable<IssueBindingResult["draft"]>; stale: boolean } | null>(null);
  useEffect(() => { onDraftRevision?.(draft?.revision ?? null); return () => onDraftRevision?.(null); }, [draft?.revision, onDraftRevision]);
  useEffect(() => { if (externalDraft) setDraft(previous => previous && previous.revision === externalDraft.revision && previous.projectRevision === externalDraft.projectRevision && previous.document.documentId === externalDraft.document.documentId ? externalDraft : previous); }, [externalDraft]);
  const pendingInput = Boolean(candidate || activeCandidate || requirement.trim() || title.trim() || description.trim() || criteria.trim());
  const pendingReviewInput = Object.values(reviewReasons).some(value => value.trim()) || Object.values(semanticReasons).some(value => value.trim());
  const staleDraft = Boolean(draft && draft.projectRevision !== revision);
  const draftReady = Boolean(draft && !staleDraft && !pendingInput && editing === null && !categoryPending && !independentPending && !planPending && !planRunning);
  useEffect(() => { onDraftReady?.(draftReady); return () => onDraftReady?.(false); }, [draftReady, onDraftReady]);
  const candidateHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (candidate) candidateHeading.current?.focus(); }, [candidate]);
  const restore = async () => {
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftRead");
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "초안을 확인하지 못했습니다.");
      setDraft(result.draft); setReviewReasons({}); setNotice("이 연결의 초안을 불러왔습니다.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const restoreSaved = async () => {
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftRestore");
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "저장된 초안을 확인하지 못했습니다.");
      setDraft(result.draft); setSavedPreview(null); setReviewReasons({}); setNotice("로컬 저장소에서 초안을 불러왔습니다.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const persist = async () => {
    if (!draft) return;
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftPersist", { draftRevision: draft.revision });
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "저장된 초안을 확인하지 못했습니다.");
      setDraft(result.draft); setNotice("초안과 검토 이력을 로컬 저장소에 저장했습니다.");
    } catch (error) {
      if (error instanceof IssueApiError && error.code === "VERSION_CONFLICT") setNotice("저장된 초안 또는 프로젝트가 변경되어 저장하지 않았습니다. 현재 입력은 이 연결에 남아 있습니다.");
      else onError(error);
    } finally { setLoading(false); }
  };
  const inspectSaved = async () => {
    setLoading(true); setNotice(""); setSavedPreview(null);
    try {
      const result = await api.request("draftInspectSaved");
      if (!result.draft || typeof result.savedStale !== "boolean") throw new IssueApiError("INVALID_RESPONSE", "저장된 초안을 확인하지 못했습니다.");
      setSavedPreview({ draft: result.draft, stale: result.savedStale });
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const rebaseSaved = async () => {
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftRebase");
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "초안을 확인하지 못했습니다.");
      setDraft(result.draft); setSavedPreview(null); setReviewReasons({}); setNotice("이전 초안을 현재 프로젝트 revision의 편집본으로 복사했습니다. 모든 이전 검토는 다시 확인해야 합니다. 저장 버튼을 누르기 전까지 보관된 원본은 바뀌지 않습니다.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const copySaved = async () => {
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftCopy");
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "복사한 초안을 확인하지 못했습니다.");
      setDraft(result.draft); setSavedPreview(null); setReviewReasons({}); setNotice("새 식별자로 초안을 복사했습니다. 이전 검토는 현재 검토가 아니며 자료와 연결을 다시 확인해야 합니다. 보관된 초안은 저장 버튼을 누르기 전까지 바뀌지 않습니다.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const add = async () => {
    if (!requirement.trim() || !title.trim() || !description.trim() || !criteria.trim() || !/^\d+\.\d+\.\d+$/.test(version)) return;
    const criteriaItems = criteria.split("\n").map(item => item.trim()).filter(Boolean);
    const reqId = `req_${crypto.randomUUID()}`, issueId = `issue_${crypto.randomUUID()}`;
    const document: IssueDocument = draft ? structuredClone(draft.document) : { format: "auto-codex-issues", formatVersion: 1, documentId: `doc_${crypto.randomUUID()}`, revision: 1, sources: [], categories: [], requirements: [], issues: [] };
    if (editing === null) {
      try {
        if (activeCandidate) addCandidateRequirement(document, activeCandidate, reqId, requirement.trim());
        else document.requirements.push({ id: reqId, categoryId: null, text: requirement.trim(), origin: "user" });
      } catch (error) { setNotice(error instanceof Error ? error.message : "후보를 추가하지 못했습니다."); return; }
      document.issues.push({ id: issueId, categoryId: null, requirementIds: [reqId], version, order: document.issues.length, title: title.trim(), description: description.trim(), acceptanceCriteria: criteriaItems, dependencyIds: [], status: "ready" });
    } else {
      const issue = document.issues[editing], requirementItem = document.requirements.find(item => item.id === issue?.requirementIds[0]);
      if (!issue || !requirementItem) return;
      requirementItem.text = requirement.trim(); issue.title = title.trim(); issue.description = description.trim(); issue.acceptanceCriteria = criteriaItems; issue.version = version;
    }
    if (new TextEncoder().encode(JSON.stringify(document)).length > 14_000) {
      setNotice("초안 요청 크기 한도에 도달했습니다. 이 초안을 등록한 뒤 새 초안을 만드세요."); return;
    }
    setLoading(true); setNotice("");
    try {
      const result = draft ? await api.request("draftReplace", { draftRevision: draft.revision, document }) : await api.request("draftCreate", { expectedRevision: revision, document });
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "초안을 확인하지 못했습니다.");
      setDraft(result.draft); setSavedPreview(null); setReviewReasons({}); setRequirement(""); setTitle(""); setDescription(""); setCriteria(""); setEditing(null); setActiveCandidate(null); setNotice("초안을 저장했습니다. 아직 등록되지 않았습니다.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const register = async () => {
    if (!draft) return;
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftRegister", { draftRevision: draft.revision });
      if (result.cancelled) { setNotice("등록을 취소했습니다. 초안은 유지됩니다."); setLoading(false); return; }
      setDraft(null); setCategoryPending(false); setIndependentPending(false); setNotice(`이슈 ${result.issueCount}개를 등록했습니다.`); setLoading(false); onRegistered();
    } catch (error) { onError(error); setLoading(false); }
  };
  const review = async (requirementId: string, issueId: string, decision: "confirmed" | "deferred") => {
    if (!draft) return;
    const key = JSON.stringify([requirementId, issueId]), reason = (reviewReasons[key] ?? "").trim();
    if (!reason) return;
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftReview", { draftRevision: draft.revision, review: { requirementId, issueId, decision, reason } });
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "검토 결과를 확인하지 못했습니다.");
      setDraft(result.draft); setReviewReasons(previous => ({ ...previous, [key]: "" })); setNotice("링크 검토를 초안에 기록했습니다.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const saveCategories = async (document: IssueDocument): Promise<boolean> => {
    if (!draft || new TextEncoder().encode(JSON.stringify(document)).length > 14_000) { setNotice("초안 요청 크기 한도에 도달했습니다."); return false; }
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftReplace", { draftRevision: draft.revision, document });
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "초안을 확인하지 못했습니다.");
      setDraft(result.draft); setReviewReasons({}); setNotice("초안 변경을 저장했습니다. 연결 검토를 다시 확인하세요."); return true;
    } catch (error) { onError(error); return false; } finally { setLoading(false); }
  };
  const reviewSemantic = async (findingId: string, decision: "resolved" | "deferred") => {
    if (!draft) return;
    const reason = (semanticReasons[findingId] ?? "").trim(); if (!reason) return;
    setLoading(true); setNotice("");
    try {
      const result = await api.request("semanticReview", { draftRevision: draft.revision, findingId, decision, reason });
      if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "검토 결과를 확인하지 못했습니다.");
      setDraft(result.draft); setSemanticReasons(previous => ({ ...previous, [findingId]: "" })); setNotice("의미 검증 사유를 초안에 기록했습니다. 영속 저장은 별도 버튼을 누르세요.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  return <section className="issues-planning" aria-label="이슈 초안">
    <h3>이슈 초안</h3>
    <p>요구사항을 직접 입력하거나 분석 후보를 가져와 이슈와 함께 검토합니다. 작성 중인 초안은 연결 메모리에 있으며, 별도 저장 버튼을 누르면 로컬 저장소에 보관됩니다. 프로젝트가 바뀌면 저장된 이전 초안은 자동 적용되지 않습니다. 등록 시 출처 자료를 다시 비교합니다. 초안 한 건에는 요청 크기 제한이 있습니다.</p>
    <button type="button" disabled={loading || pendingInput || editing !== null || categoryPending || independentPending || pendingReviewInput || planPending || planRunning} onClick={() => void restore()}>기존 초안 확인</button>
    <button type="button" disabled={loading || Boolean(draft) || pendingInput || editing !== null || categoryPending || independentPending} onClick={() => void restoreSaved()}>저장된 초안 불러오기</button>
    <button type="button" disabled={loading || Boolean(draft) || pendingInput || editing !== null || categoryPending || independentPending} onClick={() => void inspectSaved()}>저장된 초안 미리보기</button>
    {savedPreview && <section aria-label="저장된 초안 미리보기"><h4>저장된 초안 미리보기</h4><p>저장 당시 프로젝트 r{savedPreview.draft.projectRevision} · 초안 r{savedPreview.draft.revision} · 현재 프로젝트 r{revision} · {savedPreview.stale ? "프로젝트 변경 후의 이전 초안" : "현재 프로젝트 revision과 일치"}</p><p>현재 프로젝트 내용과 의미를 자동 비교하지 않았습니다. 이전 초안의 자료와 연결·완료 조건을 직접 확인하세요. 편집본을 저장하면 이 보관 초안을 교체합니다. 이미 등록된 문서라면 재등록 시 식별자 충돌이 발생할 수 있습니다.</p><h5>요구사항</h5>{savedPreview.draft.document.requirements.length ? <ul>{savedPreview.draft.document.requirements.map(item => <li key={item.id}>{item.text} · {item.id}</li>)}</ul> : <p>요구사항 없음</p>}<h5>이슈</h5>{savedPreview.draft.document.issues.length ? <ul>{savedPreview.draft.document.issues.map(item => <li key={item.id}>{item.title} · {item.id} · v{item.version}</li>)}</ul> : <p>이슈 없음</p>}<p>현재 검토 {savedPreview.draft.reviews.length}개 · 이전 검토 {savedPreview.draft.history.length}개</p>{savedPreview.stale && <button type="button" disabled={loading || Boolean(draft) || pendingInput || categoryPending || independentPending} onClick={() => void rebaseSaved()}>이전 초안을 현재 프로젝트에서 검토</button>}<button type="button" disabled={loading || Boolean(draft) || pendingInput || categoryPending || independentPending} onClick={() => void copySaved()}>새 문서로 복사</button><button type="button" disabled={loading} onClick={() => setSavedPreview(null)}>미리보기 닫기</button></section>}
    {staleDraft && <div role="alert"><p>프로젝트가 변경되어 이 연결의 초안은 읽기 전용입니다. 내용은 연결이 유지되는 동안 메모리에 남지만, 저장하거나 등록할 수 없습니다. 연결을 종료하면 저장되지 않은 내용은 사라집니다.</p><p>현재 프로젝트의 검토본으로 전환하면 이전 검토와 의미 검증은 오래된 기록이 됩니다. 자료와 내용은 직접 다시 확인해야 하며 로컬 저장소는 자동으로 바뀌지 않습니다.</p><button type="button" disabled={loading || pendingInput || pendingReviewInput || categoryPending || independentPending || planPending || planRunning} onClick={() => void rebaseSaved()}>이 연결의 초안을 현재 프로젝트에서 검토</button></div>}
    <fieldset disabled={staleDraft}><legend>현재 초안 내용</legend>
    {candidate && <div><h4 ref={candidateHeading} tabIndex={-1}>선택한 분석 후보</h4><p>{candidate.text}</p>{candidate.uncertainty && <p>확인 필요: {candidate.uncertainty}</p>}{candidate.evidence && <p>선택 당시 자료: {candidate.evidence.sourcePath} · 인용: {candidate.evidence.quote}</p>}<p>불러오면 현재 입력한 요구사항이 바뀝니다. 원문이 이후 변경됐는지는 별도로 확인해야 합니다.</p><button type="button" disabled={loading || editing !== null || categoryPending || independentPending || pendingReviewInput || planPending || planRunning} onClick={() => { setRequirement(candidate.text); setActiveCandidate(candidate); onCandidateConsumed?.(); }}>후보를 입력에 불러오기</button><button type="button" disabled={loading} onClick={onCandidateConsumed}>후보 선택 취소</button></div>}
    {candidate && editing !== null && <p>현재 수정 중인 초안을 저장하거나 취소한 뒤 후보를 불러오세요.</p>}
    {activeCandidate && <p role="status">AI 후보를 편집 중입니다. 변경해도 AI 제안으로 기록되며 출처와 불확실성은 선택 당시 정보입니다.</p>}
    <fieldset disabled={independentPending || pendingReviewInput || planPending || planRunning}><legend>요구사항과 이슈 함께 작성</legend>
    <label>요구사항<textarea value={requirement} maxLength={2000} disabled={loading} onChange={event => setRequirement(event.target.value)} /></label>
    <label>이슈 제목<input value={title} maxLength={255} disabled={loading} onChange={event => setTitle(event.target.value)} /></label>
    <label>작업 설명<textarea value={description} maxLength={2000} disabled={loading} onChange={event => setDescription(event.target.value)} /></label>
    <label>개발 버전 <input value={version} maxLength={50} disabled={loading} onChange={event => setVersion(event.target.value)} aria-describedby="draft-version-help" /></label><small id="draft-version-help">숫자 세 개를 점으로 구분합니다. 예: 1.0.0</small>
    <label>완료 조건 (한 줄에 하나씩)<textarea value={criteria} maxLength={2000} disabled={loading} onChange={event => setCriteria(event.target.value)} /></label>
    <button type="button" disabled={loading || !requirement.trim() || !title.trim() || !description.trim() || !criteria.trim() || !/^\d+\.\d+\.\d+$/.test(version)} onClick={() => void add()}>{editing === null ? "초안에 추가" : "수정 저장"}</button>
    {editing !== null && <button type="button" disabled={loading} onClick={() => { setEditing(null); setRequirement(""); setTitle(""); setDescription(""); setCriteria(""); }}>수정 취소</button>}
    {editing === null && pendingInput && <button type="button" disabled={loading} onClick={() => { setRequirement(""); setTitle(""); setDescription(""); setCriteria(""); setActiveCandidate(null); onCandidateConsumed?.(); }}>작성 중인 입력 지우기</button>}
    </fieldset>
    {draft && <><p>프로젝트 r{revision} · 초안 r{draft.revision} · {draft.document.issues.length}개 이슈</p><ul>{draft.document.issues.map((issue, index) => <li key={issue.id}><strong>{issue.title} · v{issue.version}</strong>{issue.requirementIds.map(id => { const item = draft.document.requirements.find(requirementItem => requirementItem.id === id); return item ? <div key={id}><p>요구사항: {item.text}</p><small>{item.origin === "ai-proposal" ? "AI 제안 · 검토 필요" : item.origin === "source" ? "문서 출처 · 검토 필요" : "사용자 입력"}{item.locator ? ` · ${item.locator}` : ""}</small></div> : null; })}<p>{issue.description}</p><p>완료 조건: {issue.acceptanceCriteria.join(", ")}</p>{issue.requirementIds.length === 0 && <p>수정하려면 먼저 요구사항을 연결하세요.</p>}{issue.requirementIds.length > 1 && <p>수정 양식은 첫 번째 요구사항을 편집합니다. 다른 이슈에서도 이 요구사항을 사용하면 함께 바뀝니다.</p>}<button type="button" disabled={loading || independentPending || categoryPending || pendingReviewInput || planPending || planRunning || issue.requirementIds.length === 0} onClick={() => { setActiveCandidate(null); setEditing(index); setRequirement(draft.document.requirements.find(item => item.id === issue.requirementIds[0])?.text ?? ""); setTitle(issue.title); setDescription(issue.description); setCriteria(issue.acceptanceCriteria.join("\n")); setVersion(issue.version); }}>수정</button></li>)}</ul><button type="button" disabled={loading || editing !== null || pendingInput || categoryPending || independentPending || pendingReviewInput || planPending || planRunning} onClick={() => void register()}>초안 등록</button></>}
    {draft && (pendingInput || categoryPending || independentPending || pendingReviewInput || planPending || planRunning) && <p>작성 중인 입력과 검토 사유를 기록하거나 지우고 실행 중인 제안이 끝난 뒤 등록하세요.</p>}
    {draft && <button type="button" disabled={loading || editing !== null || pendingInput || categoryPending || independentPending || pendingReviewInput || planPending || planRunning} onClick={() => void persist()}>초안과 검토 이력 저장</button>}
    {draft && <PlanningConversation api={api} draft={draft} disabled={loading || editing !== null || pendingInput || categoryPending || independentPending || pendingReviewInput} setLoading={setLoading} onDraft={setDraft} onPending={setPlanPending} onRunning={setPlanRunning} onError={onError} />}
    {draft && <DraftIndependentEditor document={draft.document} disabled={loading || editing !== null || pendingInput || categoryPending || pendingReviewInput || planPending || planRunning} onSave={saveCategories} onPendingChange={setIndependentPending} />}
    {draft && <DraftCategories document={draft.document} disabled={loading || editing !== null || pendingInput || independentPending || pendingReviewInput || planPending || planRunning} onSave={saveCategories} onPendingChange={setCategoryPending} />}
    {draft && <DraftReviews draft={draft} loading={loading || editing !== null || independentPending || categoryPending || planPending || planRunning} reasons={reviewReasons} setReasons={setReviewReasons} onReview={(requirementId, issueId, decision) => void review(requirementId, issueId, decision)} />}
    {draft && <SemanticReviews draft={draft} loading={loading || editing !== null || independentPending || categoryPending || planPending || planRunning} reasons={semanticReasons} setReasons={setSemanticReasons} onReview={(findingId, decision) => void reviewSemantic(findingId, decision)} />}
    </fieldset>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
