import type { ClientMessage } from "../shared/protocol.js";

const SIMPLE_MESSAGES = new Set(["project.pick", "project.trust", "skills.refresh", "turn.interrupt"]);
const APPROVAL_DECISIONS = new Set(["accept", "acceptForSession", "decline", "cancel"]);

export function parseClientMessage(raw: string): ClientMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("잘못된 JSON 메시지입니다.");
  }
  if (!value || typeof value !== "object") throw new Error("메시지 형식이 올바르지 않습니다.");
  const message = value as Record<string, unknown>;
  if (typeof message.type !== "string") throw new Error("메시지 형식이 올바르지 않습니다.");
  if (SIMPLE_MESSAGES.has(message.type)) return message as ClientMessage;

  if (message.type === "project.select") {
    if (typeof message.path !== "string" || !message.path.trim()) throw new Error("프로젝트 경로를 입력하세요.");
    return message as ClientMessage;
  }
  if (message.type === "turn.start") {
    if (typeof message.prompt !== "string") throw new Error("Codex에 전달할 업무를 입력하세요.");
    if (message.skillMode !== "auto" && message.skillMode !== "manual") throw new Error("스킬 선택 모드가 올바르지 않습니다.");
    if (message.skillPath !== undefined && typeof message.skillPath !== "string") throw new Error("스킬 경로가 올바르지 않습니다.");
    if (message.executionMode !== undefined && message.executionMode !== "solo" && message.executionMode !== "team") {
      throw new Error("실행 모드가 올바르지 않습니다.");
    }
    return message as ClientMessage;
  }
  if (message.type === "approval.resolve") {
    if (typeof message.approvalId !== "string" || !message.approvalId) throw new Error("승인 ID가 올바르지 않습니다.");
    if (typeof message.decision !== "string" || !APPROVAL_DECISIONS.has(message.decision)) {
      throw new Error("승인 결정이 올바르지 않습니다.");
    }
    return message as ClientMessage;
  }
  throw new Error("지원하지 않는 클라이언트 메시지입니다.");
}
