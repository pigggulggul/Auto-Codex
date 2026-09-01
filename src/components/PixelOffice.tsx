import type { AgentRole, AgentSnapshot, PetState, RunSnapshot } from "../../shared/protocol";

type Props = {
  run: RunSnapshot | null;
  bridgeConnected: boolean;
  appServerReady: boolean;
};

const ROLE_LABELS: Record<AgentRole, string> = {
  coordinator: "Coordinator",
  general: "Generalist",
  builder: "Builder",
  researcher: "Researcher",
  documenter: "Documenter",
  visual: "Pixel Designer",
  qa: "QA Inspector",
  integrator: "Integrator",
};

const ACTIVITY_LABELS: Record<PetState, string> = {
  idle: "대기 중",
  connecting: "연결 중",
  thinking: "분석 중",
  reading: "자료 확인 중",
  editing: "파일 수정 중",
  running: "도구 실행 중",
  waitingApproval: "승인 대기",
  success: "업무 완료",
  error: "확인 필요",
};

const PREVIEW_AGENTS: AgentSnapshot[] = [
  { id: "preview-coordinator", role: "coordinator", name: "Coordinator", status: "idle", activity: "idle", taskIds: [], currentTaskId: null, threadId: null, turnId: null },
  { id: "preview-researcher", role: "researcher", name: "Researcher", status: "idle", activity: "idle", taskIds: [], currentTaskId: null, threadId: null, turnId: null },
  { id: "preview-builder", role: "builder", name: "Builder", status: "idle", activity: "idle", taskIds: [], currentTaskId: null, threadId: null, turnId: null },
  { id: "preview-visual", role: "visual", name: "Pixel Designer", status: "idle", activity: "idle", taskIds: [], currentTaskId: null, threadId: null, turnId: null },
  { id: "preview-qa", role: "qa", name: "QA Inspector", status: "idle", activity: "idle", taskIds: [], currentTaskId: null, threadId: null, turnId: null },
];

function PixelAvatar({ agent }: { agent: AgentSnapshot }) {
  return (
    <div className={`pixel-avatar role-${agent.role} activity-${agent.activity}`} aria-label={`${ROLE_LABELS[agent.role]} ${ACTIVITY_LABELS[agent.activity]}`}>
      <span className="pixel-shadow" />
      <span className="pixel-hair" />
      <span className="pixel-head"><i className="pixel-eye eye-left" /><i className="pixel-eye eye-right" /></span>
      <span className="pixel-body" />
      <span className="pixel-arm arm-left" /><span className="pixel-arm arm-right" />
      <span className="pixel-leg leg-left" /><span className="pixel-leg leg-right" />
      {agent.activity === "waitingApproval" && <b className="pixel-alert">!</b>}
    </div>
  );
}

export function PixelOffice({ run, bridgeConnected, appServerReady }: Props) {
  const agents = run?.agents.length ? run.agents : PREVIEW_AGENTS;
  const completed = run?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const currentTask = (agent: AgentSnapshot) => run?.tasks.find((task) => task.id === agent.currentTaskId)
    ?? run?.tasks.find((task) => task.agentId === agent.id && task.status === "ready")
    ?? null;

  return (
    <section className="pixel-office" aria-live="polite">
      <div className="pixel-office-toolbar">
        <div>
          <span className={`pixel-signal ${appServerReady ? "online" : bridgeConnected ? "bridge" : ""}`} />
          <strong>AGENT TOWN · LOCAL OFFICE</strong>
        </div>
        <span>{run ? `${completed}/${run.tasks.length} TASKS · ${run.status.toUpperCase()}` : "TEAM AUTO READY"}</span>
      </div>

      <div className="pixel-room">
        <div className="pixel-wall-grid" />
        <div className="pixel-window"><i /><i /><i /><i /></div>
        <div className="pixel-clock"><i /></div>
        <div className="pixel-board">
          <strong>{run ? "TODAY'S QUEST" : "WELCOME!"}</strong>
          <span>{run?.prompt || "업무를 맡기면 역할과 순서를 자동으로 정해요."}</span>
        </div>
        <div className="pixel-plant"><i /><b /></div>

        <div className="pixel-stations">
          {agents.map((agent) => {
            const task = currentTask(agent);
            return (
              <article className={`pixel-station status-${agent.status}`} key={agent.id}>
                <div className="pixel-speech">
                  <strong>{task?.title || (agent.role === "coordinator" ? "업무를 기다리는 중" : "대기석")}</strong>
                  <span>{ACTIVITY_LABELS[agent.activity]}</span>
                </div>
                <div className="pixel-desk"><i className="desk-screen" /><i className="desk-keyboard" /></div>
                <PixelAvatar agent={agent} />
                <div className="pixel-nameplate">
                  <strong>{ROLE_LABELS[agent.role]}</strong>
                  <span>{agent.status}</span>
                </div>
              </article>
            );
          })}
        </div>
        <div className="pixel-floor" />
      </div>

      <div className="pixel-trust-strip">
        <span>● 실제 App Server 이벤트</span>
        <span>▦ 읽기 작업 최대 3개 병렬</span>
        <span>■ 쓰기 작업 단독 실행</span>
      </div>
    </section>
  );
}
