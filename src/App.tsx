import { useEffect, useMemo, useState } from "react";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { PetStage } from "./components/PetStage";
import { PixelOffice } from "./components/PixelOffice";
import { ProjectPanel } from "./components/ProjectPanel";
import { ResponsePanel } from "./components/ResponsePanel";
import { SkillPicker } from "./components/SkillPicker";
import { TaskBoard } from "./components/TaskBoard";
import { useBridge } from "./hooks/useBridge";
import type { ExecutionMode, SkillRole } from "../shared/protocol";
import {
  characterForSelection,
  emptyCharacterAssignments,
  loadCharacterAssignments,
  saveCharacterAssignments,
  type CharacterId,
  type CharacterAssignments,
} from "./lib/characterCatalog";

export default function App() {
  const bridge = useBridge();
  const [prompt, setPrompt] = useState("");
  const [skillMode, setSkillMode] = useState<"auto" | "manual">("auto");
  const [skillPath, setSkillPath] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("team");
  const [characterAssignments, setCharacterAssignments] = useState<CharacterAssignments>(emptyCharacterAssignments);
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
    setCharacterAssignments(loadCharacterAssignments(projectPath));
  }, [projectPath]);

  const updateSkillCharacter = (path: string, character: CharacterId) => {
    setCharacterAssignments((current) => {
      const next = { roles: { ...current.roles }, skills: { ...current.skills, [path]: character } };
      saveCharacterAssignments(projectPath, next);
      return next;
    });
  };

  const updateRoleCharacter = (role: SkillRole, character: CharacterId) => {
    setCharacterAssignments((current) => {
      const next = { roles: { ...current.roles, [role]: character }, skills: { ...current.skills } };
      saveCharacterAssignments(projectPath, next);
      return next;
    });
  };

  const activeCharacter = characterForSelection(bridge.snapshot.selectedSkill, bridge.snapshot.activeRole, characterAssignments);
  const latestDetail = useMemo(
    () => bridge.activities[0]?.detail || bridge.activities[0]?.title || bridge.skillRationale,
    [bridge.activities, bridge.skillRationale],
  );

  const start = () => {
    if (bridge.startTurn(prompt, skillMode, skillMode === "manual" ? skillPath : undefined, executionMode)) setPrompt("");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Auto Codex 홈">
          <span className="brand-mark">AC</span>
          <span><strong>AUTO CODEX</strong><small>local agent studio</small></span>
        </a>
        <div className="topbar-meta">
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

      <div className="dashboard-grid">
        {executionMode === "team" || activeRun ? (
          <PixelOffice
            run={activeRun}
            bridgeConnected={bridge.snapshot.connected}
            appServerReady={bridge.snapshot.appServerReady}
          />
        ) : (
          <PetStage
            state={bridge.snapshot.petState}
            skill={bridge.snapshot.selectedSkill}
            role={bridge.snapshot.activeRole}
            characterId={activeCharacter}
            bridgeConnected={bridge.snapshot.connected}
            appServerReady={bridge.snapshot.appServerReady}
            latestDetail={latestDetail}
          />
        )}

        <aside className="control-card">
          <ProjectPanel
            currentPath={bridge.snapshot.projectPath}
            connected={bridge.snapshot.connected}
            isPicking={bridge.isPickingProject}
            trustStatus={bridge.snapshot.projectTrust}
            isTrusting={bridge.isTrustingProject}
            disabled={busy}
            onSelect={bridge.selectProject}
            onPick={bridge.pickProject}
            onTrust={bridge.trustProject}
          />
          <SkillPicker
            skills={bridge.skills}
            projectPath={projectPath}
            mode={skillMode}
            selectedPath={skillPath}
            disabled={!bridge.snapshot.projectPath || busy}
            onModeChange={setSkillMode}
            onSkillChange={setSkillPath}
            characterAssignments={characterAssignments}
            onSkillCharacterChange={updateSkillCharacter}
            onRoleCharacterChange={updateRoleCharacter}
            onRefresh={bridge.refreshSkills}
          />
          <div className="control-section prompt-section">
            <div className="section-heading"><div><span className="eyebrow">03 · ASSIGNMENT</span><h2>업무 지시</h2></div></div>
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
          </div>
        </aside>

        {activeRun && <TaskBoard run={activeRun} />}

        <ResponsePanel text={bridge.assistantText} streaming={busy} />
        <ActivityTimeline activities={bridge.activities} />
      </div>

      <footer><span>Auto Codex · local-first</span><span>실제 App Server 이벤트만 시각화합니다.</span></footer>
      {bridge.approvals[0] && (
        <ApprovalDialog approval={bridge.approvals[0]} onResolve={(decision) => bridge.resolveApproval(bridge.approvals[0].approvalId, decision)} />
      )}
    </main>
  );
}
