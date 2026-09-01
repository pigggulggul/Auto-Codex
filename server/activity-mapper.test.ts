import { describe, expect, it } from "vitest";
import { mapNotification } from "./activity-mapper.js";

describe("mapNotification", () => {
  it("maps command execution to a running pet", () => {
    const activity = mapNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "commandExecution", command: "npm test", status: "inProgress" },
      },
    });
    expect(activity).toMatchObject({ state: "running", title: "명령 실행 중", detail: "npm test" });
  });

  it("maps file changes to editing", () => {
    const activity = mapNotification({
      method: "item/started",
      params: { item: { type: "fileChange", status: "inProgress" } },
    });
    expect(activity?.state).toBe("editing");
  });

  it("does not expose raw reasoning deltas as activities", () => {
    const activity = mapNotification({
      method: "item/reasoning/textDelta",
      params: { delta: "private reasoning" },
    });
    expect(activity).toBeNull();
  });

  it("maps completed turns to success", () => {
    const activity = mapNotification({
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed" } },
    });
    expect(activity?.state).toBe("success");
  });
});

