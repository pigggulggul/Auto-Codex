import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./client-message.js";

describe("parseClientMessage", () => {
  it("accepts a valid team turn", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "turn.start", prompt: "작업", skillMode: "auto", executionMode: "team",
    }))).toMatchObject({ type: "turn.start", executionMode: "team" });
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
