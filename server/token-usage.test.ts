import { describe, expect, it } from "vitest";
import { parseTokenUsage } from "./token-usage.js";

describe("parseTokenUsage", () => {
  it("reads the last turn usage from thread usage notifications", () => {
    expect(parseTokenUsage({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: { last: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } },
      },
    }, null, new Date("2026-09-02T12:00:00Z"))).toEqual({
      turnId: "turn-1",
      totalTokens: 150,
      timestamp: "2026-09-02T12:00:00.000Z",
    });
  });

  it("falls back to completed turn usage and the active turn id", () => {
    expect(parseTokenUsage({
      method: "turn/completed",
      params: { turn: { usage: { input_tokens: 8, output_tokens: 5 } } },
    }, "turn-fallback")?.totalTokens).toBe(13);
  });
});
