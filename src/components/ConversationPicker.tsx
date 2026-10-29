import type { ConversationSummary } from "../../shared/protocol";

type Props = {
  conversations: ConversationSummary[];
  activeConversationId: string;
  disabled: boolean;
  onNew: () => void;
  onSelect: (conversationId: string) => void;
};

function shortId(id: string): string {
  return id ? id.slice(0, 8) : "--------";
}

export function ConversationPicker({ conversations, activeConversationId, disabled, onNew, onSelect }: Props) {
  const active = conversations.find((conversation) => conversation.id === activeConversationId);
  return (
    <section className="conversation-picker" aria-label="대화 선택">
      <div className="conversation-picker-heading">
        <div>
          <span className="eyebrow">CONVERSATIONS</span>
          <strong>{active?.title || "새 대화"}</strong>
          <small>ID {shortId(activeConversationId)}</small>
        </div>
        <button type="button" onClick={onNew} disabled={disabled}>＋ 새 대화</button>
      </div>
      <label className="conversation-select-label">
        <span>이전 대화 이어가기</span>
        <select value={activeConversationId} onChange={(event) => onSelect(event.target.value)} disabled={disabled}>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.projectPath?.split(/[\\/]/).at(-1) || (conversation.workspaceMode === "research" ? "조사" : "미연결")} · {conversation.title} · {shortId(conversation.id)}
            </option>
          ))}
        </select>
      </label>
      {active?.preview && <p className="conversation-preview">{active.preview}</p>}
      <p>대화와 작업 내역은 이 PC에 자동 저장됩니다. 앱을 다시 켜거나 프로젝트를 바꿔도 목록에서 이어갈 수 있습니다.</p>
    </section>
  );
}
