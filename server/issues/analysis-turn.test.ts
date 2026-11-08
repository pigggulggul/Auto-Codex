import { describe, expect, it } from "vitest";
import { AnalysisTurnCapture } from "./analysis-turn.js";

const item = (threadId: string, turnId: string, text: string, phase = "final_answer") => ({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", phase, text } } });
const done = (threadId: string, turnId: string, status = "completed") => ({ method: "turn/completed", params: { threadId, turn: { id: turnId, status } } });

describe("analysis turn capture", () => {
  it("correlates an early final message and terminal event with the start response", () => {
    const capture = new AnalysisTurnCapture("thread-1");
    capture.receive(item("thread-1", "turn-1", "ignored", "commentary"));
    capture.receive(item("thread-1", "turn-1", '{"requirements":[]}'));
    capture.receive(done("thread-1", "turn-1"));
    expect(capture.result()).toBeNull(); capture.bind("turn-1");
    expect(capture.result()).toEqual({ status: "completed", text: '{"requirements":[]}' });
  });
  it("never uses events from other threads or a different bound turn", () => {
    const capture = new AnalysisTurnCapture("thread-1"); capture.bind("turn-1");
    expect(capture.receive(item("other", "turn-1", "foreign"))).toBe(false);
    capture.receive(item("thread-1", "turn-2", "foreign")); capture.receive(done("thread-1", "turn-2"));
    expect(capture.result()).toBeNull(); capture.receive(item("thread-1", "turn-1", "valid")); capture.receive(done("thread-1", "turn-1"));
    expect(capture.result()).toEqual({ status: "completed", text: "valid" });
  });
  it("rejects mismatched early IDs, duplicate messages, oversize output and missing final output", () => {
    const mismatch = new AnalysisTurnCapture("thread"); mismatch.receive(item("thread", "early", "x")); mismatch.bind("other"); expect(mismatch.result()).toEqual({ status: "invalid" });
    const duplicate = new AnalysisTurnCapture("thread"); duplicate.bind("turn"); duplicate.receive(item("thread", "turn", "one")); duplicate.receive(item("thread", "turn", "two")); expect(duplicate.result()).toEqual({ status: "invalid" });
    const oversize = new AnalysisTurnCapture("thread"); oversize.bind("turn"); oversize.receive(item("thread", "turn", "한".repeat(22000))); expect(oversize.result()).toEqual({ status: "invalid" });
    const empty = new AnalysisTurnCapture("thread"); empty.bind("turn"); empty.receive(done("thread", "turn")); expect(empty.result()).toEqual({ status: "invalid" });
  });
  it("does not turn failed or interrupted turns into successful output", () => {
    for (const status of ["failed", "interrupted"] as const) {
      const capture = new AnalysisTurnCapture("thread"); capture.bind("turn"); capture.receive(item("thread", "turn", "partial")); capture.receive(done("thread", "turn", status)); expect(capture.result()).toEqual({ status });
    }
  });
  it("rejects an unknown explicit message phase instead of accepting it as final", () => {
    for (const phase of ["analysis", "unknown", "", "FINAL_ANSWER"]) {
      const capture = new AnalysisTurnCapture("thread"); capture.bind("turn");
      capture.receive(item("thread", "turn", '{"requirements":[]}', phase)); capture.receive(done("thread", "turn"));
      expect(capture.result()).toEqual({ status: "invalid" });
    }
  });
  it("retains compatibility with a final message whose phase is absent or null", () => {
    for (const phase of [undefined, null]) {
      const capture = new AnalysisTurnCapture("thread"); capture.bind("turn");
      capture.receive({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", phase, text: "{}" } } });
      capture.receive(done("thread", "turn")); expect(capture.result()).toEqual({ status: "completed", text: "{}" });
    }
  });
  it("rejects observed tool items and unknown item types even if a final message follows", () => {
    for (const method of ["item/started", "item/completed"]) for (const type of ["commandExecution", "mcpToolCall", "dynamicToolCall", "webSearch", "fileChange", "hookPrompt", "futureTool"]) {
      const capture = new AnalysisTurnCapture("thread"); capture.bind("turn");
      capture.receive({ method, params: { threadId: "thread", turnId: "turn", item: { type } } });
      capture.receive(item("thread", "turn", '{"requirements":[]}')); capture.receive(done("thread", "turn"));
      expect(capture.result()).toEqual({ status: "invalid" });
    }
  });
});
