import { describe, expect, it } from "vitest";
import { RuntimeRegistry } from "./runtime-registry.js";

describe("RuntimeRegistry", () => {
  it("routes interleaved events to the correct task", () => {
    const registry = new RuntimeRegistry();
    registry.bindThread({ runId: "run-1", taskId: "research", agentId: "agent-r", threadId: "thread-r" });
    registry.bindThread({ runId: "run-1", taskId: "design", agentId: "agent-d", threadId: "thread-d" });
    registry.bindTurn("thread-r", "turn-r");
    registry.bindTurn("thread-d", "turn-d");

    expect(registry.resolve({ threadId: "thread-d", turnId: "turn-d" })).toMatchObject({ taskId: "design", agentId: "agent-d" });
    expect(registry.resolve({ threadId: "thread-r", turn: { id: "turn-r" } })).toMatchObject({ taskId: "research", agentId: "agent-r" });
  });

  it("uses the turn identity before a conflicting thread identity", () => {
    const registry = new RuntimeRegistry();
    registry.bindThread({ runId: "run-1", taskId: "a", agentId: "agent-a", threadId: "thread-a" });
    registry.bindThread({ runId: "run-1", taskId: "b", agentId: "agent-b", threadId: "thread-b" });
    registry.bindTurn("thread-a", "turn-a");
    expect(registry.resolve({ threadId: "thread-b", turnId: "turn-a" })?.taskId).toBe("a");
  });

  it("rejects rebinding a thread to another task", () => {
    const registry = new RuntimeRegistry();
    registry.bindThread({ runId: "run-1", taskId: "a", agentId: "agent-a", threadId: "thread-a" });
    expect(() => registry.bindThread({ runId: "run-1", taskId: "b", agentId: "agent-b", threadId: "thread-a" }))
      .toThrow("이미 다른 작업");
  });

  it("removes completed turns while keeping their thread context", () => {
    const registry = new RuntimeRegistry();
    registry.bindThread({ runId: "run-1", taskId: "a", agentId: "agent-a", threadId: "thread-a" });
    registry.bindTurn("thread-a", "turn-a");
    expect(registry.completeTurn("turn-a")?.taskId).toBe("a");
    expect(registry.resolve({ turnId: "turn-a" })).toBeNull();
    expect(registry.resolve({ threadId: "thread-a" })).toMatchObject({ taskId: "a", turnId: null });
  });
});
