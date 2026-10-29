import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtelierNavigation } from "./AtelierNavigation";
import { AtelierHome, AtelierNotes, AtelierPreparation } from "./AtelierPages";

describe("Atelier shell boundaries", () => {
  it("keeps working destinations separate from the eight unavailable design editors", () => {
    const html = renderToStaticMarkup(<AtelierNavigation page="work" mobileOpen={false} onNavigate={() => {}} onMobileClose={() => {}} onLegacy={() => {}} />);
    expect(html).toContain('aria-current="page"');
    for (const label of ["일반 Codex 작업", "대화와 결과", "Codex 활동 센터", "픽셀 화면", "작업실 설정", "기존 화면으로 전환"]) expect(html).toContain(label);
    expect(html.match(/disabled=""/g)).toHaveLength(8);
    expect(html).toContain("디자인 작업실");
    expect(html).toContain("준비 중");
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

  it("distinguishes offline, ready, busy and pending approval without a fabricated success", () => {
    const offline = renderToStaticMarkup(<AtelierNotes connected={false} appServerReady={false} busy={false} awaitingApproval={false} projectPath={null} />);
    expect(offline).toContain("연결 안 됨");
    expect(offline).toContain("연결 확인 필요");
    expect(offline).toContain("진행 작업 없음");
    const pending = renderToStaticMarkup(<AtelierNotes connected appServerReady busy awaitingApproval projectPath="C:\\synthetic" />);
    expect(pending).toContain("승인 대기");
    expect(pending).not.toContain("실행 완료");
  });
});
