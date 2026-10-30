import type { ConversationSummary } from "../../../shared/protocol";
import { AtelierIcon, DESIGN_STEPS, type AtelierPage } from "./AtelierNavigation";
import type {Entry} from '../../../shared/atelier/types';

type HomeProps = {
  onNavigate: (page: AtelierPage) => void;
  conversations: ConversationSummary[];
  onSelectConversation: (id: string) => void;
  busy: boolean;
  onStartDesign?: (entry:Entry)=>void;
};

export function AtelierHome({ onNavigate, conversations, onSelectConversation, busy,onStartDesign }: HomeProps) {
  return <section className="atelier-home" aria-label="작업실 홈">
    <div className="atelier-home-hero">
      <button type="button" className="atelier-primary" onClick={() => onNavigate("work")}>일반 Codex 작업 시작 <span aria-hidden="true">→</span></button>
    </div>
    <section className="atelier-home-section" aria-labelledby="atelier-start-title"><div className="atelier-section-title"><div><h2 id="atelier-start-title">어디서 시작할까요?</h2><p>지금 가진 생각·원본·컨셉·실제 결과에서 설계를 시작하세요.</p></div><span className="atelier-preparing">{onStartDesign?'로컬 수동 작업실':'디자인 연결 확인 필요'}</span></div>
      <div className="atelier-entry-grid">{[
        ["아이디어부터", "만들고 싶은 제품과 사용자를 정리해요."], ["이미지부터", "레퍼런스의 관찰과 적용 이유를 연결해요."],
        ["컨셉 확정", "정한 방향을 구체적인 표현 규칙으로 옮겨요."], ["기존 결과 개선", "실제 결과와 의도의 차이를 살펴봐요."],
      ].map(([title, description], index) => <button type="button" className="atelier-entry" key={title} disabled={!onStartDesign} onClick={()=>onStartDesign?.((['idea','image','concept','improve'] as const)[index])}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{description}</p><small>{onStartDesign?'이 시작점으로 설계하기':'연결 예정'}</small></button>)}</div>
      <button type="button" className="atelier-text-link" onClick={() => onNavigate("design")}>디자인 작업실 열기 →</button>
    </section>
    <section className="atelier-home-section" aria-labelledby="atelier-recent-title"><div className="atelier-section-title"><div><h2 id="atelier-recent-title">이어서 작업하기</h2><p>로컬 브리지에서 불러온 대화입니다.</p></div><button type="button" className="atelier-text-link" onClick={() => onNavigate("results")}>대화와 결과 열기 ↗</button></div>
      {conversations.length ? <div className="atelier-conversation-list">{conversations.slice(0, 4).map((conversation) => <button key={conversation.id} type="button" disabled={busy} onClick={() => onSelectConversation(conversation.id)}><span><strong>{conversation.title}</strong><small>{conversation.preview || "아직 대화 내용이 없습니다."}</small></span><span>{conversation.messageCount}개 메시지</span><span aria-hidden="true">↗</span></button>)}</div> : <p className="atelier-empty-note">불러온 대화가 없습니다. 일반 Codex 작업에서 새 대화를 시작하세요.</p>}
    </section>
  </section>;
}

export function AtelierPreparation() {
  return <section className="atelier-preparation" aria-labelledby="preparation-title"><div className="atelier-preparation-note"><span className="atelier-preparing">준비 중</span><h2 id="preparation-title">설계 흐름을 연결할 준비를 하고 있습니다.</h2><p>현재 단계에서는 공통 화면과 기존 Codex 기능을 연결했습니다. 아래 영역의 편집·저장·프롬프트 생성·AI 제작은 아직 제공하지 않습니다.</p></div><ol className="atelier-preparation-list">{DESIGN_STEPS.map(([icon, title], index) => <li key={icon}><span>{String(index + 1).padStart(2, "0")}</span><AtelierIcon name={icon} /><h3>{title}</h3><small>연결 예정</small></li>)}</ol></section>;
}
