import { describe, expect, it } from "vitest";
import { newAttempt, projectAttempt } from "./execution-attempt.js";

const turn = { threadId: "thread-1", turnId: "turn-1" };
const running = () => projectAttempt(projectAttempt(projectAttempt(newAttempt(), { type: "dispatch" }), { type: "turn-bound", ...turn }), { type: "turn-started", ...turn });

describe("issue attempt projection", () => {
  it("requires an observed turn start and keeps completion separate from verification", () => {
    const queued = newAttempt();
    const dispatching = projectAttempt(queued, { type: "dispatch" });
    expect(dispatching.phase).toBe("dispatching");
    expect(projectAttempt(dispatching, { type: "turn-finished", ...turn, result: "completed" })).toBe(dispatching);
    expect(projectAttempt(dispatching, { type: "turn-started", ...turn })).toBe(dispatching);
    const bound = projectAttempt(dispatching, { type: "turn-bound", ...turn });
    expect(projectAttempt(bound, { type: "turn-started", ...turn, turnId: "other" })).toBe(bound);
    expect(projectAttempt(bound, { type: "dispatch-rejected" })).toBe(bound);
    const active = projectAttempt(bound, { type: "turn-started", ...turn });
    expect(active.phase).toBe("running");
    const verifying = projectAttempt(active, { type: "turn-finished", ...turn, result: "completed" });
    expect(verifying).toMatchObject({ phase: "verifying", outcome: null });
    expect(projectAttempt(verifying, { type: "verification-finished", ...turn, result: "finished" })).toMatchObject({ phase: "settled", outcome: "verification_finished" });
  });
  it("tracks multiple actual pending requests and ignores unrelated or duplicate events", () => {
    const active = running();
    expect(projectAttempt(active, { type: "approval-requested", ...turn, turnId: "other", requestId: "a" })).toBe(active);
    const waiting = projectAttempt(active, { type: "approval-requested", ...turn, requestId: "a" });
    expect(projectAttempt(waiting, { type: "approval-requested", ...turn, requestId: "a" })).toBe(waiting);
    const both = projectAttempt(waiting, { type: "approval-requested", ...turn, requestId: "b" });
    expect(projectAttempt(both, { type: "approval-resolved", ...turn, requestId: "unknown" })).toBe(both);
    const one = projectAttempt(both, { type: "approval-resolved", ...turn, requestId: "a" });
    expect(one).toMatchObject({ phase: "waiting_approval", pendingApprovalIds: ["b"] });
    expect(projectAttempt(one, { type: "approval-resolved", ...turn, requestId: "b" }).phase).toBe("running");
  });
  it("does not treat interrupt request as proof of turn termination", () => {
    const active = running(), stopping = projectAttempt(active, { type: "stop-requested" });
    expect(stopping).toMatchObject({ phase: "running", stopRequested: true, outcome: null });
    expect(projectAttempt(stopping, { type: "turn-finished", ...turn, result: "interrupted" })).toMatchObject({ phase: "settled", outcome: "interrupted" });
    expect(projectAttempt(stopping, { type: "turn-finished", ...turn, result: "completed" })).toMatchObject({ phase: "settled", outcome: "verification_not_started", stopRequested: true });
    expect(projectAttempt(newAttempt(), { type: "stop-requested" })).toMatchObject({ phase: "settled", outcome: "interrupted" });
  });
  it("keeps uncertain dispatch terminal and ignores late events", () => {
    const uncertain = projectAttempt(projectAttempt(newAttempt(), { type: "dispatch" }), { type: "dispatch-unknown" });
    expect(uncertain).toMatchObject({ phase: "settled", outcome: "outcome_unknown" });
    expect(projectAttempt(uncertain, { type: "turn-started", ...turn })).toBe(uncertain);
    expect(projectAttempt(uncertain, { type: "dispatch" })).toBe(uncertain);
  });
  it("records a stop during verification without implying the verification has terminated", () => {
    const verifying = projectAttempt(running(), { type: "turn-finished", ...turn, result: "completed" });
    const stopping = projectAttempt(verifying, { type: "stop-requested" });
    expect(stopping).toMatchObject({ phase: "verifying", stopRequested: true, outcome: null });
    expect(projectAttempt(stopping, { type: "verification-finished", ...turn, result: "interrupted" })).toMatchObject({ phase: "settled", stopRequested: true, outcome: "verification_interrupted" });
  });
  it("retains a stop requested while dispatch is in flight when the turn arrives later", () => {
    const dispatching = projectAttempt(newAttempt(), { type: "dispatch" });
    const stopping = projectAttempt(dispatching, { type: "stop-requested" });
    const bound = projectAttempt(stopping, { type: "turn-bound", ...turn });
    const started = projectAttempt(bound, { type: "turn-started", ...turn });
    expect(started).toMatchObject({ phase: "running", stopRequested: true });
    expect(projectAttempt(started, { type: "turn-finished", ...turn, result: "completed" })).toMatchObject({ phase: "settled", outcome: "verification_not_started" });
  });
  it("keeps verification failures and uncertain termination separate from successful completion", () => {
    const verifying = projectAttempt(running(), { type: "turn-finished", ...turn, result: "completed" });
    expect(projectAttempt(verifying, { type: "verification-finished", ...turn, result: "failed" })).toMatchObject({ phase: "settled", outcome: "verification_failed" });
    expect(projectAttempt(verifying, { type: "verification-finished", ...turn, result: "unknown" })).toMatchObject({ phase: "settled", outcome: "outcome_unknown" });
    const malformed = { type: "verification-finished" } as unknown as Parameters<typeof projectAttempt>[1];
    expect(projectAttempt(verifying, malformed)).toBe(verifying);
  });
  it("ignores malformed outcomes instead of manufacturing an attempt result", () => {
    const active = running();
    const malformed = { type: "turn-finished", ...turn, result: "unknown" } as unknown as Parameters<typeof projectAttempt>[1];
    expect(projectAttempt(active, malformed)).toBe(active);
    expect(projectAttempt(active, { type: "turn-finished", ...turn, result: "failed" })).toMatchObject({ phase: "settled", outcome: "failed" });
  });
  it("ignores verification from another turn and rejects control characters in IDs", () => {
    const verifying = projectAttempt(running(), { type: "turn-finished", ...turn, result: "completed" });
    expect(projectAttempt(verifying, { type: "verification-finished", ...turn, turnId: "other", result: "finished" })).toBe(verifying);
    const dispatching = projectAttempt(newAttempt(), { type: "dispatch" });
    expect(projectAttempt(dispatching, { type: "turn-bound", threadId: "thread\nforged", turnId: "turn" })).toBe(dispatching);
  });
  it("does not infer termination or verification from a turn with unresolved approvals", () => {
    const waiting = projectAttempt(running(), { type: "approval-requested", ...turn, requestId: "request" });
    expect(projectAttempt(waiting, { type: "turn-finished", ...turn, result: "completed" })).toMatchObject({ phase: "settled", outcome: "outcome_unknown" });
  });
});
