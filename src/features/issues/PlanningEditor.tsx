import { useEffect, useRef, useState } from "react";
import type { IssueDocument } from "../../../server/issues/document";
import type { AnalysisCandidate } from "../../../shared/issues/sources";
import { IssueApiError, type IssueApi, type IssueBindingResult } from "./api";
import { addCandidateRequirement } from "./planning-candidate";

type Props = { api: IssueApi; revision: number; loading: boolean; setLoading: (value: boolean) => void; onRegistered: () => void; onError: (error: unknown) => void; candidate?: AnalysisCandidate | null; onCandidateConsumed?: () => void };

export function DraftReviews({ draft, loading, reasons, setReasons, onReview }: { draft: NonNullable<IssueBindingResult["draft"]>; loading: boolean; reasons: Record<string, string>; setReasons: (value: Record<string, string>) => void; onReview: (requirementId: string, issueId: string, decision: "confirmed" | "deferred") => void }) {
  const links = draft.document.issues.flatMap(issue => issue.requirementIds.map(requirementId => ({ issue, requirementId })));
  const linked = new Set(links.map(link => link.requirementId));
  const unlinked = draft.document.requirements.filter(requirement => !linked.has(requirement.id)).length;
  return <section aria-label="초안 연결 검토"><h4>요구사항과 이슈 연결 검토</h4><p>각 연결을 확인하거나 이유와 함께 보류할 수 있습니다. 이 기록은 초안 메모리에만 남으며 등록 시 저장되지 않습니다. 초안을 수정하면 이전 검토는 현재 결과에서 제외됩니다. 검토는 전체 누락이 없다는 증거가 아닙니다.</p>
    <p>연결 {links.length}개 · 검토 {draft.reviews.length}개 · 연결 없는 요구사항 {unlinked}개 · 연결 없는 이슈 {draft.document.issues.filter(issue => issue.requirementIds.length === 0).length}개</p>
    {links.length ? <ul>{links.map(({ issue, requirementId }) => {
      const key = JSON.stringify([requirementId, issue.id]), item = draft.document.requirements.find(requirement => requirement.id === requirementId), result = draft.reviews.find(review => review.issueId === issue.id && review.requirementId === requirementId);
      return <li key={key}><p>{item?.text ?? requirementId} → {issue.title}</p><p>{result ? `${result.decision === "confirmed" ? "확인" : "보류"}: ${result.reason}` : "아직 검토하지 않았습니다."}</p><label>검토 사유<textarea maxLength={2000} disabled={loading} value={reasons[key] ?? ""} onChange={event => setReasons({ ...reasons, [key]: event.target.value })} /></label><button type="button" disabled={loading || !(reasons[key] ?? "").trim()} onClick={() => onReview(requirementId, issue.id, "confirmed")}>연결 확인</button><button type="button" disabled={loading || !(reasons[key] ?? "").trim()} onClick={() => onReview(requirementId, issue.id, "deferred")}>검토 보류</button></li>;
    })}</ul> : <p>검토할 연결이 없습니다.</p>}
  </section>;
}

export function PlanningEditor({ api, revision, loading, setLoading, onRegistered, onError, candidate, onCandidateConsumed }: Props) {
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
  const pendingInput = Boolean(candidate || activeCandidate || requirement.trim() || title.trim() || description.trim() || criteria.trim());
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
      setDraft(result.draft); setReviewReasons({}); setRequirement(""); setTitle(""); setDescription(""); setCriteria(""); setEditing(null); setActiveCandidate(null); setNotice("초안을 저장했습니다. 아직 등록되지 않았습니다.");
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  const register = async () => {
    if (!draft) return;
    setLoading(true); setNotice("");
    try {
      const result = await api.request("draftRegister", { draftRevision: draft.revision });
      if (result.cancelled) { setNotice("등록을 취소했습니다. 초안은 유지됩니다."); setLoading(false); return; }
      setDraft(null); setNotice(`이슈 ${result.issueCount}개를 등록했습니다.`); setLoading(false); onRegistered();
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
  return <section className="issues-planning" aria-label="이슈 초안">
    <h3>이슈 초안</h3>
    <p>요구사항을 직접 입력하거나 분석 후보를 가져와 이슈와 함께 검토합니다. 초안은 이 연결의 메모리에 보관되고 보기 권한이 끝나면 사라집니다. 등록은 별도 버튼으로 실행합니다. 초안 한 건에는 요청 크기 제한이 있습니다.</p>
    <button type="button" disabled={loading || pendingInput || editing !== null} onClick={() => void restore()}>기존 초안 확인</button>
    {candidate && <div><h4 ref={candidateHeading} tabIndex={-1}>선택한 분석 후보</h4><p>{candidate.text}</p>{candidate.uncertainty && <p>확인 필요: {candidate.uncertainty}</p>}{candidate.evidence && <p>선택 당시 자료: {candidate.evidence.sourcePath} · 인용: {candidate.evidence.quote}</p>}<p>불러오면 현재 입력한 요구사항이 바뀝니다. 원문이 이후 변경됐는지는 별도로 확인해야 합니다.</p><button type="button" disabled={loading || editing !== null} onClick={() => { setRequirement(candidate.text); setActiveCandidate(candidate); onCandidateConsumed?.(); }}>후보를 입력에 불러오기</button><button type="button" disabled={loading} onClick={onCandidateConsumed}>후보 선택 취소</button></div>}
    {candidate && editing !== null && <p>현재 수정 중인 초안을 저장하거나 취소한 뒤 후보를 불러오세요.</p>}
    {activeCandidate && <p role="status">AI 후보를 편집 중입니다. 변경해도 AI 제안으로 기록되며 출처와 불확실성은 선택 당시 정보입니다.</p>}
    <label>요구사항<textarea value={requirement} maxLength={2000} disabled={loading} onChange={event => setRequirement(event.target.value)} /></label>
    <label>이슈 제목<input value={title} maxLength={255} disabled={loading} onChange={event => setTitle(event.target.value)} /></label>
    <label>작업 설명<textarea value={description} maxLength={2000} disabled={loading} onChange={event => setDescription(event.target.value)} /></label>
    <label>개발 버전 <input value={version} maxLength={50} disabled={loading} onChange={event => setVersion(event.target.value)} aria-describedby="draft-version-help" /></label><small id="draft-version-help">숫자 세 개를 점으로 구분합니다. 예: 1.0.0</small>
    <label>완료 조건 (한 줄에 하나씩)<textarea value={criteria} maxLength={2000} disabled={loading} onChange={event => setCriteria(event.target.value)} /></label>
    <button type="button" disabled={loading || !requirement.trim() || !title.trim() || !description.trim() || !criteria.trim() || !/^\d+\.\d+\.\d+$/.test(version)} onClick={() => void add()}>{editing === null ? "초안에 추가" : "수정 저장"}</button>
    {editing !== null && <button type="button" disabled={loading} onClick={() => { setEditing(null); setRequirement(""); setTitle(""); setDescription(""); setCriteria(""); }}>수정 취소</button>}
    {editing === null && pendingInput && <button type="button" disabled={loading} onClick={() => { setRequirement(""); setTitle(""); setDescription(""); setCriteria(""); setActiveCandidate(null); onCandidateConsumed?.(); }}>작성 중인 입력 지우기</button>}
    {draft && <><p>프로젝트 r{revision} · 초안 r{draft.revision} · {draft.document.issues.length}개 이슈</p><ul>{draft.document.issues.map((issue, index) => <li key={issue.id}><strong>{issue.title} · v{issue.version}</strong>{issue.requirementIds.map(id => { const item = draft.document.requirements.find(requirementItem => requirementItem.id === id); return item ? <div key={id}><p>요구사항: {item.text}</p><small>{item.origin === "ai-proposal" ? "AI 제안 · 검토 필요" : item.origin === "source" ? "문서 출처 · 검토 필요" : "사용자 입력"}{item.locator ? ` · ${item.locator}` : ""}</small></div> : null; })}<p>{issue.description}</p><p>완료 조건: {issue.acceptanceCriteria.join(", ")}</p><button type="button" disabled={loading} onClick={() => { setActiveCandidate(null); setEditing(index); setRequirement(draft.document.requirements.find(item => item.id === issue.requirementIds[0])?.text ?? ""); setTitle(issue.title); setDescription(issue.description); setCriteria(issue.acceptanceCriteria.join("\n")); setVersion(issue.version); }}>수정</button></li>)}</ul><button type="button" disabled={loading || editing !== null || pendingInput} onClick={() => void register()}>초안 등록</button></>}
    {draft && pendingInput && <p>작성 중인 입력을 초안에 저장하거나 지운 뒤 등록하세요.</p>}
    {draft && <DraftReviews draft={draft} loading={loading || editing !== null} reasons={reviewReasons} setReasons={setReviewReasons} onReview={(requirementId, issueId, decision) => void review(requirementId, issueId, decision)} />}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
