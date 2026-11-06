/**
 * Server-internal attempt projection. This does not start or stop a turn, persist
 * a journal, grant approval, or decide an issue's durable completion status.
 * Its caller must authenticate and correlate events with the actual App Server.
 */
export type AttemptState = {
  phase: "queued" | "dispatching" | "running" | "waiting_approval" | "verifying" | "settled";
  threadId: string | null;
  turnId: string | null;
  pendingApprovalIds: readonly string[];
  stopRequested: boolean;
  outcome: "failed" | "interrupted" | "outcome_unknown" | "verification_not_started" | "verification_finished" | "verification_failed" | "verification_interrupted" | null;
};

type TurnEvent = { threadId: string; turnId: string };
export type AttemptEvent =
  | { type: "dispatch" }
  | { type: "dispatch-unknown" }
  | { type: "dispatch-rejected" }
  | ({ type: "turn-bound" } & TurnEvent)
  | ({ type: "turn-started" } & TurnEvent)
  | ({ type: "approval-requested"; requestId: string } & TurnEvent)
  | ({ type: "approval-resolved"; requestId: string } & TurnEvent)
  | ({ type: "turn-finished"; result: "completed" | "failed" | "interrupted" } & TurnEvent)
  | { type: "stop-requested" }
  | ({ type: "verification-finished"; result: "finished" | "failed" | "interrupted" | "unknown" } & TurnEvent);

export function newAttempt(): AttemptState {
  return { phase: "queued", threadId: null, turnId: null, pendingApprovalIds: [], stopRequested: false, outcome: null };
}

const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);

/** Invalid, duplicate, unrelated and late events leave the projection unchanged. */
export function projectAttempt(state: AttemptState, event: AttemptEvent): AttemptState {
  if (state.phase === "settled") return state;
  if (event.type === "stop-requested") {
    if (state.stopRequested) return state;
    if (state.phase === "queued") return { ...state, phase: "settled", stopRequested: true, outcome: "interrupted" };
    return { ...state, stopRequested: true };
  }
  if (event.type === "dispatch") return state.phase === "queued" ? { ...state, phase: "dispatching" } : state;
  if (event.type === "dispatch-unknown" || event.type === "dispatch-rejected") {
    return state.phase === "dispatching" && (event.type === "dispatch-unknown" || state.turnId === null) ? { ...state, phase: "settled", outcome: event.type === "dispatch-unknown" ? "outcome_unknown" : "failed" } : state;
  }
  if (event.type === "turn-bound") {
    if (state.phase !== "dispatching" || state.turnId !== null || !validId(event.threadId) || !validId(event.turnId)) return state;
    return { ...state, threadId: event.threadId, turnId: event.turnId };
  }
  if (event.type === "turn-started") {
    if (state.phase !== "dispatching" || !state.turnId || event.threadId !== state.threadId || event.turnId !== state.turnId) return state;
    return { ...state, phase: "running" };
  }
  if (event.type === "verification-finished") {
    if (state.phase !== "verifying" || event.threadId !== state.threadId || event.turnId !== state.turnId) return state;
    const outcome = event.result === "finished" ? "verification_finished" : event.result === "failed" ? "verification_failed" : event.result === "interrupted" ? "verification_interrupted" : event.result === "unknown" ? "outcome_unknown" : null;
    return outcome ? { ...state, phase: "settled", outcome } : state;
  }
  if (event.threadId !== state.threadId || event.turnId !== state.turnId || !state.turnId) return state;
  if (event.type === "approval-requested") {
    if (!validId(event.requestId) || !["running", "waiting_approval"].includes(state.phase) || state.pendingApprovalIds.includes(event.requestId)) return state;
    return { ...state, phase: "waiting_approval", pendingApprovalIds: [...state.pendingApprovalIds, event.requestId] };
  }
  if (event.type === "approval-resolved") {
    if (state.phase !== "waiting_approval" || !state.pendingApprovalIds.includes(event.requestId)) return state;
    const pendingApprovalIds = state.pendingApprovalIds.filter(id => id !== event.requestId);
    return { ...state, phase: pendingApprovalIds.length ? "waiting_approval" : "running", pendingApprovalIds };
  }
  if (event.type === "turn-finished" && ["running", "waiting_approval"].includes(state.phase)) {
    if (state.pendingApprovalIds.length) return { ...state, phase: "settled", pendingApprovalIds: [], outcome: "outcome_unknown" };
    if (event.result === "completed") return state.stopRequested
      ? { ...state, phase: "settled", pendingApprovalIds: [], outcome: "verification_not_started" }
      : { ...state, phase: "verifying", pendingApprovalIds: [] };
    if (event.result === "failed" || event.result === "interrupted") return { ...state, phase: "settled", pendingApprovalIds: [], outcome: event.result };
  }
  return state;
}
