import { describe, expect, it, vi } from "vitest";
import { AnalysisRouter } from "./analysis-router.js";
import type { AnalysisTransport } from "./analysis-transport.js";

describe("analysis event routing", () => {
  it("sends each event to at most one owning transport and permits unrelated fallback", () => {
    const router = new AnalysisRouter();
    const old = { notification: vi.fn(() => true), serverRequest: vi.fn(() => true) } as unknown as AnalysisTransport;
    const current = { notification: vi.fn(() => false), serverRequest: vi.fn(() => false) } as unknown as AnalysisTransport;
    router.register(old); router.register(current); router.register(current);
    expect(router.notification({ method: "item/completed", params: { threadId: "old" } })).toBe(true);
    expect(current.notification).toHaveBeenCalledOnce(); expect(old.notification).toHaveBeenCalledOnce();
    expect(router.serverRequest({ id: 7, method: "item/tool/requestUserInput", params: { threadId: "old" } })).toBe(true);
    expect(current.serverRequest).toHaveBeenCalledOnce(); expect(old.serverRequest).toHaveBeenCalledOnce();
    const empty = new AnalysisRouter(); expect(empty.notification({ method: "turn/started" })).toBe(false);
  });
  it("fails closed at the retention limit rather than forgetting old thread owners", () => {
    const router = new AnalysisRouter();
    for (let i = 0; i < 128; i++) router.register({ notification: () => false, serverRequest: () => false } as unknown as AnalysisTransport);
    expect(() => router.register({ notification: () => false, serverRequest: () => false } as unknown as AnalysisTransport)).toThrow(/limit/);
  });
  it("recovers capacity only when its owner reports confirmed stop", () => {
    const router = new AnalysisRouter();
    for (let i = 0; i < 128; i++) router.register({ notification: () => false, serverRequest: () => false } as unknown as AnalysisTransport);
    router.resetAfterConfirmedStop();
    const fresh = { notification: vi.fn(() => true), serverRequest: vi.fn(() => true) } as unknown as AnalysisTransport;
    router.register(fresh); router.register(fresh);
    expect(router.notification({ method: "item/completed", params: { threadId: "new" } })).toBe(true);
    expect(fresh.notification).toHaveBeenCalledOnce();
  });
});
