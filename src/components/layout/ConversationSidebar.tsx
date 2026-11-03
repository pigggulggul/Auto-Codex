import {useMemo,useState} from "react";
import type {ConversationSummary} from "../../../shared/protocol";

type Props = {
  conversations: ConversationSummary[];
  activeConversationId: string;
  disabled: boolean;
  isPicking: boolean;
  onNewResearch: () => void;
  onPickProject: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
};

export function groupConversations(conversations: ConversationSummary[]) {
  const groups = new Map<string, {key:string; label:string; path?:string; conversations:ConversationSummary[]}>();
  for (const conversation of conversations) {
    const path = conversation.workspaceMode === "research" ? undefined : conversation.projectPath || undefined;
    const key = conversation.workspaceMode === "research" ? "research" : path ? `project:${path}` : "unconnected";
    const label = key === "research" ? "조사 대화" : path ? path.split(/[\\/]/).filter(Boolean).at(-1) || path : "폴더 미연결";
    const group = groups.get(key) ?? {key, label, path, conversations:[]};
    group.conversations.push(conversation);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({...group, conversations:group.conversations.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}))
    .sort((a,b)=>b.conversations[0].updatedAt.localeCompare(a.conversations[0].updatedAt));
}

export function ConversationSidebar({conversations,activeConversationId,disabled,isPicking,onNewResearch,onPickProject,onSelect,onDelete}:Props) {
  const [query,setQuery] = useState("");
  const [deleting,setDeleting] = useState(false);
  const [error,setError] = useState("");
  const remove = async (item:ConversationSummary) => {
    if (!window.confirm(`“${item.title}” 대화를 이 앱의 로컬 기록에서 삭제할까요? 삭제된 대화는 복구할 수 없습니다. 프로젝트 파일과 Codex 원본 기록은 삭제하지 않습니다.`)) return;
    setError("");setDeleting(true);try { await onDelete(item.id); } catch (e) { setError(e instanceof Error ? e.message : "삭제 결과를 확인하지 못했습니다."); } finally { setDeleting(false); }
  };
  const groups = useMemo(()=>groupConversations(conversations),[conversations]);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = groups.map(group => {
    const groupMatch = `${group.label} ${group.path || ""}`.toLocaleLowerCase().includes(normalized);
    return {...group, conversations:groupMatch ? group.conversations : group.conversations.filter(item=>item.title.toLocaleLowerCase().includes(normalized))};
  }).filter(group=>group.conversations.length);
  return <section className="chat-sidebar" aria-label="대화와 프로젝트">
    <button type="button" className="chat-new" disabled={disabled || deleting} onClick={onNewResearch}>✎ 새 채팅 <small>조사 모드</small></button>
    <div className="chat-sidebar-heading"><strong>프로젝트</strong><button type="button" disabled={disabled || deleting || isPicking} onClick={onPickProject} aria-label="프로젝트 폴더 추가">{isPicking ? "선택 중…" : "+ 폴더"}</button></div>
    <label className="chat-search"><span className="chat-sr-only">대화와 프로젝트 검색</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="프로젝트 또는 대화 검색" /></label>
    <div className="chat-groups">{visible.map(group=><ConversationGroup key={group.key + (normalized ? ":search" : "")} group={group} activeConversationId={activeConversationId} disabled={disabled || deleting} onSelect={onSelect} onDelete={remove}/>)}{!visible.length && <p className="chat-empty">{normalized ? "검색 결과가 없습니다." : "저장된 대화가 없습니다."}</p>}</div>
    {error && <p className="chat-delete-error" role="alert">{error}</p>}
  </section>;
}

function ConversationGroup({group,activeConversationId,disabled,onSelect,onDelete}:{group:ReturnType<typeof groupConversations>[number];activeConversationId:string;disabled:boolean;onSelect:(id:string)=>void;onDelete:(item:ConversationSummary)=>void}) {
  const [open,setOpen]=useState(true);
  return <details className="chat-group" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary title={group.path || group.label}><span aria-hidden="true">{group.key === "research" ? "◇" : "▱"}</span><strong>{group.label}</strong><small>{group.conversations.length}</small></summary>
    <div>{group.path && <p className="chat-group-path" title={group.path}>{group.path}</p>}{group.conversations.map(conversation=><div className="chat-row" key={conversation.id}><button type="button" disabled={disabled} className={conversation.id===activeConversationId ? "is-current" : ""} aria-current={conversation.id===activeConversationId ? "true" : undefined} title={conversation.title} onClick={()=>onSelect(conversation.id)}>{conversation.title}</button><button type="button" className="chat-delete" disabled={disabled} aria-label={`${conversation.title} 대화 삭제`} title="대화 삭제" onClick={()=>onDelete(conversation)}>×</button></div>)}</div>
  </details>;
}
