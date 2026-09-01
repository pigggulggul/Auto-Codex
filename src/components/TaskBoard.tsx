import type { RunSnapshot, TaskStatus } from "../../shared/protocol";

const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "대기",
  ready: "실행 준비",
  running: "진행 중",
  waitingApproval: "승인 대기",
  completed: "완료",
  failed: "실패",
  blocked: "차단",
  interrupted: "중단",
};

const STATUS_ICONS: Record<TaskStatus, string> = {
  queued: "·",
  ready: "▷",
  running: "▶",
  waitingApproval: "!",
  completed: "✓",
  failed: "×",
  blocked: "—",
  interrupted: "■",
};

export function TaskBoard({ run }: { run: RunSnapshot }) {
  const completed = run.tasks.filter((task) => task.status === "completed").length;
  const percent = Math.round((completed / Math.max(run.tasks.length, 1)) * 100);
  return (
    <section className="task-board">
      <div className="task-board-heading">
        <div><span className="eyebrow">TEAM EXECUTION MAP</span><h2>작업 순서와 담당 역할</h2></div>
        <div className="run-progress"><span><i style={{ width: `${percent}%` }} /></span><strong>{percent}%</strong></div>
      </div>
      <div className="task-lanes">
        {[...run.tasks].sort((a, b) => a.order - b.order).map((task, index) => (
          <article className={`task-node task-${task.status}`} key={task.id}>
            <div className="task-node-top">
              <span className="task-order">{String(index + 1).padStart(2, "0")}</span>
              <span className={`task-status status-${task.status}`}>{STATUS_ICONS[task.status]} {STATUS_LABELS[task.status]}</span>
            </div>
            <strong>{task.title}</strong>
            <p>{task.description}</p>
            <div className="task-meta">
              <span>{task.agentRole}</span>
              <span className={`access-${task.access}`}>{task.access === "read" ? "READ ONLY" : "WORKSPACE WRITE"}</span>
            </div>
            {task.dependsOn.length > 0 && <small>← {task.dependsOn.join(", ")}</small>}
            {task.error && <em>{task.error}</em>}
          </article>
        ))}
      </div>
    </section>
  );
}
