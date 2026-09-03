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

  it("accepts folderless research and conversation controls", () => {
    expect(parseClientMessage('{"type":"workspace.mode","mode":"research"}')).toEqual({ type: "workspace.mode", mode: "research" });
    expect(parseClientMessage('{"type":"workspace.network","enabled":true}')).toEqual({ type: "workspace.network", enabled: true });
    expect(parseClientMessage('{"type":"conversation.new"}')).toEqual({ type: "conversation.new" });
    expect(parseClientMessage('{"type":"conversation.select","conversationId":"conversation-1"}')).toEqual({ type: "conversation.select", conversationId: "conversation-1" });
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

  it("rejects malformed workspace and conversation controls", () => {
    expect(() => parseClientMessage('{"type":"workspace.mode","mode":"cloud"}')).toThrow("사용 모드가 올바르지 않습니다");
    expect(() => parseClientMessage('{"type":"workspace.network","enabled":"yes"}')).toThrow("웹 접근 설정이 올바르지 않습니다");
    expect(() => parseClientMessage('{"type":"conversation.select","conversationId":""}')).toThrow("대화 ID가 올바르지 않습니다");
  });
});
