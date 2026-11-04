import { describe, expect, it, vi } from "vitest";
import { IssueSourceSessions, segmentAnalysisSource } from "./source-session.js";

const input = (relativePath: string, text: string, sha256 = "a".repeat(64)) => ({ relativePath, text, bytes: Buffer.byteLength(text), sha256 });
describe("ephemeral selected source copies", () => {
  it("segments every character deterministically without splitting Unicode pairs", () => {
    const text = `${"a".repeat(8191)}😀${"b".repeat(9000)}`, hash = "a".repeat(64);
    const segments = segmentAnalysisSource("source-1", hash, text);
    expect(segments).toHaveLength(3);
    expect(segments.map(item => text.slice(item.start, item.end)).join("")).toBe(text);
    expect(segments[0].end).toBe(8191); expect(segments[1].start).toBe(8191);
    expect(segmentAnalysisSource("source-1", hash, text)).toEqual(segments);
    expect(segmentAnalysisSource("source-2", hash, text)[0].id).not.toBe(segments[0].id);
    expect(segmentAnalysisSource("source-1", hash, "")).toEqual([]);
  });
  it("prepares only the exact selected source versions and current project revision", () => {
    const store = new IssueSourceSessions(() => 0), socket = new AbortController();
    const items = store.add(socket.signal, 1, "C:/project", 1000, 2, input("docs/plan.md", `${"a".repeat(8191)}😀`)).items;
    const request = { expectedRevision: 2, expectedSources: items.map(({ id, sha256 }) => ({ id, sha256 })), instruction: "synthetic instruction" };
    const snapshot = store.prepare(socket.signal, 1, "C:/project", 2, request);
    expect(store.snapshotFiles(socket.signal, 1, "C:/project", 2, snapshot.id)).toEqual(items);
    expect(() => store.snapshotFiles(socket.signal, 1, "C:/project", 3, snapshot.id)).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(snapshot).toMatchObject({ projectRevision: 2, totalSegments: 2, processedSegments: 0, hasInstruction: true, sources: [{ relativePath: "docs/plan.md", segmentCount: 2 }] });
    const first = store.analysisSegment(socket.signal, 1, "C:/project", 2, snapshot.id, 0);
    snapshot.sources[0].sha256 = "b".repeat(64);
    expect(store.analysisSegment(socket.signal, 1, "C:/project", 2, snapshot.id, 0).sourceSha256).toBe(items[0].sha256);
    const second = store.analysisSegment(socket.signal, 1, "C:/project", 2, snapshot.id, 1);
    expect(first.text + second.text).toBe(`${"a".repeat(8191)}😀`); expect(second.offset).toBe(8191);
    expect(first).toMatchObject({ sourceId: items[0].id, sourceSha256: items[0].sha256, instruction: "synthetic instruction" });
    expect(() => store.analysisSegment(new AbortController().signal, 1, "C:/project", 2, snapshot.id, 0)).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(() => store.analysisSegment(socket.signal, 1, "C:/project", 3, snapshot.id, 0)).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(() => store.analysisSegment(socket.signal, 1, "C:/project", 2, snapshot.id, 2)).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(JSON.stringify(snapshot)).not.toContain("synthetic instruction");
    expect(() => store.prepare(socket.signal, 1, "C:/project", 3, request)).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(() => store.prepare(socket.signal, 1, "C:/project", 2, { ...request, expectedSources: [{ ...request.expectedSources[0], sha256: "b".repeat(64) }] })).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(() => store.prepare(socket.signal, 1, "C:/project", 2, { ...request, instruction: "x".repeat(1025) })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    store.remove(socket.signal, 1, "C:/project", items[0].id);
    expect(() => store.snapshotFiles(socket.signal, 1, "C:/project", 2, snapshot.id)).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(() => store.analysisSegment(socket.signal, 1, "C:/project", 2, snapshot.id, 0)).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    expect(() => store.prepare(socket.signal, 1, "C:/project", 2, request)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" })); socket.abort();
  });
  it("isolates sockets and selection generations, and clears on abort", () => {
    const store = new IssueSourceSessions(() => 100), first = new AbortController(), other = new AbortController();
    const selected = store.add(first.signal, 1, "C:/project", 1000, 2, input("docs/plan.md", "synthetic"));
    expect(selected.items).toHaveLength(1); expect(selected.items[0]).not.toHaveProperty("text");
    expect(store.list(other.signal, 1, "C:/project").items).toEqual([]);
    expect(store.list(first.signal, 2, "C:/project").items).toEqual([]);
    store.add(first.signal, 2, "C:/project", 1000, 2, input("docs/plan.md", "synthetic")); first.abort();
    expect(store.list(first.signal, 2, "C:/project").items).toEqual([]);
  });
  it("pages the immutable selected copy without splitting surrogate pairs", () => {
    const store = new IssueSourceSessions(() => 0), socket = new AbortController(), text = `${"a".repeat(8191)}😀end`;
    const item = store.add(socket.signal, 1, "C:/project", 1000, 1, input("plan.md", text)).items[0];
    const first = store.read(socket.signal, 1, "C:/project", item.id, 0);
    expect(first.text).toBe("a".repeat(8191)); expect(first.nextOffset).toBe(8191);
    const last = store.read(socket.signal, 1, "C:/project", item.id, first.nextOffset!);
    expect(last.text).toBe("😀end"); expect(last.nextOffset).toBeNull();
    expect(() => store.read(socket.signal, 1, "C:/project", item.id, 8192)).toThrowError(/위치/);
    expect(store.remove(socket.signal, 1, "C:/project", item.id).items).toEqual([]);
    expect(() => store.read(socket.signal, 1, "C:/project", item.id, 0)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    store.clearAll();
  });
  it("rejects changed duplicate paths and enforces source count", () => {
    const store = new IssueSourceSessions(() => 0), socket = new AbortController();
    const first = store.add(socket.signal, 1, "C:/project", 1000, 1, input("plan.md", "old"));
    expect(store.add(socket.signal, 1, "C:/project", 1000, 2, input("PLAN.md", "old"))).toEqual(first);
    expect(() => store.add(socket.signal, 1, "C:/project", 1000, 2, input("plan.md", "new", "b".repeat(64)))).toThrow(expect.objectContaining({ code: "STALE_INPUT" }));
    for (let i = 1; i < 16; i++) store.add(socket.signal, 1, "C:/project", 1000, 1, input(`item-${i}.txt`, ""));
    expect(() => store.add(socket.signal, 1, "C:/project", 1000, 1, input("overflow.txt", ""))).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    store.clearAll();
  });
  it("expires and clears the copy even without a later read", () => {
    vi.useFakeTimers();
    try {
      let now = 0; const store = new IssueSourceSessions(() => now), socket = new AbortController();
      store.add(socket.signal, 1, "C:/project", 1000, 1, input("plan.md", "synthetic"));
      now = 1000; vi.advanceTimersByTime(1000);
      expect(store.list(socket.signal, 1, "C:/project").items).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
