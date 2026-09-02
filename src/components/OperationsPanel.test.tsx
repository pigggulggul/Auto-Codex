import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationsPanel } from "./OperationsPanel";

describe("OperationsPanel character identity", () => {
  it("renders the same assigned world character for activity events", () => {
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
      characterAssignments={{ general: 3 }}
      streaming
    />);
    expect(html).toContain("/generated-pixel-assets/characters/char_3.png");
    expect(html).toContain("width:48px;height:64px");
    expect(html).toContain("background-size:192px 256px");
    expect(html).toContain("background-position:0 -128px");
  });
});
