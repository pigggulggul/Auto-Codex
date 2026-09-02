import { useEffect, useMemo, useState } from "react";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { ModelPicker } from "./components/ModelPicker";
import { OperationsPanel } from "./components/OperationsPanel";
import { PixelOffice } from "./components/PixelOffice";
import { ProjectPanel } from "./components/ProjectPanel";
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
type LeftPanel = "workspace" | "operations";

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return value.toLocaleString("ko-KR");
}

export default function App() {
  const bridge = useBridge();
  const [prompt, setPrompt] = useState("");
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("workspace");
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
  const projectPath = bridge.snapshot.projectPath;
  const activeRun = bridge.snapshot.activeRun;
  const teamBusy = Boolean(activeRun && ["planning", "running", "verifying"].includes(activeRun.status));
  const busy = teamBusy || Boolean(bridge.snapshot.turnId) || bridge.turnStatus === "inProgress";
  const ready = bridge.snapshot.connected && bridge.snapshot.appServerReady && Boolean(projectPath);
  const connectionLabel = !bridge.snapshot.connected
    ? "bridge offline"
    : bridge.snapshot.appServerReady
      ? "app-server ready"
      : bridge.snapshot.petState === "error"
        ? "codex unavailable"
        : "codex starting";

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
    <main className="app-shell metaverse-app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Auto Codex 홈">
          <span className="brand-mark">AC</span>
          <span><strong>AUTO CODEX WORLD</strong><small>local pixel agent studio</small></span>
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
        </div>
      </header>

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

      <div className="metaverse-layout">
        <div className="left-rail">
          <nav className="left-rail-switch" aria-label="좌측 패널 선택" role="tablist">
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

          {leftPanel === "workspace" ? (
            <aside className="control-card">
              <ProjectPanel
                currentPath={projectPath}
                connected={bridge.snapshot.connected}
                isPicking={bridge.isPickingProject}
                trustStatus={bridge.snapshot.projectTrust}
                isTrusting={bridge.isTrustingProject}
                disabled={busy}
                onSelect={bridge.selectProject}
                onPick={bridge.pickProject}
                onTrust={bridge.trustProject}
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
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && ready && !busy) start();
                    }}
                    placeholder="예: 로그인 화면을 만들고 테스트까지 실행해줘"
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
          ) : (
            <OperationsPanel
              activities={bridge.activities}
              run={activeRun}
              assistantText={bridge.assistantText}
              taskOutputs={bridge.taskOutputs}
              characterAssignments={worldCharacterAssignments}
              streaming={busy}
            />
          )}
        </div>

        <div className="world-column">
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
          />
        </div>

      </div>

      <footer><span>Auto Codex · local-first</span><span>애니메이션은 실제 App Server 이벤트에서만 상태가 바뀝니다.</span></footer>
      {bridge.approvals[0] && (
        <ApprovalDialog approval={bridge.approvals[0]} onResolve={(decision) => bridge.resolveApproval(bridge.approvals[0].approvalId, decision)} />
      )}
    </main>
  );
}
