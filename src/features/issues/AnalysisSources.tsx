import { useEffect, useRef, useState } from "react";
import type { AnalysisCandidate, AnalysisFreshness, AnalysisRunStatus, AnalysisSegmentPage, AnalysisSnapshotSummary, AnalysisSourceChunk, AnalysisSourceList, SemanticStatus } from "../../../shared/issues/sources";
import { ISSUE_PLANNING_MODEL_PATHS_VERIFIED } from "../../../shared/issues/feature-gates";
import { IssueApiError, type DraftState, type IssueApi } from "./api";

type Props = { api: IssueApi; revision: number; draftRevision?: number | null; draftReady?: boolean; loading: boolean; setLoading: (loading: boolean) => void; onViewExpired: (message: string) => void; onSelectCandidate?: (candidate: AnalysisCandidate) => void; onDraftUpdated?: (draft: DraftState) => void };
const RUN_STATE = { idle: "대기", preparing: "준비 중", running: "분석 중", complete: "분석 종료", blocked: "확인 필요", limit: "처리 한도 도달", interrupted: "중단됨", failed: "실패", "termination-unconfirmed": "종료 확인 불가" } as const;
const SEGMENT_STATE = { pending: "대기", running: "분석 중", processed: "처리됨", failed: "실패", interrupted: "중단됨" } as const;
const SEGMENT_ERROR = { STALE_INPUT: "자료가 변경됨", INVALID_OUTPUT: "결과 형식 확인 불가", MODEL_FAILED: "모델 요청 실패", LIMIT_EXCEEDED: "후보 한도 초과" } as const;
const SEMANTIC_STATE = { idle: "대기", running: "검증 중", complete: "검증 종료", failed: "실패", interrupted: "중단됨", stale: "입력 변경됨", "termination-unconfirmed": "종료 확인 불가" } as const;

export function AnalysisPreparationControl({ loading, hasSources, hasStaleSources, onPrepare }: { loading: boolean; hasSources: boolean; hasStaleSources: boolean; onPrepare: () => void }) {
  return <>{hasStaleSources && <p role="status">이전 프로젝트 버전에서 선택한 자료가 있습니다. 각 자료를 다시 선택하세요. 내용이 바뀌었다면 기존 선택을 해제한 뒤 다시 선택해야 합니다.</p>}<button type="button" disabled={loading || !hasSources || hasStaleSources} onClick={onPrepare}>분석 입력 준비</button></>;
}

export function AnalysisSources({ api, revision, draftRevision = null, draftReady = false, loading, setLoading, onViewExpired, onSelectCandidate, onDraftUpdated }: Props) {
  const [sources, setSources] = useState<AnalysisSourceList>({ items: [], totalBytes: 0 });
  // The bridge may retain selections across a revision reload and remount.
  // Do not equate an unloaded or failed list with an empty selection.
  const [sourcesKnown, setSourcesKnown] = useState(false);
  const [chunk, setChunk] = useState<AnalysisSourceChunk | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [instruction, setInstruction] = useState("");
  const [snapshot, setSnapshot] = useState<AnalysisSnapshotSummary | null>(null);
  const [freshness, setFreshness] = useState<AnalysisFreshness | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisRunStatus | null>(null);
  const [interrupting, setInterrupting] = useState(false);
  const [semantic, setSemantic] = useState<SemanticStatus | null>(null);
  const [semanticSaved, setSemanticSaved] = useState(false);
  const [semanticInterrupting, setSemanticInterrupting] = useState(false);
  const [segment, setSegment] = useState<AnalysisSegmentPage | null>(null);
  const [segmentOffset, setSegmentOffset] = useState(0), [segmentHistory, setSegmentHistory] = useState<number[]>([]);
  const alive = useRef(true);
  const analysisSequence = useRef(0);
  const initialListRequested = useRef(false);
  const currentRevision = useRef(revision); currentRevision.current = revision;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setSnapshot(null); setFreshness(null); setSegment(null); setAnalysisStatus(null); }, [revision]);
  useEffect(() => { setSemantic(null); setSemanticSaved(false); }, [revision, draftRevision]);

  async function run(operation: () => Promise<void>, label: string, preserveSelection = false) {
    if (loading) return;
    setLoading(true); setWorking(label); setError("");
    try { await operation(); }
    catch (caught) {
      if (!alive.current) return;
      if (!preserveSelection) { setChunk(null); setHistory([]); setSources({ items: [], totalBytes: 0 }); setSourcesKnown(false); setSnapshot(null); setFreshness(null); }
      if (caught instanceof IssueApiError && caught.code === "STALE_INPUT") { setSnapshot(null); setFreshness(null); setSegment(null); setAnalysisStatus(null); }
      const message = caught instanceof IssueApiError ? caught.message : "자료 요청을 처리하지 못했습니다.";
      if (caught instanceof IssueApiError && caught.code === "VIEW_AUTH_REQUIRED") onViewExpired(message);
      else setError(message);
    } finally { if (alive.current) { setWorking(""); setLoading(false); } }
  }
  const refresh = () => run(async () => { const result = await api.request("sourceList"); if (alive.current && result.sources) { setSources(result.sources); setSourcesKnown(true); setChunk(null); setHistory([]); setSnapshot(null); setFreshness(null); } }, "목록 확인 중…");
  const add = () => run(async () => { const result = await api.request("sourceAdd"); if (alive.current && result.sources) { setSources(result.sources); setSourcesKnown(true); setSnapshot(null); setFreshness(null); } }, "파일 선택을 기다리는 중…");
  const remove = (sourceId: string) => run(async () => { const result = await api.request("sourceRemove", { sourceId }); if (alive.current && result.sources) { setSources(result.sources); setSourcesKnown(true); setSnapshot(null); setFreshness(null); if (chunk?.sourceId === sourceId) { setChunk(null); setHistory([]); } } }, "선택 해제 중…");
  const preview = (sourceId: string, offset: number, nextHistory: number[]) => run(async () => { const result = await api.request("sourceRead", { sourceId, offset }); if (alive.current && result.chunk) { setChunk(result.chunk); setHistory(nextHistory); } }, "자료를 불러오는 중…");
  const prepare = () => run(async () => { setFreshness(null); const result = await api.request("snapshotPrepare", { expectedRevision: revision, expectedSources: sources.items.map(({ id, sha256 }) => ({ id, sha256 })), instruction }); if (alive.current && currentRevision.current === revision && result.snapshot) setSnapshot(result.snapshot); }, "분석 입력을 확인하는 중…");
  const checkFreshness = () => { if (!snapshot) return; void run(async () => { setFreshness(null); const result = await api.request("snapshotCheck", { snapshotId: snapshot.id, expectedRevision: revision, expectedIds: snapshot.sources.map(item => item.id) }); if (alive.current && currentRevision.current === revision && result.freshness) setFreshness(result.freshness); }, "선택한 원본을 확인하는 중…"); };
  const checkAnalysisStatus = () => { const sequence = ++analysisSequence.current; return run(async () => { const result = await api.request("analysisStatus"); if (alive.current && sequence === analysisSequence.current && result.analysisStatus) setAnalysisStatus(result.analysisStatus); }, "분석 실행 상태 확인 중…", true); };
  const startAnalysis = () => { if (!snapshot) return; const sequence = ++analysisSequence.current; void run(async () => { const result = await api.request("analysisStart", { snapshotId: snapshot.id, expectedRevision: revision }); if (alive.current && sequence === analysisSequence.current && currentRevision.current === revision && result.analysisStatus) setAnalysisStatus(result.analysisStatus); }, "분석 시작 요청 중…", true); };
  const interruptAnalysis = async () => {
    if (interrupting) return; ++analysisSequence.current; setInterrupting(true); setError("");
    try { const result = await api.request("analysisInterrupt"); if (alive.current && result.analysisStatus) setAnalysisStatus(result.analysisStatus); }
    catch (caught) { if (!alive.current) return; const message = caught instanceof IssueApiError ? caught.message : "중단 요청을 확인하지 못했습니다."; if (caught instanceof IssueApiError && caught.code === "VIEW_AUTH_REQUIRED") onViewExpired(message); else setError(message); }
    finally { if (alive.current) setInterrupting(false); }
  };
  const clearAnalysis = () => run(async () => { const result = await api.request("analysisClear"); if (alive.current && result.analysisStatus) { setAnalysisStatus(result.analysisStatus); setSegment(null); } }, "분석 상태 정리 중…", true);
  const showSegment = (index: number, offset = 0, history: number[] = []) => run(async () => { const result = await api.request("analysisSegment", { index, offset }); if (alive.current && result.analysisSegment) { setSegment(result.analysisSegment); setSegmentOffset(offset); setSegmentHistory(history); } }, "분석 구간을 불러오는 중…", true);
  const retrySegment = () => { if (!segment) return; void run(async () => { const result = await api.request("analysisRetry", { index: segment.index }); if (alive.current && result.analysisStatus) { setAnalysisStatus(result.analysisStatus); setSegment(null); } }, "구간 재시도 요청 중…", true); };
  const startSemantic = () => { if (!snapshot || !segment || draftRevision === null || !draftReady) return; void run(async () => { const result = await api.request("semanticStart", { snapshotId: snapshot.id, expectedRevision: revision, draftRevision, index: segment.index }); if (alive.current && result.semanticStatus) { setSemantic(result.semanticStatus); setSemanticSaved(false); } }, "의미 검증 시작 요청 중…", true); };
  const checkSemantic = () => run(async () => { const result = await api.request("semanticStatus"); if (alive.current && result.semanticStatus) setSemantic(result.semanticStatus); }, "의미 검증 상태 확인 중…", true);
  const clearSemantic = () => run(async () => { const result = await api.request("semanticClear"); if (alive.current && result.semanticStatus) { setSemantic(result.semanticStatus); setSemanticSaved(false); } }, "의미 검증 결과 정리 중…", true);
  const saveSemantic = () => { if (draftRevision === null) return; void run(async () => { const result = await api.request("semanticSave", { draftRevision }); if (!result.draft) throw new IssueApiError("INVALID_RESPONSE", "초안에 기록한 결과를 확인하지 못했습니다."); if (alive.current) { setSemanticSaved(true); onDraftUpdated?.(result.draft); } }, "검증 결과를 초안에 기록 중…", true); };
  const interruptSemantic = async () => {
    if (semanticInterrupting) return; setSemanticInterrupting(true); setError("");
    try { const result = await api.request("semanticInterrupt"); if (alive.current && result.semanticStatus) setSemantic(result.semanticStatus); }
    catch (caught) { if (alive.current) { const message = caught instanceof IssueApiError ? caught.message : "중단 요청을 확인하지 못했습니다."; if (caught instanceof IssueApiError && caught.code === "VIEW_AUTH_REQUIRED") onViewExpired(message); else setError(message); } }
    finally { if (alive.current) setSemanticInterrupting(false); }
  };
  useEffect(() => {
    if (!loading && !initialListRequested.current) {
      initialListRequested.current = true;
      void refresh();
    }
  }, [loading]);
  const selected = sources.items.find(item => item.id === chunk?.sourceId);
  const hasStaleSources = sources.items.some(item => item.projectRevision !== revision);

  return <section className="issues-sources" aria-labelledby="issues-sources-heading">
    <h3 id="issues-sources-heading">분석할 자료 미리보기</h3>
    <p>프로젝트 안의 Markdown 또는 텍스트 파일을 한 번에 하나씩 선택합니다. 파일당 1 MiB, 최대 16개 및 총 4 MiB까지 선택할 수 있습니다.</p>
    <p className="issues-view-note">선택본은 이 연결의 메모리에만 보관하며, 보기 권한 종료나 프로젝트 변경 시 지워집니다. 원본이 나중에 바뀌어도 선택본은 자동 갱신되지 않습니다. 파일 이름으로 일부 비밀 파일을 제외하지만 내용에 민감한 정보가 없는지 직접 확인하세요.</p>
    <p className="issues-view-note">자료 선택과 입력 준비만으로 AI 분석이나 전송이 시작되지는 않습니다. 실행 가능 여부는 브리지에서 확인합니다.</p>
    <p className="issues-view-note">실행 환경에 따라 Codex의 프로젝트 지침도 모델에 전달될 수 있습니다.</p>
    <p className="issues-view-note">현재 AI 분석은 별도 작업자에서 도구 호출 없이 실행됩니다. 분석 중 명령 실행은 아직 지원하지 않습니다.</p>
    <button type="button" disabled={loading} onClick={() => void checkAnalysisStatus()}>분석 실행 상태 확인</button>{analysisStatus === "unavailable" && <p role="status">AI 분석 실행을 현재 사용할 수 없습니다.</p>}{analysisStatus && analysisStatus !== "unavailable" && <div role="status"><p>분석 상태: {RUN_STATE[analysisStatus.state]}</p>{analysisStatus.progress && <p>처리 {analysisStatus.progress.processed} · 대기 {analysisStatus.progress.pending} · 진행 {analysisStatus.progress.running} · 실패 {analysisStatus.progress.failed} · 중단 {analysisStatus.progress.interrupted}</p>}{["preparing", "running"].includes(analysisStatus.state) ? <button type="button" disabled={interrupting} onClick={() => void interruptAnalysis()}>{interrupting ? "중단 요청 중…" : "분석 중단"}</button> : analysisStatus.state !== "idle" && <button type="button" disabled={loading || interrupting || analysisStatus.state === "termination-unconfirmed"} onClick={() => void clearAnalysis()}>분석 상태와 후보 지우기</button>}</div>}
    {analysisStatus && analysisStatus !== "unavailable" && analysisStatus.progress && snapshot && snapshot.totalSegments > 0 && <div><button type="button" disabled={loading} onClick={() => void showSegment(0)}>분석 구간과 후보 확인</button>{segment && <section aria-label="분석 구간 결과"><h4>분석 구간 {segment.index + 1}/{snapshot.totalSegments}</h4><p>구간 상태: {SEGMENT_STATE[segment.status]}{segment.error ? ` · ${SEGMENT_ERROR[segment.error]}` : ""}</p><p className="issues-view-note">후보는 검토 전 제안이며 원문 인용이 있어도 해석의 정확성을 보장하지 않습니다.</p>{segment.items.length ? <ul>{segment.items.map(item => <li key={item.id}><p className="issues-prewrap">{item.text}</p><small>{item.origin === "source" ? "원문 근거" : "AI 제안"}{item.uncertainty ? ` · 확인 필요: ${item.uncertainty}` : ""}</small>{item.evidence && <p className="issues-prewrap">{item.evidence.sourcePath} · 인용: {item.evidence.quote}</p>}{onSelectCandidate && <button type="button" disabled={loading} onClick={() => onSelectCandidate(item)}>이 후보를 초안에 사용</button>}</li>)}</ul> : <p>이 페이지에 후보가 없습니다.</p>}<div className="issues-pagination">{segment.index > 0 && <button type="button" disabled={loading} onClick={() => void showSegment(segment.index - 1)}>이전 구간</button>}{segment.index + 1 < snapshot.totalSegments && <button type="button" disabled={loading} onClick={() => void showSegment(segment.index + 1)}>다음 구간</button>}{segmentHistory.length > 0 && <button type="button" disabled={loading} onClick={() => void showSegment(segment.index, segmentHistory.at(-1)!, segmentHistory.slice(0, -1))}>이전 후보</button>}{segment.nextOffset !== null && <button type="button" disabled={loading} onClick={() => void showSegment(segment.index, segment.nextOffset!, [...segmentHistory, segmentOffset])}>다음 후보</button>}{["failed", "interrupted"].includes(segment.status) && ["blocked", "interrupted"].includes(analysisStatus.state) && <button type="button" disabled={loading} onClick={retrySegment}>이 구간 재시도</button>}</div></section>}</div>}
    {snapshot && segment && <section aria-label="선택 구간 의미 검증"><h4>선택 구간 의미 검증</h4><p>선택한 한 구간과 현재 초안의 요구사항·이슈 내용이 모델 제공자에게 전송됩니다. Codex에 설정된 전역 지침도 함께 전송될 수 있습니다. 다른 구간은 검증하지 않습니다. 결과는 누락 가능성에 대한 제안이며 완전성이나 구현 성공을 증명하지 않습니다.</p>{!ISSUE_PLANNING_MODEL_PATHS_VERIFIED && <p>이 의미 검증 실행 경로는 안전 검증 후 사용할 수 있습니다.</p>}<button type="button" disabled={!ISSUE_PLANNING_MODEL_PATHS_VERIFIED || loading || draftRevision === null || !draftReady || Boolean(semantic && semantic.state !== "idle")} onClick={startSemantic}>이 구간 의미 검증 시작</button><button type="button" disabled={loading} onClick={() => void checkSemantic()}>의미 검증 상태 확인</button>{draftRevision === null ? <p>먼저 초안을 만드세요.</p> : !draftReady && <p>작성 중인 내용을 초안에 저장하거나 취소한 뒤 검증하세요.</p>}{semantic && <div role="status"><p>상태: {SEMANTIC_STATE[semantic.state]}</p>{semantic.state === "running" ? <button type="button" disabled={semanticInterrupting} onClick={() => void interruptSemantic()}>의미 검증 중단</button> : semantic.state !== "idle" && <button type="button" disabled={loading || semantic.state === "termination-unconfirmed"} onClick={() => void clearSemantic()}>의미 검증 결과 지우기</button>}{semantic.result && semantic.result.projectRevision === revision && semantic.result.draftRevision === draftRevision && semantic.result.snapshotId === snapshot.id && <><p>프로젝트 r{semantic.result.projectRevision} · 초안 r{semantic.result.draftRevision} · 선택한 한 구간만 검토</p><button type="button" disabled={loading || semanticSaved || !onDraftUpdated} onClick={saveSemantic}>검증 결과를 초안에 기록</button><p>기록은 현재 연결의 초안에만 반영됩니다. 재시작 후에도 보관하려면 초안과 검토 이력 저장을 누르세요.</p>{semantic.result.findings.length ? <ul>{semantic.result.findings.map(item => <li key={item.id}><p>{item.summary}</p><p>확인 필요: {item.uncertainty}</p><small>{item.kind} · 요구사항 {item.requirementId ?? "없음"} · 이슈 {item.issueId ?? "없음"}</small>{item.evidence && <p>선택 자료 인용: {item.evidence.quote} · 위치 {item.evidence.start}–{item.evidence.end}</p>}</li>)}</ul> : <p>이 구간에서 제안된 항목이 없습니다. 누락이 없다는 뜻은 아닙니다.</p>}</>}</div>}</section>}
    <div className="issues-pagination"><button type="button" disabled={loading || !sourcesKnown} onClick={() => void add()}>자료 파일 선택</button><button type="button" disabled={loading} onClick={() => void refresh()}>선택 목록 확인</button></div>
    {working && <p role="status">{working}</p>}
    {error && <p role="alert">{error} 선택 상태가 불확실하면 목록을 다시 확인하세요.</p>}
    {sourcesKnown ? <><p>선택 {sources.items.length}개 · {sources.totalBytes.toLocaleString()} bytes</p>
    {sources.items.length ? <ul className="issues-source-list">{sources.items.map(item => <li key={item.id}><div><strong>{item.relativePath}</strong><small>{item.bytes.toLocaleString()} bytes · 프로젝트 r{item.projectRevision}</small><small>SHA-256: {item.sha256}</small></div><div className="issues-pagination"><button type="button" disabled={loading} onClick={() => void preview(item.id, 0, [])}>미리보기</button><button type="button" disabled={loading} onClick={() => void remove(item.id)}>선택 해제</button></div></li>)}</ul> : <p>선택한 자료가 없습니다.</p>}</> : <p role="status">선택 자료 목록을 확인해야 합니다.</p>}
    {chunk && selected && <div className="issues-source-preview"><h4>{selected.relativePath} 미리보기</h4><p className="issues-view-note">선택 당시 내용 · 부분 보기</p><pre tabIndex={0}>{chunk.text || "(빈 파일)"}</pre><div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={() => void preview(chunk.sourceId, history.at(-1)!, history.slice(0, -1))}>이전 내용</button>}{chunk.nextOffset !== null && <button type="button" disabled={loading} onClick={() => void preview(chunk.sourceId, chunk.nextOffset!, [...history, chunk.offset])}>다음 내용</button>}</div></div>}
    <div className="issues-snapshot"><h4>분석 입력 준비</h4><label htmlFor="issue-analysis-instruction">추가 요청 (선택)</label><textarea id="issue-analysis-instruction" rows={3} maxLength={1024} value={instruction} disabled={loading} onChange={event => { setInstruction(event.target.value); setSnapshot(null); setFreshness(null); }} placeholder="분석할 때 참고할 요청을 입력하세요." /><p className="issues-view-note">선택한 사본과 추가 요청을 이 연결의 메모리에 고정합니다. 준비만으로 모델 호출이나 이슈 등록은 시작되지 않습니다.</p><AnalysisPreparationControl loading={loading} hasSources={sourcesKnown && sources.items.length > 0} hasStaleSources={hasStaleSources} onPrepare={() => void prepare()} />
      {snapshot && snapshot.projectRevision === revision && <div><div role="status"><p>프로젝트 r{snapshot.projectRevision} 기준 · 자료 {snapshot.sources.length}개 · 준비 시 처리 {snapshot.processedSegments}/{snapshot.totalSegments} 구간</p><ul>{snapshot.sources.map(item => <li key={item.id}>{item.relativePath}: {item.segmentCount ? `${item.segmentCount}개 구간` : "빈 파일 · 분석할 내용 없음"}</li>)}</ul><p>입력 준비 단계에서는 요구사항을 추출하지 않습니다.</p></div><button type="button" disabled={loading} onClick={checkFreshness}>원본 변경 확인</button><p className="issues-view-note">선택 당시 사본과 현재 원본을 비교합니다. 확인 이후 원본이 다시 바뀔 수 있습니다.</p>{freshness && freshness.snapshotId === snapshot.id && <div role="status"><ul>{freshness.files.map((file, index) => <li key={file.id}>{snapshot.sources[index].relativePath}: {file.state === "unchanged" ? "선택 당시와 일치" : file.state === "changed" ? "내용 변경됨 · 선택 해제 후 다시 선택" : "원본을 확인할 수 없음 · 경로와 파일 상태 확인"}</li>)}</ul></div>}<p className="issues-view-note">분석을 시작하면 선택한 자료와 추가 요청이 설정된 모델 제공자에게 전송됩니다. Codex에 설정된 전역 지침도 함께 전송될 수 있습니다.</p><button type="button" disabled={loading || snapshot.totalSegments === 0 || !!analysisStatus && analysisStatus !== "unavailable" && analysisStatus.state !== "idle"} onClick={startAnalysis}>분석 시작</button></div>}
    </div>
  </section>;
}
