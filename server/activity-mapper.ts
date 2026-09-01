import { randomUUID } from "node:crypto";
import type { ActivityEvent, PetState } from "../shared/protocol.js";
import type { JsonObject, ProtocolNotification } from "./codex-app-server.js";

type Item = JsonObject & { type?: string; status?: string };

function event(state: PetState, title: string, detail: string | undefined, source: string): ActivityEvent {
  return {
    id: randomUUID(),
    state,
    title,
    detail,
    source,
    timestamp: new Date().toISOString(),
  };
}

function getItem(params?: JsonObject): Item | null {
  const value = params?.item;
  return value && typeof value === "object" ? (value as Item) : null;
}

function short(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function itemActivity(item: Item, completed: boolean, source: string): ActivityEvent | null {
  switch (item.type) {
    case "commandExecution":
      return event(
        completed ? (item.status === "failed" ? "error" : "thinking") : "running",
        completed ? "명령 실행 완료" : "명령 실행 중",
        short(item.command),
        source,
      );
    case "fileChange":
      return event(completed ? "thinking" : "editing", completed ? "파일 변경 완료" : "파일 수정 중", undefined, source);
    case "mcpToolCall":
      return event(completed ? "thinking" : "running", completed ? "도구 호출 완료" : "외부 도구 호출 중", short(item.tool), source);
    case "collabAgentToolCall":
      return event(completed ? "thinking" : "running", completed ? "협업 에이전트 완료" : "협업 에이전트 작업 중", short(item.tool), source);
    case "webSearch":
      return event(completed ? "thinking" : "reading", completed ? "웹 검색 완료" : "웹 검색 중", short(item.query), source);
    case "imageView":
      return event(completed ? "thinking" : "reading", completed ? "이미지 확인 완료" : "이미지 확인 중", short(item.path), source);
    case "reasoning":
    case "plan":
      return event("thinking", completed ? "계획 정리 완료" : "작업 계획 수립 중", undefined, source);
    case "agentMessage":
      return completed ? event("thinking", "응답 작성 완료", undefined, source) : null;
    case "contextCompaction":
      return event("thinking", "대화 맥락 정리 중", undefined, source);
    default:
      return null;
  }
}

export function mapNotification(notification: ProtocolNotification): ActivityEvent | null {
  const { method, params } = notification;
  if (method === "turn/started") return event("thinking", "Codex가 요청을 분석하고 있습니다", undefined, method);
  if (method === "turn/completed") {
    const turn = params?.turn as JsonObject | undefined;
    const status = turn?.status;
    if (status === "completed") return event("success", "작업이 완료되었습니다", undefined, method);
    if (status === "interrupted") return event("idle", "작업이 중단되었습니다", undefined, method);
    return event("error", "작업이 실패했습니다", short((turn?.error as JsonObject | undefined)?.message), method);
  }
  if (method === "error") {
    const errorValue = params?.error as JsonObject | undefined;
    return event("error", "Codex 오류", short(errorValue?.message), method);
  }
  if (method === "item/started") {
    const item = getItem(params);
    return item ? itemActivity(item, false, method) : null;
  }
  if (method === "item/completed") {
    const item = getItem(params);
    return item ? itemActivity(item, true, method) : null;
  }
  if (method === "item/commandExecution/outputDelta") return event("running", "명령 결과를 받고 있습니다", undefined, method);
  if (method === "item/fileChange/outputDelta") return event("editing", "파일 변경 내용을 적용하고 있습니다", undefined, method);
  if (method === "item/mcpToolCall/progress") return event("running", "도구가 작업 중입니다", short(params?.message), method);
  if (method === "turn/plan/updated" || method === "item/plan/delta") return event("thinking", "작업 계획을 갱신하고 있습니다", undefined, method);
  if (method === "item/agentMessage/delta") return event("thinking", "결과를 정리하고 있습니다", undefined, method);
  return null;
}

