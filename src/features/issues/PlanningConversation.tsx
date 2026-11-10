import { useEffect, useRef, useState } from "react";
import { IssueApiError, type DraftState, type IssueApi, type PlanStatus } from "./api";
import { ISSUE_PLANNING_MODEL_PATHS_VERIFIED } from "../../../shared/issues/feature-gates";

type Props = { api: IssueApi; draft: DraftState; disabled: boolean; setLoading: (value: boolean) => void; onDraft: (draft: DraftState) => void; onPending: (pending: boolean) => void; onRunning: (running: boolean) => void; onError: (error: unknown) => void };

/** A proposal is displayed for explicit selection; it cannot approve tools. */
export function PlanningConversation({ api, draft, disabled, setLoading, onDraft, onPending, onRunning, onError }: Props) {
  const [request, setRequest] = useState("");
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [error, setError] = useState("");
  const [interrupting, setInterrupting] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onPending(false); onRunning(false); }; }, [onPending, onRunning]);
  const fail = (caught: unknown) => { if (!alive.current) return; if (caught instanceof IssueApiError && caught.code === "VIEW_AUTH_REQUIRED") onError(caught); else setError(caught instanceof Error ? caught.message : "계획 제안을 확인하지 못했습니다."); };
  const refreshDraft = async () => { const result = await api.request("draftRead"); if (alive.current && result.draft) onDraft(result.draft); };
  const start = async () => {
    if (disabled || !request.trim() || status && status.state !== "idle") return;
    setLoading(true); setError("");
    try { const result = await api.request("planStart", { draftRevision: draft.revision, request }); if (!result.planStatus) throw new Error("제안 상태를 확인하지 못했습니다."); if (alive.current) { setStatus(result.planStatus); onRunning(result.planStatus.state === "running"); setRequest(""); onPending(false); } await refreshDraft(); }
    catch (caught) { fail(caught); } finally { if (alive.current) setLoading(false); }
  };
  const check = async () => {
    setLoading(true); setError("");
    try { const result = await api.request("planStatus"); if (!result.planStatus) throw new Error("제안 상태를 확인하지 못했습니다."); if (alive.current) { setStatus(result.planStatus); onRunning(result.planStatus.state === "running" || result.planStatus.state === "termination-unconfirmed"); } await refreshDraft(); }
    catch (caught) { fail(caught); } finally { if (alive.current) setLoading(false); }
  };
  const stop = async () => {
    if (interrupting) return; setInterrupting(true); setError("");
    try { const result = await api.request("planInterrupt"); if (alive.current && result.planStatus) { setStatus(result.planStatus); onRunning(true); } } catch (caught) { fail(caught); } finally { if (alive.current) setInterrupting(false); }
  };
  const clear = async () => {
    setLoading(true); setError("");
    try { const result = await api.request("planClear"); if (alive.current && result.planStatus) { setStatus(result.planStatus); onRunning(false); } } catch (caught) { fail(caught); } finally { if (alive.current) setLoading(false); }
  };
  const apply = async (proposalId: string) => {
    if (disabled) return; setLoading(true); setError("");
    try { const result = await api.request("planApply", { draftRevision: draft.revision, proposalId }); if (!result.draft) throw new Error("적용된 초안을 확인하지 못했습니다."); if (alive.current) { onDraft(result.draft); setStatus(null); onRunning(false); } }
    catch (caught) { fail(caught); } finally { if (alive.current) setLoading(false); }
  };
  const labels = { idle: "대기", running: "제안 생성 중", complete: "검토 대기", failed: "실패", interrupted: "중단됨", stale: "초안 변경됨", "termination-unconfirmed": "종료 확인 불가" } as const;
  return <section aria-label="계획 대화와 제안"><h4>계획 대화와 제안</h4><p>요청과 현재 초안의 요구사항·이슈 텍스트가 모델 제공자에게 전송됩니다. Codex에 설정된 전역 지침도 함께 전송될 수 있습니다. 결과는 제안이며 선택하기 전에는 초안에 적용되지 않습니다. 프로젝트의 코드나 도구 실행 권한은 요청하지 않습니다.</p>
    <label>초안 변경 요청<textarea maxLength={1024} disabled={!ISSUE_PLANNING_MODEL_PATHS_VERIFIED || disabled || status?.state === "running" || status?.state === "termination-unconfirmed"} value={request} onChange={event => { setRequest(event.target.value); onPending(Boolean(event.target.value.trim())); }} /></label>
    {!ISSUE_PLANNING_MODEL_PATHS_VERIFIED && <p>이 제안 실행 경로는 안전 검증 후 사용할 수 있습니다.</p>}
    <button type="button" disabled={!ISSUE_PLANNING_MODEL_PATHS_VERIFIED || disabled || !request.trim() || Boolean(status && status.state !== "idle")} onClick={() => void start()}>변경 제안 요청</button><button type="button" disabled={disabled} onClick={() => void check()}>제안 상태 확인</button>
    {status && <div role="status"><p>상태: {labels[status.state]}</p>{status.state === "running" ? <button type="button" disabled={interrupting} onClick={() => void stop()}>제안 중단</button> : status.state !== "idle" && <button type="button" disabled={disabled || status.state === "termination-unconfirmed"} onClick={() => void clear()}>제안 정리</button>}{status.result && status.result.revision === draft.revision && status.result.projectRevision === draft.projectRevision && (status.result.proposals.length ? <ul>{status.result.proposals.map(item => <li key={item.id}><p>{item.target} · {item.targetId} · {item.field}</p><p>현재: {item.before || "(비어 있음)"}</p><p>제안: {item.after}</p><p>이유: {item.reason} · 확인 필요: {item.uncertainty}</p><button type="button" disabled={disabled} onClick={() => void apply(item.id)}>이 제안 적용</button></li>)}</ul> : <p>변경 제안이 없습니다. 초안이 완전하다는 뜻은 아닙니다.</p>)}</div>}
    {status?.result && (status.result.revision !== draft.revision || status.result.projectRevision !== draft.projectRevision) && <p role="status">초안이 바뀌어 이전 제안을 적용할 수 없습니다. 제안을 정리한 뒤 다시 요청하세요.</p>}
    {error && <p role="alert">{error}</p>}
    <h5>계획 대화 기록</h5>{draft.conversation?.length ? <ol>{draft.conversation.map((item, index) => <li key={`${item.revision}:${index}`}><small>{item.role === "user" ? "사용자" : "모델 제안"} · 초안 r{item.revision}{item.revision !== draft.revision ? " · 이전 revision" : ""}</small><p className="issues-prewrap">{item.text}</p></li>)}</ol> : <p>기록된 대화가 없습니다.</p>}<p>대화와 제안 이력은 초안 저장 버튼을 누를 때 로컬 저장소에 보관됩니다.</p>
  </section>;
}
