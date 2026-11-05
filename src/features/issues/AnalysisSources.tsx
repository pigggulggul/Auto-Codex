import { useEffect, useRef, useState } from "react";
import type { AnalysisFreshness, AnalysisSnapshotSummary, AnalysisSourceChunk, AnalysisSourceList } from "../../../shared/issues/sources";
import { IssueApiError, type IssueApi } from "./api";

type Props = { api: IssueApi; revision: number; loading: boolean; setLoading: (loading: boolean) => void; onViewExpired: (message: string) => void };

export function AnalysisPreparationControl({ loading, hasSources, hasStaleSources, onPrepare }: { loading: boolean; hasSources: boolean; hasStaleSources: boolean; onPrepare: () => void }) {
  return <>{hasStaleSources && <p role="status">이전 프로젝트 버전에서 선택한 자료가 있습니다. 각 자료를 다시 선택하세요. 내용이 바뀌었다면 기존 선택을 해제한 뒤 다시 선택해야 합니다.</p>}<button type="button" disabled={loading || !hasSources || hasStaleSources} onClick={onPrepare}>분석 입력 준비</button></>;
}

export function AnalysisSources({ api, revision, loading, setLoading, onViewExpired }: Props) {
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
  const alive = useRef(true);
  const initialListRequested = useRef(false);
  const currentRevision = useRef(revision); currentRevision.current = revision;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setSnapshot(null); setFreshness(null); }, [revision]);

  async function run(operation: () => Promise<void>, label: string) {
    if (loading) return;
    setLoading(true); setWorking(label); setError("");
    try { await operation(); }
    catch (caught) {
      if (!alive.current) return;
      setChunk(null); setHistory([]); setSources({ items: [], totalBytes: 0 }); setSourcesKnown(false); setSnapshot(null); setFreshness(null);
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
    <p className="issues-view-note">현재는 자료 선택과 분석 입력 준비까지만 가능합니다. AI 분석이나 전송은 실행되지 않습니다.</p>
    <div className="issues-pagination"><button type="button" disabled={loading || !sourcesKnown} onClick={() => void add()}>자료 파일 선택</button><button type="button" disabled={loading} onClick={() => void refresh()}>선택 목록 확인</button></div>
    {working && <p role="status">{working}</p>}
    {error && <p role="alert">{error} 선택 상태가 불확실하면 목록을 다시 확인하세요.</p>}
    {sourcesKnown ? <><p>선택 {sources.items.length}개 · {sources.totalBytes.toLocaleString()} bytes</p>
    {sources.items.length ? <ul className="issues-source-list">{sources.items.map(item => <li key={item.id}><div><strong>{item.relativePath}</strong><small>{item.bytes.toLocaleString()} bytes · 프로젝트 r{item.projectRevision}</small><small>SHA-256: {item.sha256}</small></div><div className="issues-pagination"><button type="button" disabled={loading} onClick={() => void preview(item.id, 0, [])}>미리보기</button><button type="button" disabled={loading} onClick={() => void remove(item.id)}>선택 해제</button></div></li>)}</ul> : <p>선택한 자료가 없습니다.</p>}</> : <p role="status">선택 자료 목록을 확인해야 합니다.</p>}
    {chunk && selected && <div className="issues-source-preview"><h4>{selected.relativePath} 미리보기</h4><p className="issues-view-note">선택 당시 내용 · 부분 보기</p><pre tabIndex={0}>{chunk.text || "(빈 파일)"}</pre><div className="issues-pagination">{history.length > 0 && <button type="button" disabled={loading} onClick={() => void preview(chunk.sourceId, history.at(-1)!, history.slice(0, -1))}>이전 내용</button>}{chunk.nextOffset !== null && <button type="button" disabled={loading} onClick={() => void preview(chunk.sourceId, chunk.nextOffset!, [...history, chunk.offset])}>다음 내용</button>}</div></div>}
    <div className="issues-snapshot"><h4>분석 입력 준비</h4><label htmlFor="issue-analysis-instruction">추가 요청 (선택)</label><textarea id="issue-analysis-instruction" rows={3} maxLength={1024} value={instruction} disabled={loading} onChange={event => { setInstruction(event.target.value); setSnapshot(null); setFreshness(null); }} placeholder="분석할 때 참고할 요청을 입력하세요." /><p className="issues-view-note">선택한 사본과 추가 요청을 이 연결의 메모리에 고정합니다. 준비만으로 모델 호출이나 이슈 등록은 시작되지 않습니다.</p><AnalysisPreparationControl loading={loading} hasSources={sourcesKnown && sources.items.length > 0} hasStaleSources={hasStaleSources} onPrepare={() => void prepare()} />
      {snapshot && snapshot.projectRevision === revision && <div><div role="status"><p>프로젝트 r{snapshot.projectRevision} 기준 · 자료 {snapshot.sources.length}개 · 처리 {snapshot.processedSegments}/{snapshot.totalSegments} 구간</p><ul>{snapshot.sources.map(item => <li key={item.id}>{item.relativePath}: {item.segmentCount ? `${item.segmentCount}개 구간 모두 미처리` : "빈 파일 · 분석할 내용 없음"}</li>)}</ul><p>아직 요구사항을 추출하거나 이슈 후보를 생성하지 않았습니다.</p></div><button type="button" disabled={loading} onClick={checkFreshness}>원본 변경 확인</button><p className="issues-view-note">선택 당시 사본과 현재 원본을 비교합니다. 확인 이후 원본이 다시 바뀔 수 있습니다.</p>{freshness && freshness.snapshotId === snapshot.id && <div role="status"><ul>{freshness.files.map((file, index) => <li key={file.id}>{snapshot.sources[index].relativePath}: {file.state === "unchanged" ? "선택 당시와 일치" : file.state === "changed" ? "내용 변경됨 · 선택 해제 후 다시 선택" : "원본을 확인할 수 없음 · 경로와 파일 상태 확인"}</li>)}</ul></div>}</div>}
    </div>
  </section>;
}
