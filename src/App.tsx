import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtelierNavigation, PAGE_INFO, type AtelierPage } from "./components/layout/AtelierNavigation";
import { AtelierHome, AtelierNotes } from "./components/layout/AtelierPages";
import {AtelierWorkspace} from './features/atelier/Workspace';
import type {Entry,Tab} from '../shared/atelier/types';
import { ApprovalDialog } from "./components/ApprovalDialog";
import { ModelPicker } from "./components/ModelPicker";
import { OperationsPanel } from "./components/OperationsPanel";
import { PixelOffice } from "./components/PixelOffice";
import { ProjectPanel } from "./components/ProjectPanel";
import { ConversationPicker } from "./components/ConversationPicker";
import { ResultView } from "./components/ResultView";
import { SkillPicker } from "./components/SkillPicker";
import { useBridge } from "./hooks/useBridge";
import type { AgentRole, ExecutionMode, ReasoningEffort } from "../shared/protocol";
import {
  loadPetAssignments,
  loadPetCatalog,
  savePetAssignments,
  type LoadedPet,
  type PetAssignments,
} from "./lib/petCatalog";
import {
  loadWorldCharacterAssignments,
  saveWorldCharacterAssignments,
  type WorldCharacterAssignments,
} from "./lib/worldCharacters";

const MODEL_KEY = "auto-codex.model";
const EFFORT_KEY = "auto-codex.reasoning-effort";
const MOTION_KEY = "auto-codex.animation-enabled";
const SHELL_KEY = "auto-codex.shell";
type LeftPanel = "workspace" | "operations";
type MainView = "pixel" | "results";

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return value.toLocaleString("ko-KR");
}

export default function App() {
  const bridge = useBridge();
  const [shellMode, setShellMode] = useState<"atelier" | "legacy">(() => window.localStorage.getItem(SHELL_KEY) === "legacy" ? "legacy" : "atelier");
  const [page, setPage] = useState<AtelierPage>("home");
  const [designEntry,setDesignEntry]=useState<{entry:Entry;nonce:number}|null>(null);
  const [designTabRequest,setDesignTabRequest]=useState<{tab:Tab;nonce:number}|null>(null);
  const [designTab,setDesignTab]=useState<Tab>('design');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const atelier = shellMode === "atelier";
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  const [prompt, setPrompt] = useState("");
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("workspace");
  const [mainView, setMainView] = useState<MainView>("pixel");
  const [skillMode, setSkillMode] = useState<"auto" | "manual">("auto");
  const [skillPath, setSkillPath] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("team");
  const [pets, setPets] = useState<LoadedPet[]>([]);
  const [petErrors, setPetErrors] = useState<string[]>([]);
  const [petAssignments, setPetAssignments] = useState<PetAssignments>({});
  const [worldCharacterAssignments, setWorldCharacterAssignments] = useState<WorldCharacterAssignments>(loadWorldCharacterAssignments);
  const [promptExpanded, setPromptExpanded] = useState(true);
  const [selectedModel, setSelectedModel] = useState(() => window.localStorage.getItem(MODEL_KEY) || "");
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort | "">(
    () => (window.localStorage.getItem(EFFORT_KEY) as ReasoningEffort | null) || "",
  );
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [motionOverride, setMotionOverride] = useState<boolean | null>(() => {
    const stored = window.localStorage.getItem(MOTION_KEY);
    return stored === "true" ? true : stored === "false" ? false : null;
  });
  const animationEnabled = motionOverride ?? !systemReducedMotion;
  const projectPath = bridge.snapshot.projectPath;
  const workspaceMode = bridge.snapshot.workspaceMode;
  const activeRun = bridge.snapshot.activeRun;
  const teamBusy = Boolean(activeRun && ["planning", "running", "verifying"].includes(activeRun.status));
  const busy = teamBusy || Boolean(bridge.snapshot.turnId) || bridge.turnStatus === "inProgress";
  const ready = bridge.snapshot.connected && bridge.snapshot.appServerReady && (workspaceMode === "research" || Boolean(projectPath));
  const connectionLabel = !bridge.snapshot.connected
    ? "bridge offline"
    : bridge.snapshot.appServerReady
      ? "app-server ready"
      : bridge.snapshot.petState === "error"
        ? "codex unavailable"
        : "codex starting";

  const navigate = (next: AtelierPage) => {
    setPage(next);
    if (next === "work" || next === "settings") setLeftPanel("workspace");
    if (next === "operations") setLeftPanel("operations");
    if (next === "results" || next === "work") setMainView("results");
    if (next === "pixel") setMainView("pixel");
  };
  const openResults = () => { setMainView("results"); if (atelier) navigate("results"); };
  const changeShell = (next: "atelier" | "legacy") => {
    setShellMode(next);
    window.localStorage.setItem(SHELL_KEY, next);
    setMobileMenuOpen(false);
  };
  const showControls = !atelier ? leftPanel === "workspace" : page === "work" || page === "settings";
  const showOperations = !atelier ? leftPanel === "operations" : page === "operations";
  const showWorld = !atelier || page === "work" || page === "pixel" || page === "results";

  useEffect(() => { if (atelier) pageHeading.current?.focus({ preventScroll: true }); }, [page, atelier]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPetCatalog(controller.signal).then((catalog) => {
      setPets(catalog.pets);
      setPetErrors(catalog.errors);
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPetErrors([error instanceof Error ? error.message : String(error)]);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setPetAssignments(loadPetAssignments(projectPath));
  }, [projectPath]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const toggleAnimation = () => {
    const next = !animationEnabled;
    setMotionOverride(next);
    window.localStorage.setItem(MOTION_KEY, String(next));
  };

  useEffect(() => {
    if (bridge.models.length === 0) return;
    const available = bridge.models.find((model) => model.model === selectedModel);
    const next = available ?? bridge.models.find((model) => model.isDefault) ?? bridge.models[0];
    if (!available) {
      setSelectedModel(next.model);
      window.localStorage.setItem(MODEL_KEY, next.model);
    }
    if (selectedEffort && !next.supportedReasoningEfforts.some((item) => item.reasoningEffort === selectedEffort)) {
      setSelectedEffort("");
      window.localStorage.removeItem(EFFORT_KEY);
    }
  }, [bridge.models, selectedEffort, selectedModel]);

  const selectedModelInfo = useMemo(
    () => bridge.models.find((model) => model.model === selectedModel),
    [bridge.models, selectedModel],
  );

  const assignPet = (role: AgentRole, petId: string) => {
    setPetAssignments((current) => {
      const next = { ...current, [role]: petId };
      savePetAssignments(projectPath, next);
      return next;
    });
  };

  const assignWorldCharacter = (role: AgentRole, index: number) => {
    setWorldCharacterAssignments((current) => {
      const next = { ...current, [role]: index };
      saveWorldCharacterAssignments(next);
      return next;
    });
  };

  const changeModel = (model: string) => {
    setSelectedModel(model);
    window.localStorage.setItem(MODEL_KEY, model);
    const modelInfo = bridge.models.find((item) => item.model === model);
    const nextEffort = modelInfo?.defaultReasoningEffort || "";
    setSelectedEffort(nextEffort);
    if (nextEffort) window.localStorage.setItem(EFFORT_KEY, nextEffort);
    else window.localStorage.removeItem(EFFORT_KEY);
  };

  const changeEffort = (effort: ReasoningEffort | "") => {
    setSelectedEffort(effort);
    if (effort) window.localStorage.setItem(EFFORT_KEY, effort);
    else window.localStorage.removeItem(EFFORT_KEY);
  };

  const start = () => {
    if (bridge.startTurn(
      prompt,
      skillMode,
      skillMode === "manual" ? skillPath : undefined,
      executionMode,
      selectedModel || undefined,
      selectedEffort || undefined,
    )) setPrompt("");
  };

  return (
    <div className={atelier ? "atelier-app" : "legacy-frame"} data-page={page}>
    <AtelierNavigation page={page} onNavigate={navigate} mobileOpen={mobileMenuOpen} onMobileClose={closeMobileMenu} onLegacy={() => changeShell("legacy")} hidden={!atelier} designTab={designTab} onDesignTab={tab=>{setDesignTabRequest({tab,nonce:Date.now()});navigate('design');}} />
    <main id="workspace-main" className={`app-shell ${atelier ? "atelier-main" : "metaverse-app"} ${animationEnabled ? "motion-enabled" : "motion-disabled"}`}>
      <a className="atelier-skip-link" href="#workspace-heading" hidden={!atelier}>작업 내용으로 건너뛰기</a>
      <header className="topbar">
        {atelier && <button type="button" className="atelier-menu-toggle" aria-label="작업실 메뉴 열기" aria-haspopup="dialog" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}>☰ 메뉴</button>}
        <a className="brand" href="/" aria-label="Auto Codex 홈" onClick={(event) => { event.preventDefault(); if (atelier) navigate("home"); else { setLeftPanel("workspace"); setMainView("pixel"); } }}>
          <span className="brand-mark">AC</span>
          <span><strong>{atelier ? "나의 작업실" : "AUTO CODEX WORLD"}</strong><small>{atelier ? PAGE_INFO[page].title : "local pixel agent studio"}</small></span>
        </a>
        <div className="topbar-meta">
          <span className="top-model">{selectedModelInfo?.displayName || selectedModel || "Codex model"}{selectedEffort ? ` · ${selectedEffort}` : ""}</span>
          <div className="token-usage-cluster" aria-label="로컬에서 집계한 토큰 사용량">
            <span><small>오늘 토큰</small><strong>{formatTokenCount(bridge.tokenUsage.today)}</strong></span>
            <span><small>7일 토큰</small><strong>{formatTokenCount(bridge.tokenUsage.week)}</strong></span>
          </div>
          <span className={`connection-badge ${bridge.snapshot.appServerReady ? "online" : bridge.snapshot.connected ? "bridge-only" : ""}`}>
            <i /> {connectionLabel}
          </span>
          <span className="local-only">127.0.0.1 · LOCAL ONLY</span>
          {atelier && busy && <button type="button" className="atelier-global-stop" onClick={bridge.interruptTurn}>■ 작업 중단</button>}
        </div>
      </header>
      {!atelier && <div className="atelier-return-bar"><span>기존 Auto-Codex 화면</span><button type="button" onClick={() => changeShell("atelier")}>Atelier 화면으로 돌아가기 →</button></div>}

      {atelier && <div className="atelier-workspace-heading"><div><p className="atelier-kicker">AUTO CODEX / LOCAL WORKSPACE</p><h1 id="workspace-heading" tabIndex={-1} ref={pageHeading}>{PAGE_INFO[page].title}</h1><p>{PAGE_INFO[page].description}</p></div><span className={`atelier-run-indicator ${busy ? "is-active" : ""}`} role="status">{bridge.approvals.length ? `승인 대기 ${bridge.approvals.length}건` : busy ? "작업 진행 중" : "진행 작업 없음"}</span></div>}

      {bridge.lastError && (
        <div className="error-banner" role="alert">
          <span>!</span><p>{bridge.lastError}</p><button onClick={bridge.clearError} aria-label="오류 닫기">×</button>
        </div>
      )}

      {bridge.snapshot.connected && !bridge.snapshot.appServerReady && bridge.snapshot.petState === "error" && (
        <div className="codex-unavailable-banner" role="status">
          <span>브리지는 연결됐지만 Codex App Server를 시작하지 못했습니다.</span>
          <small>현재 서버를 종료한 뒤 탐색기에서 <code>START_AUTO_CODEX.cmd</code>를 실행해 보세요.</small>
        </div>
      )}

      {atelier && page==='home'&&<div className="atelier-introduction"><AtelierHome onNavigate={navigate} conversations={bridge.conversations} busy={busy} onStartDesign={entry=>{setDesignEntry({entry,nonce:Date.now()});navigate('design');}} onSelectConversation={(id) => { if (bridge.selectConversation(id)) navigate("results"); }} /><AtelierNotes connected={bridge.snapshot.connected} appServerReady={bridge.snapshot.appServerReady} busy={busy} awaitingApproval={bridge.approvals.length > 0} projectPath={projectPath} /></div>}
      <AtelierWorkspace aiReady={bridge.snapshot.appServerReady} model={selectedModel||undefined} effort={selectedEffort||undefined} onInterrupt={bridge.interruptTurn} api={bridge.atelierApi} connected={bridge.snapshot.connected} hidden={!atelier||page!=='design'} entryRequest={designEntry} tabRequest={designTabRequest} onTab={setDesignTab}/>

      {atelier && page === "settings" && <section className="atelier-display-settings" aria-labelledby="display-settings-title"><h2 id="display-settings-title">화면 표시</h2><p>화면을 전환해도 현재 입력·실행·대화 연결은 유지됩니다.</p><div><button type="button" onClick={() => changeShell("legacy")}>기존 화면으로 전환 ↗</button><button type="button" aria-pressed={animationEnabled} onClick={toggleAnimation}>캐릭터 애니메이션 {animationEnabled ? "켜짐" : "꺼짐"}</button></div><p><a href="/atelier-assets/LICENSES.md" target="_blank" rel="noreferrer">폰트·아이콘 출처와 라이선스</a></p></section>}

      <div className="metaverse-layout" hidden={atelier && (page === "home" || page === "design")}>
        <div className="left-rail" hidden={!showControls && !showOperations}>
          <nav className="left-rail-switch" aria-label="좌측 패널 선택" role="tablist" hidden={atelier}>
            <button
              type="button"
              role="tab"
              aria-selected={leftPanel === "workspace"}
              className={leftPanel === "workspace" ? "active" : ""}
              onClick={() => setLeftPanel("workspace")}
            >
              <span aria-hidden="true">⌂</span>
              <strong>Workspace</strong>
              <small>프로젝트 설정</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftPanel === "operations"}
              className={leftPanel === "operations" ? "active" : ""}
              onClick={() => setLeftPanel("operations")}
            >
              <span aria-hidden="true">◉</span>
              <strong>Codex 활동 센터</strong>
              <small>LIVE OPERATIONS</small>
            </button>
          </nav>

            <aside className="control-card" hidden={!showControls} aria-label="프로젝트와 실행 설정">
              <ConversationPicker
                conversations={bridge.conversations}
                activeConversationId={bridge.snapshot.activeConversationId}
                disabled={busy}
                onNew={bridge.newConversation}
                onSelect={bridge.selectConversation}
              />
              <ProjectPanel
                currentPath={projectPath}
                workspaceMode={workspaceMode}
                researchNetworkAccess={bridge.snapshot.researchNetworkAccess}
                connected={bridge.snapshot.connected}
                isPicking={bridge.isPickingProject}
                trustStatus={bridge.snapshot.projectTrust}
                isTrusting={bridge.isTrustingProject}
                disabled={busy}
                onSelect={bridge.selectProject}
                onPick={bridge.pickProject}
                onTrust={bridge.trustProject}
                onModeChange={bridge.setWorkspaceMode}
                onNetworkChange={bridge.setResearchNetworkAccess}
              />
              <ModelPicker
                models={bridge.models}
                selectedModel={selectedModel}
                selectedEffort={selectedEffort}
                errors={bridge.modelErrors}
                disabled={busy}
                onModelChange={changeModel}
                onEffortChange={changeEffort}
                onRefresh={bridge.refreshModels}
              />
              {workspaceMode === "project" && (
                <SkillPicker
                  skills={bridge.skills}
                  projectPath={projectPath}
                  mode={skillMode}
                  selectedPath={skillPath}
                  disabled={!projectPath || busy}
                  onModeChange={setSkillMode}
                  onSkillChange={setSkillPath}
                  onRefresh={bridge.refreshSkills}
                />
              )}
              <details className="control-section prompt-section control-collapsible" open={promptExpanded} onToggle={(event) => setPromptExpanded(event.currentTarget.open)}>
                <summary className="section-heading"><div><span className="eyebrow">04 · QUEST</span><h2>업무 지시</h2></div><span className="collapse-glyph" aria-hidden="true">⌄</span></summary>
                <div className="control-section-body">
                  <div className="execution-mode" aria-label="실행 모드">
                  <button type="button" className={executionMode === "team" ? "active" : ""} onClick={() => setExecutionMode("team")} disabled={busy}>
                    <strong>TEAM AUTO</strong><span>역할 분배 · 안전한 병렬</span>
                  </button>
                  <button type="button" className={executionMode === "solo" ? "active" : ""} onClick={() => setExecutionMode("solo")} disabled={busy}>
                    <strong>SOLO</strong><span>하나의 Codex 작업</span>
                  </button>
                  </div>
                  <label className="prompt-field">
                  <textarea
                    aria-label="Codex 업무 지시"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && ready && !busy) start();
                    }}
                    placeholder={workspaceMode === "research" ? "예: 오늘 미국 증시와 주요 종목 흐름을 출처와 함께 정리해줘" : "예: 로그인 화면을 만들고 테스트까지 실행해줘"}
                    disabled={busy}
                    rows={5}
                  />
                  <span>Ctrl + Enter</span>
                  </label>
                  {busy ? (
                  <button className="stop-button" type="button" onClick={bridge.interruptTurn}><span>■</span> 작업 중단</button>
                ) : (
                  <button className="run-button" type="button" onClick={start} disabled={!ready || !prompt.trim()}>
                    <span>▶</span> {executionMode === "team" ? "팀에게 맡기기" : "Codex에게 맡기기"}
                  </button>
                  )}
                  {bridge.skillErrors.length > 0 && <p className="inline-warning">스킬 {bridge.skillErrors.length}개를 불러오지 못했습니다.</p>}
                  {petErrors.length > 0 && <p className="inline-warning">펫 {petErrors.length}개를 불러오지 못했습니다.</p>}
                </div>
              </details>
            </aside>
          <div className="atelier-operations-slot" hidden={!showOperations}>
            <OperationsPanel
              activities={bridge.activities}
              run={activeRun}
              assistantText={bridge.assistantText}
              taskOutputs={bridge.taskOutputs}
              characterAssignments={worldCharacterAssignments}
              animationEnabled={animationEnabled}
              streaming={busy}
              onOpenResults={openResults}
            />
          </div>
        </div>

        <div className="world-column" hidden={!showWorld}>
          <div className="main-view-switch" role="tablist" aria-label="메인 화면 선택">
            <button type="button" role="tab" aria-selected={mainView === "pixel"} className={mainView === "pixel" ? "active" : ""} onClick={() => atelier ? navigate("pixel") : setMainView("pixel")}>▦ 픽셀 화면</button>
            <button type="button" role="tab" aria-selected={mainView === "results"} className={mainView === "results" ? "active" : ""} onClick={() => atelier ? navigate("results") : setMainView("results")}>▤ 결과 화면</button>
          </div>
          <div hidden={mainView !== "pixel"}>
            <PixelOffice
              run={activeRun}
              bridgeConnected={bridge.snapshot.connected}
              appServerReady={bridge.snapshot.appServerReady}
              pets={pets}
              petAssignments={petAssignments}
              soloState={bridge.snapshot.petState}
              activeRole={bridge.snapshot.activeRole}
              modelLabel={selectedModelInfo?.displayName || selectedModel || "App Server default"}
              onAssignPet={assignPet}
              characterAssignments={worldCharacterAssignments}
              onAssignCharacter={assignWorldCharacter}
              animationEnabled={animationEnabled}
              onToggleAnimation={toggleAnimation}
              onOpenResults={openResults}
            />
          </div>
          <div hidden={mainView !== "results"}>
            <ResultView
              messages={bridge.messages}
              conversationTitle={bridge.conversations.find((conversation) => conversation.id === bridge.snapshot.activeConversationId)?.title || "새 대화"}
              conversationId={bridge.snapshot.activeConversationId}
              run={activeRun}
              assistantText={bridge.assistantText}
              taskOutputs={bridge.taskOutputs}
            />
          </div>
        </div>

      </div>

      <footer><span>Auto Codex · local-first</span><span>애니메이션은 시스템 설정과 애니메이션 토글을 따르며, 상태·이동은 실제 App Server 이벤트를 반영합니다.</span></footer>
      {bridge.approvals[0] && (
        <ApprovalDialog approval={bridge.approvals[0]} onResolve={(decision) => bridge.resolveApproval(bridge.approvals[0].approvalId, decision)} />
      )}
    </main>
    </div>
  );
}
