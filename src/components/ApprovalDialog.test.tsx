import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalDialog } from "./ApprovalDialog";

describe("ApprovalDialog", () => {
  it("does not offer session-wide approval for a one-time analysis request", () => {
    const markup = renderToStaticMarkup(<ApprovalDialog approval={{ approvalId: "synthetic", kind: "command", title: "명령 승인", oneTimeOnly: true }} onResolve={() => {}} />);
    expect(markup).toContain("이번만 승인");
    expect(markup).not.toContain("이 세션에서 승인");
    expect(markup).toContain("네트워크에 접근할 수 있습니다");
    expect(markup).toContain('aria-describedby="approval-security-note approval-analysis-risk"');
  });
  it("preserves the existing session option for ordinary requests", () => {
    const markup = renderToStaticMarkup(<ApprovalDialog approval={{ approvalId: "synthetic", kind: "command", title: "명령 승인" }} onResolve={() => {}} />);
    expect(markup).toContain("이 세션에서 승인");
    expect(markup).not.toContain("네트워크에 접근할 수 있습니다");
  });
});
