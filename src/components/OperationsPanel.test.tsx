import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationsPanel } from "./OperationsPanel";

describe("OperationsPanel activity", () => {
  it("renders activity and status without legacy images", () => {
    const html = renderToStaticMarkup(<OperationsPanel
      activities={[{
        id: "activity-1",
        state: "editing",
        title: "파일 수정 중",
        source: "item/started",
        timestamp: "2026-09-02T12:00:00Z",
      }]}
      run={null}
      assistantText=""
      taskOutputs={{}}
      streaming
    />);
    expect(html).toContain("파일 수정 중");
    expect(html).toContain("Generalist");
    expect(html).not.toContain("/generated-pixel-assets/");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("활동 내역");
    expect(html).toContain("작업 목록");
  });
});
