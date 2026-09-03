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
              {conversation.title} · {shortId(conversation.id)}
            </option>
          ))}
        </select>
      </label>
      <p>새 대화는 새 ID로 시작하고, 목록에서 이전 대화를 선택하면 해당 맥락으로 이어집니다.</p>
    </section>
  );
}
