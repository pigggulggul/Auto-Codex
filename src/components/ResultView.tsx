import { useState } from "react";
import type { AgentRole, RunSnapshot } from "../../shared/protocol";

type Props = {
  conversationTitle: string;
  conversationId: string;
  run: RunSnapshot | null;
  assistantText: string;
  taskOutputs: Record<string, string>;
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

export function ResultView({ conversationTitle, conversationId, run, assistantText, taskOutputs }: Props) {
  const [copied, setCopied] = useState(false);
  const outputs = run?.tasks.map((task) => ({
    task,
    text: taskOutputs[task.id] || task.resultSummary || task.error || "",
  })).filter((entry) => entry.text) ?? [];
  const copyText = [assistantText, ...outputs.map(({ task, text }) => `${task.title}\n${text}`)].filter(Boolean).join("\n\n");

  const copy = async () => {
    if (!copyText || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="large-result-view" aria-label="큰 결과 화면">
      <header className="large-result-heading">
        <div>
          <span className="eyebrow">CONVERSATION RESULT</span>
          <h2>{conversationTitle || "새 대화"}</h2>
          <p>ID {conversationId.slice(0, 8) || "--------"} · 결과와 작업별 응답을 크게 표시합니다.</p>
        </div>
        <button type="button" className="large-result-copy" onClick={() => void copy()} disabled={!copyText}>{copied ? "복사됨" : "결과 복사"}</button>
      </header>

      <div className="large-result-content">
        {assistantText && (
          <article className="large-result-card primary-result">
            <header><span>★</span><div><strong>최종 응답</strong><small>{run?.status === "completed" ? "Codex 결과" : "작성 중 또는 마지막 결과"}</small></div></header>
            <pre>{assistantText}</pre>
          </article>
        )}
        {outputs.map(({ task, text }) => (
          <article className="large-result-card" key={task.id}>
            <header><span>{task.status === "completed" ? "✓" : task.status === "failed" ? "!" : "…"}</span><div><strong>{task.title}</strong><small>{ROLE_LABELS[task.agentRole]} · {task.status}</small></div></header>
            <pre>{text}</pre>
          </article>
        ))}
        {!assistantText && outputs.length === 0 && (
          <div className="large-result-empty"><span>▤</span><strong>아직 결과가 없습니다</strong><p>작업을 실행하면 최종 응답과 작업별 결과가 이 화면에 표시됩니다.</p></div>
        )}
      </div>
    </section>
  );
}
