import { AtelierIcon, DESIGN_STEPS } from "./AtelierNavigation";

export function AtelierPreparation() {
  return <section className="atelier-preparation" aria-labelledby="preparation-title"><div className="atelier-preparation-note"><span className="atelier-preparing">준비 중</span><h2 id="preparation-title">설계 흐름을 연결할 준비를 하고 있습니다.</h2><p>현재 단계에서는 공통 화면과 기존 Codex 기능을 연결했습니다. 아래 영역의 편집·저장·프롬프트 생성·AI 제작은 아직 제공하지 않습니다.</p></div><ol className="atelier-preparation-list">{DESIGN_STEPS.map(([icon, title], index) => <li key={icon}><span>{String(index + 1).padStart(2, "0")}</span><AtelierIcon name={icon} /><h3>{title}</h3><small>연결 예정</small></li>)}</ol></section>;
}
