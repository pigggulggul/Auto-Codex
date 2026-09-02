import type { TokenUsageEntry } from "../shared/protocol.js";
import type { JsonObject, ProtocolNotification } from "./codex-app-server.js";

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function totalTokens(value: unknown): number | null {
  const usage = object(value);
  if (!usage) return null;
  const direct = finiteNumber(usage.totalTokens) ?? finiteNumber(usage.total_tokens);
  if (direct !== null) return Math.round(direct);
  const input = finiteNumber(usage.inputTokens) ?? finiteNumber(usage.input_tokens);
  const output = finiteNumber(usage.outputTokens) ?? finiteNumber(usage.output_tokens);
  return input !== null || output !== null ? Math.round((input ?? 0) + (output ?? 0)) : null;
}

export function parseTokenUsage(
  notification: ProtocolNotification,
  fallbackTurnId: string | null,
  now = new Date(),
): TokenUsageEntry | null {
  if (notification.method !== "thread/tokenUsage/updated" && notification.method !== "turn/completed") return null;
  const params = notification.params;
  if (!params) return null;
  const turn = object(params.turn);
  const tokenUsage = object(params.tokenUsage ?? params.token_usage);
  const candidates = [
    tokenUsage?.last,
    tokenUsage?.lastTokenUsage,
    tokenUsage?.last_token_usage,
    params.lastTokenUsage,
    params.last_token_usage,
    turn?.usage,
    turn?.tokenUsage,
    turn?.token_usage,
    params.usage,
  ];
  const count = candidates.map(totalTokens).find((value): value is number => value !== null);
  if (count === undefined) return null;
  const turnId = text(params.turnId) ?? text(params.turn_id) ?? text(turn?.id) ?? fallbackTurnId;
  if (!turnId) return null;
  return { turnId, totalTokens: count, timestamp: now.toISOString() };
}
