import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultView } from "./ResultView";
import type { RunSnapshot } from "../../shared/protocol";

describe("restored conversation results", () => {
  it("shows the bridge-assigned skill and its rationale with a task result", () => {
    const run: RunSnapshot = {
      id: "run", prompt: "모바일 앱", mode: "team", status: "completed", createdAt: "2026-10-25T00:00:00Z", completedAt: "2026-10-25T00:01:00Z", agents: [],
      tasks: [{ id: "build", title: "구현", description: "앱", kind: "implementation", access: "write", agentRole: "builder", dependsOn: [], order: 1,
        agentId: "builder", status: "completed", attempt: 1, threadId: "thread", turnId: "turn", startedAt: null, completedAt: null,
        skillName: "mobile-app-delivery", skillPath: "mobile", skillRationale: "모바일 작업에 일치", resultSummary: "합성 결과" }],
    };
    const html = renderToStaticMarkup(<ResultView conversationId="chat" conversationTitle="결과" run={run} taskOutputs={{}} assistantText="" messages={[]} />);
    expect(html).toContain("스킬 배정: ");
    expect(html).toContain("mobile-app-delivery");
    expect(html).toContain("모바일 작업에 일치");
  });
  it("renders visible Markdown and an accessible full-text action for every message", () => {
    const html = renderToStaticMarkup(<ResultView conversationId="saved-chat" conversationTitle="읽기 검증" run={null} taskOutputs={{}} assistantText={"## 결론\n\n**확인 가능한 본문**"} messages={[
      { id: "u1", role: "user", text: "긴 결과를 보여줘", timestamp: "2026-10-25T00:00:00Z", status: "completed" },
    ]} />);
    expect(html).toContain('<h2>결론</h2>');
    expect(html).toContain('<strong>확인 가능한 본문</strong>');
    expect(html).toContain('aria-label="내 요청 전체 보기"');
    expect(html).toContain('aria-label="최근 응답 전체 보기"');
    expect(html.match(/class="result-text-body"/g)).toHaveLength(2);
  });
  it("shows earlier requests and replies alongside the current reply and escapes stored text", () => {
    const html = renderToStaticMarkup(<ResultView conversationId="saved-chat" conversationTitle="이전 대화" run={null} taskOutputs={{}} assistantText="마지막 응답" messages={[
      { id: "u1", role: "user", text: "첫 요청", timestamp: "2026-10-25T00:00:00Z", status: "completed" },
      { id: "a1", role: "assistant", text: "<script>untrusted()</script>", timestamp: "2026-10-25T00:00:00Z", status: "completed" },
      { id: "u2", role: "user", text: "다음 요청", timestamp: "2026-10-25T00:01:00Z", status: "completed" },
      { id: "a2", role: "assistant", text: "마지막 응답", timestamp: "2026-10-25T00:01:00Z", status: "completed" },
    ]} />);
    expect(html).toContain("첫 요청");
    expect(html).toContain("다음 요청");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html.match(/마지막 응답/g)).toHaveLength(1);
  });

  it("explains a restored interrupted reply even if no output arrived before shutdown", () => {
    const html = renderToStaticMarkup(<ResultView conversationId="saved-chat" conversationTitle="중단된 대화" run={null} taskOutputs={{}} assistantText="" messages={[
      { id: "u1", role: "user", text: "계속 작업", timestamp: "2026-10-25T00:00:00Z", status: "completed" },
      { id: "a1", role: "assistant", text: "", timestamp: "2026-10-25T00:00:00Z", status: "interrupted" },
    ]} />);
    expect(html).toContain("앱 종료로 중단됨");
    expect(html).toContain("다음 요청으로 이어갈 수 있습니다");
    expect(html).not.toContain("아직 결과가 없습니다");
  });
});
