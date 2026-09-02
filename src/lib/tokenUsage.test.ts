import { describe, expect, it } from "vitest";
import { mergeTokenUsage, summarizeTokenUsage } from "./tokenUsage";

describe("token usage ledger", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("replaces repeated updates for the same turn instead of double counting", () => {
    const entries = mergeTokenUsage(
      [{ turnId: "one", totalTokens: 100, timestamp: "2026-09-02T10:00:00Z" }],
      { turnId: "one", totalTokens: 180, timestamp: "2026-09-02T11:00:00Z" },
      now,
    );
    expect(entries).toHaveLength(1);
    expect(summarizeTokenUsage(entries, now).week).toBe(180);
  });

  it("separates today's total from the rolling seven-day total", () => {
    const summary = summarizeTokenUsage([
      { turnId: "today", totalTokens: 100, timestamp: "2026-09-02T10:00:00Z" },
      { turnId: "older", totalTokens: 250, timestamp: "2026-08-30T10:00:00Z" },
    ], now);
    expect(summary).toEqual({ today: 100, week: 350, lastTurn: 100 });
  });
});
