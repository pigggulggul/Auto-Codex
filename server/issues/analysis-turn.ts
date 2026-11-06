import type { ProtocolNotification } from "../codex-app-server.js";

type Outcome = { status: "completed"; text: string } | { status: "failed" | "interrupted" | "invalid" };
type Buffered = { turnId: string; text: string | null; finalSeen: boolean; outcome: Outcome | null };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const protocolId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);

/**
 * Collects one real turn's final output on a dedicated thread. It does not start
 * a turn, authorize tools, enforce admission, or establish process termination.
 * Notifications can arrive before the turn/start response; they are provisional
 * until the response's turn ID is bound. Caller owns timeouts and interruption.
 */
export class AnalysisTurnCapture {
  private turnId: string | null = null;
  private buffered: Buffered | null = null;
  private invalid = false;
  constructor(private readonly threadId: string) {
    if (!protocolId(threadId)) throw new Error("Invalid thread ID");
  }
  bind(turnId: string): void {
    if (!protocolId(turnId) || this.turnId !== null || this.buffered && this.buffered.turnId !== turnId) { this.invalid = true; return; }
    this.turnId = turnId;
  }
  receive(event: ProtocolNotification): boolean {
    const params = event.params;
    if (!object(params) || params.threadId !== this.threadId) return false;
    if (event.method !== "item/completed" && event.method !== "turn/completed") return true;
    const turn = object(params.turn) ? params.turn : null;
    const eventTurnId = event.method === "turn/completed" ? turn?.id : params.turnId;
    if (!protocolId(eventTurnId)) { this.invalid = true; return true; }
    if (this.turnId && eventTurnId !== this.turnId) return true;
    if (this.buffered && this.buffered.turnId !== eventTurnId) { this.invalid = true; return true; }
    const state = this.buffered ??= { turnId: eventTurnId, text: null, finalSeen: false, outcome: null };
    if (state.outcome) { this.invalid = true; return true; }
    if (event.method === "item/completed") {
      const item = params.item;
      if (!object(item) || item.type !== "agentMessage" || item.phase === "commentary") return true;
      // Accept only one completed final message; never combine commentary, deltas,
      // or multiple messages into a seemingly valid JSON response.
      if (state.finalSeen || typeof item.text !== "string" || Buffer.byteLength(item.text, "utf8") > 64 * 1024) { this.invalid = true; return true; }
      state.finalSeen = true; state.text = item.text;
    } else {
      const status = turn?.status;
      state.outcome = status === "completed" ? state.finalSeen && state.text !== null ? { status: "completed", text: state.text } : { status: "invalid" } : status === "interrupted" ? { status: "interrupted" } : status === "failed" ? { status: "failed" } : { status: "invalid" };
    }
    return true;
  }
  result(): Outcome | null {
    if (this.invalid) return { status: "invalid" };
    if (!this.turnId || !this.buffered?.outcome) return null;
    return this.buffered.outcome;
  }
}
