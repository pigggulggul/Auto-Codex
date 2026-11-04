import { useEffect, useRef, useState } from "react";
import { IssueApiError, type IssueApi } from "./api";
import { IssueBrowser } from "./IssueBrowser";
import "./workspace.css";

type Props = {
  hidden: boolean;
  projectPath: string | null;
  workspaceMode: "project" | "research";
  selectionGeneration: number;
  connected: boolean;
  appServerReady: boolean;
  busy: boolean;
  isPicking: boolean;
  onPickProject: () => unknown;
  api: IssueApi;
};

export function IssueWorkspace({ hidden, projectPath, workspaceMode, selectionGeneration, connected, appServerReady, busy, isPicking, onPickProject, api }: Props) {
  const hasProject = workspaceMode === "project" && Boolean(projectPath);
  const [binding, setBinding] = useState<"idle" | "checking" | "unbound" | "binding" | "bound" | "error">("idle");
  const [bindingError, setBindingError] = useState("");
  const [importState, setImportState] = useState<"idle" | "selecting" | "success" | "error">("idle");
  const [importMessage, setImportMessage] = useState("");
  const [importRevision, setImportRevision] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const selection = useRef(0);
  useEffect(() => {
    const version = ++selection.current;
    setImportState("idle"); setImportMessage("");
    if (hidden || !connected || !hasProject) { setBinding("idle"); setBindingError(""); return; }
    setBinding("checking"); setBindingError("");
    void api.request("status").then(result => { if (selection.current === version) setBinding(result.bound ? "bound" : "unbound"); })
      .catch(error => { if (selection.current === version) { setBinding("error"); setBindingError(error instanceof Error ? error.message : "연결 상태를 확인하지 못했습니다."); } });
    return () => { selection.current++; };
  }, [api, connected, hasProject, hidden, projectPath, refresh, workspaceMode, selectionGeneration]);
  const bind = async () => {
    const version = selection.current; setBinding("binding"); setBindingError("");
    try {
      const result = await api.request("bind");
      if (selection.current === version) setBinding(result.cancelled ? "unbound" : result.bound ? "bound" : "unbound");
    } catch (error) {
      if (selection.current === version) { setBinding("error"); setBindingError(error instanceof Error ? error.message : "이슈 저장소 연결을 확인하지 못했습니다."); }
    }
  };
  const importDocument = async () => {
    const version = selection.current; setImportState("selecting"); setImportMessage("");
    try {
      const result = await api.request("import");
      if (selection.current !== version) return;
      if (result.cancelled) { setImportState("idle"); return; }
      setImportState("success");
      setImportRevision(value => value + 1);
      setImportMessage(result.alreadyImported ? `이미 등록된 문서입니다. 이슈 ${result.issueCount}개를 중복 등록하지 않았습니다.` : `이슈 ${result.issueCount}개를 등록했습니다. 가져온 완료 상태는 별도 확인이 필요합니다.`);
    } catch (error) {
      if (selection.current !== version) return;
      setImportState("error");
      setImportMessage(error instanceof IssueApiError && error.code === "UNSUPPORTED_FORMAT" ? `${error.message} 일반 문서 분석은 아직 준비 중입니다.` : error instanceof Error ? error.message : "이슈 문서를 가져오지 못했습니다.");
    }
  };
  return <section className="issues-workspace" hidden={hidden} aria-label="이슈 처리 작업실">
    <div className="issues-intro">
      <div><p className="issues-kicker">ISSUE WORKSPACE</p><h2>요구사항에서 검증까지</h2><p>선택한 프로젝트를 기준으로 이슈를 계획하고, 작업과 확인 과정을 살펴볼 수 있는 공간입니다.</p></div>
      <span className="issues-stage">준비 중</span>
    </div>
    <div className="issues-project" role="status">
      <div><strong>{hasProject ? "현재 프로젝트" : "프로젝트를 선택하세요"}</strong><p>{hasProject ? projectPath : workspaceMode === "research" ? "조사 모드에서는 이슈 작업을 시작할 수 없습니다." : "이슈는 선택한 로컬 프로젝트에 연결됩니다."}</p></div>
      <button type="button" onClick={onPickProject} disabled={!connected || busy || isPicking || binding === "binding" || importState === "selecting"}>{isPicking ? "폴더 선택 중…" : hasProject ? "프로젝트 변경" : "프로젝트 폴더 선택"}</button>
    </div>
    {!connected && <p className="issues-notice" role="status">브리지 연결이 끊겼습니다. 연결 후 프로젝트를 선택할 수 있습니다.</p>}
    {connected && !appServerReady && <p className="issues-notice" role="status">Codex App Server가 준비되지 않았습니다. 연결 상태를 확인하세요.</p>}
    {hasProject && connected && <div className="issues-binding" role="status" aria-live="polite">
      <div><strong>이슈 저장소</strong><p>{binding === "checking" ? "연결 상태 확인 중…" : binding === "binding" ? "폴더 선택을 기다리는 중…" : binding === "bound" ? "현재 프로젝트에 연결되었습니다." : binding === "unbound" ? "아직 연결되지 않았습니다. 폴더를 다시 선택해 연결할 수 있습니다." : binding === "error" ? bindingError : "연결 상태를 확인합니다."}</p></div>
      {binding === "unbound" && <button type="button" onClick={() => void bind()} disabled={busy || isPicking}>이슈 저장소 연결</button>}
      {binding === "error" && <button type="button" onClick={() => setRefresh(value => value + 1)}>연결 상태 다시 확인</button>}
    </div>}
    <div className="issues-actions" aria-label="이슈 작업">
      <button type="button" disabled>이슈 후보 만들기 <small>준비 중</small></button>
      <button type="button" onClick={() => void importDocument()} disabled={binding !== "bound" || busy || isPicking || importState === "selecting"}>{importState === "selecting" ? "문서 선택·등록 중…" : "이슈 문서 불러오기"}</button>
      <button type="button" disabled>완료 상태 갱신 <small>준비 중</small></button>
    </div>
    {importMessage && <p className="issues-notice" role={importState === "error" ? "alert" : "status"}>{importMessage}</p>}
    <IssueBrowser key={`${workspaceMode}:${projectPath || ""}:${selectionGeneration}:${connected}`} api={api} active={!hidden && connected && binding === "bound"} importRevision={importRevision} />
    <div className="issues-overview">
      <div><span>01</span><h3>계획과 대화</h3><p>선택한 자료와 추가 요청을 바탕으로 요구사항과 이슈 후보를 정리합니다.</p></div>
      <div><span>02</span><h3>요구사항 검증</h3><p>자료와 요구사항, 이슈의 연결 및 미확인 항목을 살펴봅니다.</p></div>
      <div><span>03</span><h3>이슈 목록</h3><p>이슈의 상태와 버전, 선행 관계를 확인합니다.</p></div>
      <div><span>04</span><h3>실행 기록</h3><p>실제 작업과 테스트, 승인 및 확인 결과를 기록합니다.</p></div>
    </div>
    <p className="issues-footnote">규격 Markdown 문서는 선택 후 로컬 저장소에 보관됩니다. 일반 문서 분석과 이슈 실행은 준비 중입니다. 화면 전환으로 작업이 시작되지는 않습니다.</p>
  </section>;
}
