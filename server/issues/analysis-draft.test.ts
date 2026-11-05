import { describe, expect, it } from "vitest";
import { AnalysisDraft } from "./analysis-draft.js";
import { IssueSourceSessions } from "./source-session.js";

const input = (index: number) => ({ snapshotId: "snapshot-test", projectRevision: 3, sourceId: `source-${index}`, sourcePath: `source-${index}.md`, sourceSha256: "a".repeat(64), segmentId: `segment-${index}`, offset: 0, text: `synthetic source ${index}`, instruction: "synthetic request" });
const output = (index: number) => JSON.stringify({ requirements: [{ origin: "source", text: `candidate ${index}`, quote: `source ${index}`, uncertainty: "" }] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe("analysis draft orchestration", () => {
  it("keeps successful segments when another fails and retries only on request", async () => {
    const draft = new AnalysisDraft("snapshot-test", 3, 3, async index => input(index));
    await draft.runNext(async () => output(0));
    await draft.runNext(async () => "invalid JSON");
    expect(draft.inspect()).toMatchObject({ totalSegments: 3, processedSegments: 1, segments: [{ status: "processed", requirements: [{ text: "candidate 0" }] }, { status: "failed", error: "INVALID_OUTPUT" }, { status: "pending" }] });
    await draft.runNext(async () => output(2));
    expect(draft.inspect().processedSegments).toBe(2);
    draft.retry(1); await draft.runNext(async () => output(1));
    expect(draft.inspect().processedSegments).toBe(3);
  });
  it("rejects a changed segment after a model response", async () => {
    let changed = false; const draft = new AnalysisDraft("snapshot-test", 3, 1, async index => ({ ...input(index), text: changed ? "changed source" : input(index).text }));
    await draft.runNext(async () => { changed = true; return output(0); });
    expect(draft.inspect()).toMatchObject({ processedSegments: 0, segments: [{ status: "failed", error: "STALE_INPUT", requirements: [] }] });
  });
  it.each([
    ["snapshotId", "snapshot-replaced"], ["projectRevision", 4], ["sourceId", "source-replaced"],
    ["sourcePath", "other.md"], ["sourceSha256", "b".repeat(64)], ["segmentId", "segment-replaced"],
    ["offset", 1], ["text", "modified synthetic source 0"], ["instruction", "modified request"],
  ])("rejects a changed %s even when the loader reuses one mutable object", async (key, value) => {
    const shared = input(0);
    const draft = new AnalysisDraft("snapshot-test", 3, 1, async () => shared);
    await draft.runNext(async () => {
      Object.assign(shared, { [key]: value });
      return output(0);
    });
    expect(draft.inspect()).toMatchObject({ processedSegments: 0, segments: [{ status: "failed", error: "STALE_INPUT", requirements: [] }] });
  });
  it("passes a frozen copy of the documented segment fields to transport", async () => {
    const shared = { ...input(0), unrelated: "private loader metadata" };
    const draft = new AnalysisDraft("snapshot-test", 3, 1, async () => shared);
    await draft.runNext(async item => {
      expect(item).not.toBe(shared);
      expect(Object.isFrozen(item)).toBe(true);
      expect(item).not.toHaveProperty("unrelated");
      return output(0);
    });
    expect(draft.inspect().processedSegments).toBe(1);
  });
  it("discards a late result when the authorized selected copy is removed", async () => {
    const sessions = new IssueSourceSessions(() => 0), session = new AbortController();
    const sources = sessions.add(session.signal, 1, "C:/project", 1000, 3, { relativePath: "plan.md", text: "synthetic source 0", bytes: 18, sha256: "a".repeat(64) });
    const snapshot = sessions.prepare(session.signal, 1, "C:/project", 3, { expectedRevision: 3, expectedSources: sources.items.map(({ id, sha256 }) => ({ id, sha256 })), instruction: "" });
    const draft = new AnalysisDraft(snapshot.id, 3, snapshot.totalSegments, async index => sessions.analysisSegment(session.signal, 1, "C:/project", 3, snapshot.id, index));
    const started = deferred<void>(), finish = deferred<string>();
    const pending = draft.runNext(async () => { started.resolve(); return finish.promise; }); await started.promise;
    sessions.remove(session.signal, 1, "C:/project", sources.items[0].id); finish.resolve(output(0)); await pending;
    expect(draft.inspect()).toMatchObject({ processedSegments: 0, segments: [{ status: "failed", error: "STALE_INPUT", requirements: [] }] }); session.abort();
  });
  it("ignores late output after interruption and holds admission until transport settles", async () => {
    const draft = new AnalysisDraft("snapshot-test", 3, 1, async index => input(index)), started = deferred<void>(), finish = deferred<string>();
    const pending = draft.runNext(async (_item, signal) => { started.resolve(); const result = await finish.promise; expect(signal.aborted).toBe(true); return result; });
    await started.promise; draft.interrupt();
    await expect(draft.runNext(async () => output(0))).rejects.toThrow(/already running/);
    expect(() => draft.retry(0)).toThrow();
    finish.resolve(output(0)); await pending;
    expect(draft.inspect()).toMatchObject({ processedSegments: 0, segments: [{ status: "interrupted", requirements: [] }] });
    draft.retry(0); await draft.runNext(async () => output(0)); expect(draft.inspect().processedSegments).toBe(1);
  });
  it("does not expose transport errors or mark failed output processed", async () => {
    const draft = new AnalysisDraft("snapshot-test", 3, 1, async index => input(index));
    await draft.runNext(async () => { throw new Error("private synthetic failure"); });
    expect(draft.inspect()).toMatchObject({ processedSegments: 0, segments: [{ status: "failed", error: "MODEL_FAILED", requirements: [] }] });
    expect(JSON.stringify(draft.inspect())).not.toContain("private synthetic failure");
  });
  it("releases retained candidates and forbids reuse after disposal", async () => {
    const draft = new AnalysisDraft("snapshot-test", 3, 2, async index => input(index));
    await draft.runNext(async () => output(0));
    expect(draft.inspect().segments[0].requirements).toHaveLength(1);
    draft.dispose();
    draft.dispose();
    expect(draft.inspect().segments.every(segment => segment.requirements.length === 0)).toBe(true);
    await expect(draft.runNext(async () => output(1))).rejects.toThrow(/unavailable/);
    expect(() => draft.retry(0)).toThrow();
  });
  it("keeps earlier segments and marks an over-limit segment failed without truncating it", async () => {
    const draft = new AnalysisDraft("snapshot-test", 3, 17, async index => input(index));
    for (let index = 0; index < 17; index++) {
      const candidate = { origin: "source", text: `candidate ${index}`, quote: `source ${index}`, uncertainty: "" };
      await draft.runNext(async () => JSON.stringify({ requirements: Array(32).fill(candidate) }));
    }
    const result = draft.inspect();
    expect(result.processedSegments).toBe(16); expect(result.segments[15].requirements).toHaveLength(32);
    expect(result.segments[16]).toMatchObject({ status: "failed", error: "LIMIT_EXCEEDED", requirements: [] });
  });
});
