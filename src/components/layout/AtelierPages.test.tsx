import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtelierNavigation } from "./AtelierNavigation";
import { AtelierHome, AtelierPreparation } from "./AtelierPages";

describe("Atelier shell boundaries", () => {
  it("shows the main workspaces and marks the results destination for the pixel view", () => {
    const html = renderToStaticMarkup(<AtelierNavigation page="pixel" mobileOpen={false} onNavigate={() => {}} onMobileClose={() => {}} />);
    expect(html).toContain('aria-current="page"');
    for (const label of ["Codex 대화", "아뜰리에 디자인", "이슈 처리", "대화 결과 · 픽셀 화면", "실행 활동"]) expect(html).toContain(label);
    for (const label of ["프로젝트 · 스킬 설정", "작업실 설정", "디자인 작업 단계"]) expect(html).not.toContain(label);
  });

  it("shows only received conversation data, escapes it, and prevents switching while busy", () => {
    const html = renderToStaticMarkup(<AtelierHome busy onNavigate={() => {}} onSelectConversation={() => {}} conversations={[
      { id: "synthetic", title: "<script>untrusted()</script>", preview: "받은 대화 원문", messageCount: 2, createdAt: "2026-10-29", updatedAt: "2026-10-29" },
    ]} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("받은 대화 원문");
    expect(html).toContain('disabled=""');
    expect(html).toContain("연결 예정");
  });

  it("does not present editors or generation controls before the domain is connected", () => {
    const html = renderToStaticMarkup(<AtelierPreparation />);
    expect(html).toContain("아직 제공하지 않습니다");
    expect(html).not.toMatch(/<(input|textarea|form)\b/);
    expect(html.match(/연결 예정/g)).toHaveLength(8);
  });

  it("keeps the home launch action without decorative hero content or a notes column", () => {
    const home=renderToStaticMarkup(<AtelierHome conversations={[]} busy={false} onNavigate={()=>{}} onSelectConversation={()=>{}} onStartDesign={()=>{}}/>);
    const hero=home.match(/<div class="atelier-home-hero">(.*?)<\/div>/)?.[1]||'';
    expect(hero).toContain('일반 Codex 작업 시작');expect(hero).not.toMatch(/<(h1|h2|p|img)\b/);expect(home).not.toContain('atelier-notes');expect(home).not.toContain('atelier-type-study');
  });
});
