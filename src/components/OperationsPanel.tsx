import { useMemo, useState } from "react";
import type { ActivityEvent, AgentRole, RunSnapshot } from "../../shared/protocol";
import { PET_PRESENTATIONS } from "../lib/petCatalog";
import { characterIndexForRole, type WorldCharacterAssignments } from "../lib/worldCharacters";
import { WorldCharacter } from "./WorldCharacter";

type PanelTab = "activity" | "results" | "quests";

type Props = {
  activities: ActivityEvent[];
  run: RunSnapshot | null;
  assistantText: string;
  taskOutputs: Record<string, string>;
  characterAssignments: WorldCharacterAssignments;
  animationEnabled?: boolean;
  streaming: boolean;
  onOpenResults?: () => void;
};

const ROLE_LABELS: Record<AgentRole, string> = {
  coordinator: "Coordinator",
  general: "Generalist",
  builder: "Builder",
  researcher: "Researcher",
  documenter: "Documenter",
  visual: "Visual Designer",
  qa: "QA Inspector",
  integrator: "Integrator",
};

function roleForActivity(activity: ActivityEvent, run: RunSnapshot | null): AgentRole {
  const byAgent = run?.agents.find((agent) => agent.id === activity.agentId);
  if (byAgent) return byAgent.role;
  return run?.tasks.find((task) => task.id === activity.taskId)?.agentRole ?? "general";
}

function timeLabel(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? timestamp
    : parsed.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function OperationsPanel({ activities, run, assistantText, taskOutputs, characterAssignments, animationEnabled = true, streaming, onOpenResults }: Props) {
  const [tab, setTab] = useState<PanelTab>("activity");
  const outputs = useMemo(() => run?.tasks.map((task) => ({
    task,
    text: taskOutputs[task.id] || task.resultSummary || task.error || "",
  })).filter((entry) => entry.text) ?? [], [run, taskOutputs]);
  const completed = run?.tasks.filter((task) => task.status === "completed").length ?? 0;

  return (
    <aside className="operations-panel">
      <div className="operations-heading">
        <div><span className="eyebrow">LIVE OPERATIONS</span><h2>Codex 활동 센터</h2></div>
        <span className={`runtime-pulse ${streaming ? "active" : ""}`}>{streaming ? "RUNNING" : "READY"}</span>
      </div>

      <div className="operations-tabs" role="tablist" aria-label="실행 정보">
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><span>◉</span> 활동</button>
        <button type="button" role="tab" aria-selected={tab === "results"} className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}><span>▤</span> 결과</button>
        <button type="button" role="tab" aria-selected={tab === "quests"} className={tab === "quests" ? "active" : ""} onClick={() => setTab("quests")}><span>◆</span> 퀘스트</button>
      </div>

      <div className="operations-content">
        {tab === "activity" && (
          <div className="activity-feed">
            {activities.length === 0 ? (
              <div className="panel-empty"><span>☕</span><strong>모두 쉬는 중이에요</strong><small>실제 App Server 이벤트가 오면 이곳에 표시됩니다.</small></div>
            ) : activities.map((activity) => {
              const role = roleForActivity(activity, run);
              const spriteIndex = characterIndexForRole(role, characterAssignments);
              return (
                <article className={`activity-card state-${activity.state}`} key={activity.id}>
                  <div className="activity-face"><WorldCharacter spriteIndex={spriteIndex} state={activity.state} size={64} animated={animationEnabled} /></div>
                  <div className="activity-copy">
                    <div><strong>{ROLE_LABELS[role]}</strong><time>{timeLabel(activity.timestamp)}</time></div>
                    <h3>{activity.title}</h3>
                    <p>{activity.detail || PET_PRESENTATIONS[activity.state].verb}</p>
                    <span className="activity-source">{activity.source.includes("bridge") ? "BRIDGE" : "CODEX"} · {PET_PRESENTATIONS[activity.state].label}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {tab === "results" && (
          <div className="result-feed">
            {assistantText && (
              <article className="result-card primary-result">
                <header><span>★</span><div><strong>최종 응답</strong><small>{streaming ? "Codex가 작성 중" : "Codex 결과"}</small></div>{onOpenResults && <button type="button" className="result-expand-button" onClick={onOpenResults}>크게 보기</button>}</header>
                <pre>{assistantText}</pre>
              </article>
            )}
            {outputs.map(({ task, text: output }) => (
              <article className="result-card" key={task.id}>
                <header><span>{task.status === "completed" ? "✓" : task.status === "failed" ? "!" : "…"}</span><div><strong>{task.title}</strong><small>{ROLE_LABELS[task.agentRole]} · {task.status}</small></div></header>
                <pre>{output}</pre>
              </article>
            ))}
            {!assistantText && outputs.length === 0 && (
              <div className="panel-empty"><span>▤</span><strong>아직 결과가 없어요</strong><small>완료된 에이전트의 응답과 최종 결과를 여기서 확인할 수 있습니다.</small></div>
            )}
          </div>
        )}

        {tab === "quests" && (
          <div className="quest-feed">
            <div className="quest-progress"><div><strong>{run?.status.toUpperCase() || "NO RUN"}</strong><span>{completed}/{run?.tasks.length ?? 0}</span></div><i><b style={{ width: run?.tasks.length ? `${(completed / run.tasks.length) * 100}%` : "0%" }} /></i></div>
            {run ? run.tasks.map((task, index) => (
              <article className={`quest-card status-${task.status}`} key={task.id}>
                <span className="quest-index">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{task.title}</strong><small>{ROLE_LABELS[task.agentRole]} · {task.access.toUpperCase()}</small>{task.dependsOn.length > 0 && <em>← {task.dependsOn.join(", ")}</em>}</div>
                <span className="quest-status">{task.status}</span>
              </article>
            )) : <div className="panel-empty"><span>◆</span><strong>퀘스트를 기다리는 중</strong><small>팀 작업을 시작하면 DAG 순서와 담당 캐릭터가 표시됩니다.</small></div>}
          </div>
        )}
      </div>
    </aside>
  );
}
