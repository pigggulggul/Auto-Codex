import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IssueWorkspace } from "./Workspace";
import { IssueApi } from "./api";

const base = { hidden: false, projectPath: null, workspaceMode: "project" as const, selectionGeneration: 0, connected: true, appServerReady: true, busy: false, isPicking: false, onPickProject: () => {}, api: new IssueApi() };

describe("issue workspace", () => {
  it("explains missing project and marks unimplemented actions unavailable", () => {
    const html = renderToStaticMarkup(<IssueWorkspace {...base} />);
    expect(html).toContain("프로젝트를 선택하세요");
    expect(html).toContain("프로젝트 폴더 선택");
    expect(html).toMatch(/<button type="button" disabled="">이슈 후보 만들기/);
    expect(html).toContain("일반 문서 분석은 이슈 목록에서 시작할 수 있으며 이슈 실행은 준비 중입니다");
  });
  it("shows the real project and disables project switching during a run", () => {
    const html = renderToStaticMarkup(<IssueWorkspace {...base} projectPath="C:/synthetic/project" busy />);
    expect(html).toContain("C:/synthetic/project");
    expect(html).toMatch(/<button type="button" disabled="">프로젝트 변경/);
  });
  it("distinguishes research mode and an offline bridge", () => {
    const html = renderToStaticMarkup(<IssueWorkspace {...base} workspaceMode="research" connected={false} appServerReady={false} />);
    expect(html).toContain("조사 모드에서는 이슈 작업을 시작할 수 없습니다");
    expect(html).toContain("브리지 연결이 끊겼습니다");
    expect(html).toMatch(/<button type="button" disabled="">프로젝트 폴더 선택/);
  });
});
