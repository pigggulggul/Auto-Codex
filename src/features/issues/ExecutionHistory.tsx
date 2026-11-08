import { useEffect, useRef, useState } from "react";
import type { IssueExecutionHistoryEntry } from "../../../shared/issues/view";
import { IssueApiError, type IssueApi } from "./api";

const PHASE: Record<IssueExecutionHistoryEntry["phase"], string> = { prepared: "준비됨", dispatching: "전송 중", running: "실행 중", verifying: "검토 중", outcome_unknown: "결과 불명", settled: "종료 기록" };
const OUTCOME: Record<Exclude<IssueExecutionHistoryEntry["outcome"], null>, string> = { interrupted: "중단", failed: "실패", verification_finished: "검토 절차 종료", reconciled_unknown: "결과 불명 확인" };

export function ExecutionHistoryList({ items }: { items: IssueExecutionHistoryEntry[] }) {
  return items.length ? <ul>{items.map(item => <li key={item.attemptId}>{item.issueId} · {PHASE[item.phase]}{item.outcome ? ` · ${OUTCOME[item.outcome]}` : ""} · 프로젝트 r{item.projectRevision}<small> · {item.attemptId}</small><p>승인 대기 {item.approvals.pending} · 전송 중 {item.approvals.responding} · 전송 기록 {item.approvals.sent} · 전송 불명 {item.approvals.outcome_unknown} · 만료 {item.approvals.expired}</p></li>)}</ul> : <p>실행 기록이 없습니다.</p>;
}

/** The parent only mounts this inside its current project-view grant. */
export function ExecutionHistory({ api, revision, loading, setLoading, onError }: { api: IssueApi; revision: number; loading: boolean; setLoading: (loading: boolean) => void; onError: (error: unknown) => void }) {
  const [page, setPage] = useState<{ items: IssueExecutionHistoryEntry[]; nextAfterId: string | null } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [history, setHistory] = useState<(string | null)[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async (afterId: string | null, previous: (string | null)[]) => {
    setLoading(true);
    try {
      const response = await api.request("view", { kind: "executionHistory", expectedRevision: revision, afterId });
      if (!alive.current) return;
      if (!response.view || response.view.kind !== "executionHistory") throw new IssueApiError("INVALID_RESPONSE", "실행 기록을 확인할 수 없습니다.");
      setPage(response.view.page); setCursor(afterId); setHistory(previous);
    } catch (error) { if (alive.current) onError(error); }
    finally { if (alive.current) setLoading(false); }
  };
  return <section aria-label="이슈 실행 기록"><h3>실행 기록</h3><p className="issues-view-note">기록은 시도 ID 순서입니다. 종료나 검토 절차 종료만으로 이슈 완료가 확인된 것은 아닙니다. 결과 불명은 자동 재실행되지 않습니다. 승인 전송 기록은 실제 작업 성공을 뜻하지 않습니다.</p><button type="button" disabled={loading} onClick={() => void load(null, [])}>실행 기록 확인</button>{page && <ExecutionHistoryList items={page.items} />}{page && <div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={() => void load(history.at(-1)!, history.slice(0, -1))}>이전 기록</button>}{page.nextAfterId && <button type="button" disabled={loading} onClick={() => void load(page.nextAfterId!, [...history, cursor])}>다음 기록</button>}</div>}</section>;
}
