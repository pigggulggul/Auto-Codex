import { useEffect, useRef } from "react";
import type {Tab} from '../../../shared/atelier/types';
import {TABS} from '../../../shared/atelier/guide';

export type AtelierPage = "home" | "work" | "results" | "operations" | "pixel" | "settings" | "design";

export const DESIGN_STEPS = [
  ["edit", "프로젝트 설계"], ["flow", "사용자 흐름"], ["image", "레퍼런스 연구"],
  ["concept", "컨셉 탐색"], ["style", "스타일과 리소스"], ["brief", "디자인 브리프"],
  ["prompt", "프롬프트 스튜디오"], ["review", "자가 진단과 수정"],
] as const;

export const PAGE_INFO: Record<AtelierPage, { title: string; english: string; description: string }> = {
  home: { title: "나의 작업실", english: "A little space for your next idea.", description: "생각을 정리하고, Codex와 함께 다음 작업을 시작하세요." },
  work: { title: "일반 Codex 작업", english: "Make room for your next task.", description: "프로젝트와 실행 설정을 확인하고 업무를 지시하세요. 디자인 설계 없이 바로 시작할 수 있습니다." },
  results: { title: "대화와 결과", english: "Every step, kept in context.", description: "현재 대화와 작업별 결과를 확인하세요. 전체 보기에서 긴 본문을 읽고 원문을 복사할 수 있습니다." },
  operations: { title: "Codex 활동 센터", english: "See the work as it happens.", description: "실제 실행 이벤트와 작업 상태를 확인합니다. 화면 이동은 실행 상태를 바꾸지 않습니다." },
  pixel: { title: "픽셀 화면", english: "A small world, real activity.", description: "역할별 캐릭터와 픽셀 공간에서 실제 작업 흐름을 살펴보세요." },
  settings: { title: "작업실 설정", english: "A workspace that fits you.", description: "프로젝트·모델·스킬을 설정하고 화면 표시 방식을 선택하세요." },
  design: { title: "디자인 작업실", english: "Intention before decoration.", description: "설계·원본·흐름·고정 프롬프트·실제 결과와 검토를 로컬 저장소에서 연결합니다." },
};

const MAIN_PAGES = [
  ["home", "folder", "나의 작업실"], ["work", "edit", "일반 Codex 작업"],
  ["results", "prompt", "대화와 결과"], ["operations", "flow", "Codex 활동 센터"],
  ["pixel", "concept", "픽셀 화면"],
] as const;

export function AtelierIcon({ name }: { name: string }) {
  return <img className="atelier-icon" src={`/atelier-assets/icons/${name}.svg`} alt="" aria-hidden="true" />;
}

type Props = {
  page: AtelierPage;
  onNavigate: (page: AtelierPage) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onLegacy: () => void;
  hidden?: boolean;
  onDesignTab?: (tab:Tab)=>void;
  designTab?:Tab;
};

export function AtelierNavigation({ page, onNavigate, mobileOpen, onMobileClose, onLegacy, hidden,onDesignTab,designTab }: Props) {
  const drawer = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const modal = drawer.current;
    if (!modal) return;
    if (mobileOpen && !hidden) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modal.showModal();
    } else if (modal.open) modal.close();
    return () => { if (modal.open) modal.close(); returnFocus.current?.focus(); };
  }, [mobileOpen, hidden]);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 901px)");
    const closeWhenWide = () => { if (wide.matches && drawer.current?.open) onMobileClose(); };
    wide.addEventListener("change", closeWhenWide);
    return () => wide.removeEventListener("change", closeWhenWide);
  }, [onMobileClose]);

  const navigate = (next: AtelierPage) => { onNavigate(next); onMobileClose(); };
  const content = <>
    <button type="button" className="atelier-wordmark" onClick={() => navigate("home")} aria-label="Auto Codex 나의 작업실">auto codex<span>.</span></button>
    <p className="atelier-nav-label">PERSONAL WORKSPACE</p>
    <nav aria-label="작업실 탐색">
      {MAIN_PAGES.map(([id, icon, label]) => <button key={id} type="button" className={`atelier-nav-item ${page === id ? "is-current" : ""}`} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}><AtelierIcon name={icon} />{label}</button>)}
      <p className="atelier-nav-label">YOUR DESIGN PROCESS</p>
      <button type="button" className={`atelier-nav-item ${page === "design" ? "is-current" : ""}`} aria-current={page === "design" ? "page" : undefined} onClick={() => navigate("design")}><AtelierIcon name="brief" />디자인 작업실{!onDesignTab&&<span className="atelier-preparing">준비 중</span>}</button>
      <ol className="atelier-design-nav" aria-label="디자인 작업 단계">
        {DESIGN_STEPS.map(([icon, label], index) => <li key={icon}><button type="button" disabled={!onDesignTab} aria-current={page==='design'&&designTab===TABS[index][0]?'page':undefined} onClick={()=>{onDesignTab?.(TABS[index][0]);onMobileClose();}}><AtelierIcon name={icon} /><span>{label}</span><small>{String(index + 1).padStart(2, "0")}</small></button></li>)}
      </ol>
    </nav>
    <div className="atelier-nav-bottom">
      <button type="button" className={`atelier-nav-item ${page === "settings" ? "is-current" : ""}`} aria-current={page === "settings" ? "page" : undefined} onClick={() => navigate("settings")}><AtelierIcon name="settings" />작업실 설정</button>
      <button type="button" className="atelier-legacy-link" onClick={onLegacy}>기존 화면으로 전환 <span aria-hidden="true">↗</span></button>
      <p className="atelier-local-note">LOCAL WORKSPACE<br />저장과 실행 연결은 로컬 브리지가 관리합니다.</p>
      <a className="atelier-attribution" href="https://streamlinehq.com" target="_blank" rel="noreferrer">Free icons from Streamline ↗</a>
    </div>
  </>;

  return <>
    <aside className="atelier-sidebar" hidden={hidden}>{content}</aside>
    <dialog className="atelier-nav-dialog" ref={drawer} aria-label="작업실 메뉴" onClose={onMobileClose} onClick={(event) => { if (event.target === event.currentTarget) onMobileClose(); }} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }}>
      {mobileOpen && !hidden && <><button type="button" className="atelier-dialog-close" onClick={onMobileClose} aria-label="탐색 메뉴 닫기">닫기 ×</button>{content}</>}
    </dialog>
  </>;
}
