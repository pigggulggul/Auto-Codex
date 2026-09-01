export function ResponsePanel({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <section className="response-card" aria-live="polite">
      <div className="response-heading">
        <div>
          <span className="eyebrow">CODEX RESPONSE</span>
          <h2>Codex 답변</h2>
        </div>
        {streaming && <span className="response-status"><i /> STREAMING</span>}
      </div>
      {text ? (
        <pre className="response-body">{text}</pre>
      ) : (
        <div className="response-empty">
          <span>✦</span>
          <p>업무를 시작하면 Codex의 답변이 여기에 표시됩니다.</p>
        </div>
      )}
    </section>
  );
}
