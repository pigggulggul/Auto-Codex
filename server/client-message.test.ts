import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./client-message.js";

describe("parseClientMessage", () => {
  it("accepts a valid team turn", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "turn.start",
      prompt: "작업",
      skillMode: "auto",
      executionMode: "team",
      model: "gpt-5.6-sol",
      effort: "high",
    }))).toMatchObject({ type: "turn.start", executionMode: "team", model: "gpt-5.6-sol", effort: "high" });
  });

  it("accepts a model refresh request", () => {
    expect(parseClientMessage('{"type":"models.refresh"}')).toEqual({ type: "models.refresh" });
  });

  it("rejects an unsupported reasoning effort", () => {
    expect(() => parseClientMessage(JSON.stringify({
      type: "turn.start", prompt: "작업", skillMode: "auto", effort: "maximum-ish",
    }))).toThrow("추론 강도가 올바르지 않습니다");
  });

  it("rejects forged approval decisions", () => {
    expect(() => parseClientMessage(JSON.stringify({
      type: "approval.resolve", approvalId: "approval-1", decision: "allowEverything",
    }))).toThrow("승인 결정이 올바르지 않습니다");
  });

  it("rejects unknown execution and skill modes", () => {
    expect(() => parseClientMessage(JSON.stringify({
      type: "turn.start", prompt: "작업", skillMode: "forced", executionMode: "remote",
    }))).toThrow("스킬 선택 모드가 올바르지 않습니다");
  });

  it("rejects unknown message types", () => {
    expect(() => parseClientMessage('{"type":"shell.run"}')).toThrow("지원하지 않는 클라이언트 메시지");
  });
});
