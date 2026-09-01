import type { JsonObject } from "./codex-app-server.js";

export type RuntimeContext = {
  runId: string;
  taskId: string;
  agentId: string;
  threadId: string;
  turnId: string | null;
};

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class RuntimeRegistry {
  private readonly byThread = new Map<string, RuntimeContext>();
  private readonly byTurn = new Map<string, RuntimeContext>();

  bindThread(context: Omit<RuntimeContext, "turnId">): RuntimeContext {
    const existing = this.byThread.get(context.threadId);
    if (existing && (existing.runId !== context.runId || existing.taskId !== context.taskId)) {
      throw new Error(`스레드 ${context.threadId}가 이미 다른 작업에 연결되어 있습니다.`);
    }
    const bound = { ...context, turnId: existing?.turnId ?? null };
    this.byThread.set(context.threadId, bound);
    if (bound.turnId) this.byTurn.set(bound.turnId, bound);
    return bound;
  }

  bindTurn(threadId: string, turnId: string): RuntimeContext {
    const context = this.byThread.get(threadId);
    if (!context) throw new Error(`등록되지 않은 스레드의 작업을 연결할 수 없습니다: ${threadId}`);
    if (context.turnId && context.turnId !== turnId) this.byTurn.delete(context.turnId);
    const bound = { ...context, turnId };
    this.byThread.set(threadId, bound);
    this.byTurn.set(turnId, bound);
    return bound;
  }

  resolve(params?: JsonObject): RuntimeContext | null {
    if (!params) return null;
    const nestedTurn = params.turn && typeof params.turn === "object" ? params.turn as JsonObject : undefined;
    const turnId = stringField(params.turnId) ?? stringField(nestedTurn?.id);
    if (turnId) {
      const byTurn = this.byTurn.get(turnId);
      if (byTurn) return byTurn;
    }
    const threadId = stringField(params.threadId);
    return threadId ? (this.byThread.get(threadId) ?? null) : null;
  }

  completeTurn(turnId: string): RuntimeContext | null {
    const context = this.byTurn.get(turnId);
    if (!context) return null;
    this.byTurn.delete(turnId);
    const completed = { ...context, turnId: null };
    this.byThread.set(context.threadId, completed);
    return context;
  }

  removeRun(runId: string): void {
    for (const [threadId, context] of this.byThread) {
      if (context.runId !== runId) continue;
      this.byThread.delete(threadId);
      if (context.turnId) this.byTurn.delete(context.turnId);
    }
  }

  clear(): void {
    this.byThread.clear();
    this.byTurn.clear();
  }
}
