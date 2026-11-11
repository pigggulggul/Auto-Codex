import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtelierNavigation } from "./AtelierNavigation";
import { AtelierPreparation } from "./AtelierPages";

describe("Atelier shell boundaries", () => {
  it("shows the main workspaces and marks the results destination for the pixel view", () => {
    const html = renderToStaticMarkup(<AtelierNavigation page="pixel" mobileOpen={false} onNavigate={() => {}} onMobileClose={() => {}} />);
    expect(html).toContain('aria-current="page"');
    for (const label of ["Codex 대화", "아뜰리에 디자인", "이슈 처리", "픽셀 화면"]) expect(html).toContain(label);
    for (const label of ["실행 활동", "프로젝트 · 스킬 설정", "작업실 설정", "디자인 작업 단계"]) expect(html).not.toContain(label);
  });

  it("does not present editors or generation controls before the domain is connected", () => {
    const html = renderToStaticMarkup(<AtelierPreparation />);
    expect(html).toContain("아직 제공하지 않습니다");
    expect(html).not.toMatch(/<(input|textarea|form)\b/);
    expect(html.match(/연결 예정/g)).toHaveLength(8);
  });

});
