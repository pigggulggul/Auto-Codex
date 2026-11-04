import { describe, expect, it } from "vitest";
import { AnalysisBatch } from "./analysis-batch.js";
import { AnalysisDraft } from "./analysis-draft.js";

const input = (index: number) => ({ snapshotId: "snapshot-test", projectRevision: 1, sourceId: `source-${index}`, sourcePath: `source-${index}.md`, sourceSha256: "a".repeat(64), segmentId: `segment-${index}`, offset: 0, text: `synthetic source ${index}`, instruction: "" });
const output = (index: number) => JSON.stringify({ requirements: [{ origin: "source", text: `candidate ${index}`, quote: `source ${index}`, uncertainty: "" }] });
const batch = (count: number) => new AnalysisBatch(new AnalysisDraft("snapshot-test", 1, count, async index => input(index)));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe("analysis batch sequencing", () => {
  it("processes segments in order and respects the explicit per-run limit", async () => {
    const analysis = batch(3), calls: string[] = [];
    const transport = async (segment: ReturnType<typeof input>) => { calls.push(segment.segmentId); return output(Number(segment.segmentId.at(-1))); };
    expect(await analysis.run(transport, 2)).toBe("limit");
    expect(calls).toEqual(["segment-0", "segment-1"]);
    expect(analysis.inspect()).toMatchObject({ running: false, processedSegments: 2, segments: [{ status: "processed" }, { status: "processed" }, { status: "pending" }] });
    expect(await analysis.run(transport, 2)).toBe("complete");
    expect(calls).toEqual(["segment-0", "segment-1", "segment-2"]);
  });

  it("stops on invalid output, preserves earlier results, and requires explicit retry", async () => {
    const analysis = batch(3), calls: string[] = [];
    const failing = async (segment: ReturnType<typeof input>) => { calls.push(segment.segmentId); return segment.segmentId === "segment-1" ? "invalid" : output(Number(segment.segmentId.at(-1))); };
    expect(await analysis.run(failing, 3)).toBe("blocked");
    expect(calls).toEqual(["segment-0", "segment-1"]);
    expect(analysis.inspect()).toMatchObject({ processedSegments: 1, segments: [{ status: "processed", requirements: [{ text: "candidate 0" }] }, { status: "failed", error: "INVALID_OUTPUT" }, { status: "pending" }] });
    expect(await analysis.run(failing, 3)).toBe("blocked");
    expect(calls).toHaveLength(2);
    analysis.retry(1);
    expect(await analysis.run(async segment => output(Number(segment.segmentId.at(-1))), 3)).toBe("complete");
    expect(analysis.inspect().processedSegments).toBe(3);
  });

  it("holds the batch until interrupted transport settles and discards its late result", async () => {
    const analysis = batch(2), started = deferred<void>(), finish = deferred<string>();
    const pending = analysis.run(async (_segment, signal) => { started.resolve(); const result = await finish.promise; expect(signal.aborted).toBe(true); return result; }, 2);
    await started.promise;
    analysis.interrupt();
    await expect(analysis.run(async () => output(0), 2)).rejects.toThrow(/unavailable/);
    expect(() => analysis.retry(0)).toThrow(/unavailable/);
    expect(analysis.inspect()).toMatchObject({ running: true, segments: [{ status: "interrupted" }, { status: "pending" }] });
    finish.resolve(output(0));
    expect(await pending).toBe("interrupted");
    expect(await analysis.run(async () => output(0), 2)).toBe("blocked");
    analysis.retry(0);
    expect(await analysis.run(async segment => output(Number(segment.segmentId.at(-1))), 2)).toBe("complete");
  });

  it("stops remaining segments if the authorized input becomes stale", async () => {
    let stale = false, calls = 0;
    const draft = new AnalysisDraft("snapshot-test", 1, 2, async index => ({ ...input(index), text: stale ? "changed source" : input(index).text }));
    const analysis = new AnalysisBatch(draft);
    expect(await analysis.run(async () => { calls++; stale = true; return output(0); }, 2)).toBe("blocked");
    expect(calls).toBe(1);
    expect(analysis.inspect()).toMatchObject({ processedSegments: 0, segments: [{ status: "failed", error: "STALE_INPUT", requirements: [] }, { status: "pending" }] });
  });

  it("does not start more work after disposal and waits for an active transport to settle", async () => {
    const analysis = batch(2), started = deferred<void>(), finish = deferred<string>();
    const pending = analysis.run(async () => { started.resolve(); return finish.promise; }, 2);
    await started.promise; analysis.dispose();
    expect(analysis.inspect()).toMatchObject({ running: true, disposed: true });
    await expect(analysis.run(async () => output(0), 1)).rejects.toThrow(/unavailable/);
    finish.resolve(output(0)); expect(await pending).toBe("interrupted");
    expect(analysis.inspect()).toMatchObject({ running: false, processedSegments: 0, segments: [{ status: "interrupted" }, { status: "pending" }] });
    expect(() => analysis.retry(0)).toThrow(/unavailable/);
  });

  it("rejects invalid limits without dispatching and completes an empty draft", async () => {
    const analysis = batch(1); let calls = 0;
    for (const limit of [0, -1, 2049, 1.5, NaN]) await expect(analysis.run(async () => { calls++; return output(0); }, limit)).rejects.toThrow(/limit/);
    expect(calls).toBe(0);
    expect(await batch(0).run(async () => { calls++; return output(0); }, 1)).toBe("complete");
    expect(calls).toBe(0);
  });
});
