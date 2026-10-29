import { useState } from "react";
import type { AgentRole, ConversationMessage, RunSnapshot } from "../../shared/protocol";
import { ResultText } from "./ResultText";

type Props = {
  conversationTitle: string;
  conversationId: string;
  run: RunSnapshot | null;
  assistantText: string;
  taskOutputs: Record<string, string>;
  messages: ConversationMessage[];
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

export function ResultView({ conversationTitle, conversationId, run, assistantText, taskOutputs, messages }: Props) {
  const [copied, setCopied] = useState(false);
  const latestReply = messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined;
  const outputs = run?.tasks.map((task) => ({
    task,
    text: taskOutputs[task.id] || task.resultSummary || task.error || "",
  })).filter((entry) => entry.text) ?? [];
  const copyText = [assistantText || latestReply?.text, ...outputs.map(({ task, text }) => `${task.title}\n${text}`)].filter(Boolean).join("\n\n");

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
        {messages.filter((message, index) => message.role === "user" || index < messages.length - 1).map((message) => (
          <article className={`large-result-card conversation-message ${message.role}`} key={message.id}>
            <header><span>{message.role === "user" ? "↗" : "✦"}</span><div><strong>{message.role === "user" ? "내 요청" : "Codex 답변"}</strong><small>{new Date(message.timestamp).toLocaleString("ko-KR")}{message.status === "interrupted" ? " · 중단됨" : message.status === "failed" ? " · 실패" : ""}</small></div></header>
            <ResultText title={message.role === "user" ? "내 요청" : "Codex 답변"} text={message.text || "응답이 기록되기 전에 종료되었습니다."} />
            {message.run && <details className="conversation-task-history"><summary>이 요청의 작업 내역 · {message.run.tasks.length}개 · {message.run.status}</summary>
              {message.run.tasks.map((task) => <section key={task.id}><h3>{task.title} · {task.status}</h3><ResultText title={task.title} text={message.taskOutputs?.[task.id] || task.resultSummary || task.error || "기록된 결과 없음"} /></section>)}
            </details>}
          </article>
        ))}
        {(assistantText || latestReply) && (
          <article className="large-result-card primary-result">
            <header><span>★</span><div><strong>최근 응답</strong><small>{messages.at(-1)?.status === "interrupted" ? "앱 종료로 중단됨 · 다음 요청으로 이어갈 수 있습니다" : run?.status === "completed" ? "Codex 결과" : "작성 중 또는 마지막 결과"}</small></div></header>
            <ResultText title="최근 응답" text={assistantText || latestReply?.text || (latestReply?.status === "streaming" ? "응답을 기다리는 중입니다." : "응답이 기록되기 전에 종료되었습니다. 다음 요청으로 이어갈 수 있습니다.")} />
          </article>
        )}
        {outputs.map(({ task, text }) => (
          <article className="large-result-card" key={task.id}>
            <header><span>{task.status === "completed" ? "✓" : task.status === "failed" ? "!" : "…"}</span><div><strong>{task.title}</strong><small>{ROLE_LABELS[task.agentRole]} · {task.status}</small></div></header>
            <ResultText title={task.title} text={text} />
          </article>
        ))}
        {messages.length === 0 && !assistantText && outputs.length === 0 && (
          <div className="large-result-empty"><span>▤</span><strong>아직 결과가 없습니다</strong><p>작업을 실행하면 최종 응답과 작업별 결과가 이 화면에 표시됩니다.</p></div>
        )}
      </div>
    </section>
  );
}
