import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueApi } from "./api";
import { ExecutionHistory, ExecutionHistoryList } from "./ExecutionHistory";

describe("execution history", () => {
  it("explains the limits of a record and offers an explicit read", () => {
    const html = renderToStaticMarkup(<ExecutionHistory api={new IssueApi()} revision={1} loading={false} setLoading={() => {}} onError={() => {}} />);
    expect(html).toContain("실행 기록 확인");
    expect(html).toContain("이슈 완료가 확인된 것은 아닙니다");
    expect(html).toContain("자동 재실행되지 않습니다");
  });
  it("shows unknown approval delivery separately from issue completion", () => {
    const html = renderToStaticMarkup(<ExecutionHistoryList items={[{ attemptId: "attempt-a", issueId: "issue-a", projectRevision: 1, phase: "outcome_unknown", outcome: null, hasRuntimeReference: true, approvals: { pending: 0, responding: 0, sent: 1, outcome_unknown: 1, expired: 2 } }]} />);
    expect(html).toContain("결과 불명"); expect(html).toContain("전송 불명 1"); expect(html).toContain("만료 2"); expect(html).not.toContain("완료됨");
  });
});
