import type { ActivityEvent } from "../../shared/protocol";

const STATE_ICONS: Record<ActivityEvent["state"], string> = {
  idle: "○",
  connecting: "↻",
  thinking: "✦",
  reading: "⌕",
  editing: "✎",
  running: "›_",
  waitingApproval: "!",
  success: "✓",
  error: "×",
};

export function ActivityTimeline({ activities }: { activities: ActivityEvent[] }) {
  return (
    <section className="timeline-card">
      <div className="timeline-heading">
        <div><span className="eyebrow">LIVE FEED</span><h2>에이전트 활동</h2></div>
        <span className="event-count">{activities.length} events</span>
      </div>
      <div className="timeline-list">
        {activities.length === 0 ? (
          <div className="empty-timeline"><span>✦</span><p>업무를 시작하면 실제 Codex 이벤트가 여기에 나타납니다.</p></div>
        ) : activities.map((activity, index) => (
          <article className="timeline-event" key={activity.id}>
            <div className={`event-icon state-${activity.state}`}>{STATE_ICONS[activity.state]}</div>
            <div className="event-copy">
              <div><strong>{activity.title}</strong><time>{new Date(activity.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>
              {activity.detail && <p>{activity.detail}</p>}
              <small>{activity.taskId ? `${activity.taskId} · ` : ""}{activity.source}</small>
            </div>
            {index === 0 && <span className="latest-marker">LIVE</span>}
          </article>
        ))}
      </div>
    </section>
  );
}

