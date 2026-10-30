import type { ConversationSummary } from "../../shared/protocol";
import {useEffect,useRef,useState} from 'react';
import {savedConversationTitle,titleFromPrompt} from '../../shared/conversation-title';

type Props = {
  conversations: ConversationSummary[];
  activeConversationId: string;
  disabled: boolean;
  onNew: () => void;
  onSelect: (conversationId: string) => void;
  onRename:(conversationId:string,title:string,expectedTitle:string)=>Promise<void>;
  firstPrompt?:string;
};

function shortId(id: string): string {
  return id ? id.slice(0, 8) : "--------";
}

export function ConversationPicker({ conversations, activeConversationId, disabled, onNew, onSelect,onRename,firstPrompt }: Props) {
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
      {active&&<ConversationName key={active.id} active={active} disabled={disabled} onRename={onRename} firstPrompt={firstPrompt}/>}
      {active?.preview && <p className="conversation-preview">{active.preview}</p>}
      <p>대화와 작업 내역은 이 PC에 자동 저장됩니다. 앱을 다시 켜거나 프로젝트를 바꿔도 목록에서 이어갈 수 있습니다.</p>
    </section>
  );
}

function ConversationName({active,disabled,onRename,firstPrompt}:{active:ConversationSummary;disabled:boolean;onRename:Props['onRename'];firstPrompt?:string}){
  const [draft,setDraft]=useState(active.title),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const previous=useRef(active.title);useEffect(()=>{const before=previous.current;previous.current=active.title;setDraft(current=>current===before?active.title:current);},[active.title]);
  return <form className="conversation-name" onSubmit={e=>{e.preventDefault();setError('');setNotice('');let title:string;try{title=savedConversationTitle(draft);}catch(e){setError((e as Error).message);return;}setDraft(title);setBusy(true);void onRename(active.id,title,active.title).then(()=>setNotice('대화 이름을 이 PC에 저장했습니다.')).catch(e=>setError(String(e instanceof Error?e.message:e))).finally(()=>setBusy(false));}}>
    <label>대화 이름<input value={draft} maxLength={80} disabled={disabled||busy} onChange={e=>{setDraft(e.target.value);setNotice('');}}/></label>
    <div className="conversation-name-actions"><button type="submit" disabled={disabled||busy||!draft.trim()}>{busy?'이름 저장 중…':'대화 이름 저장'}</button><button type="button" disabled={disabled||busy||!firstPrompt} onClick={()=>{setDraft(titleFromPrompt(firstPrompt!));setNotice('첫 요청에서 만든 이름입니다. 저장하면 적용됩니다.');}}>첫 요청으로 이름 만들기</button></div>
    <p>기본 이름은 첫 요청에서 만듭니다. 직접 저장한 이름은 이후 요청이 덮어쓰지 않습니다.</p><p role="status">{notice}{!busy&&draft!==active.title&&!notice?'이름 편집 중 · 아직 저장되지 않았습니다.':''}</p>{error&&<p role="alert">{error}</p>}
  </form>;
}
