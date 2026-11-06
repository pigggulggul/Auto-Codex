import { describe, expect, it } from "vitest";
import { AnalysisBatch } from "./analysis-batch.js";
import { AnalysisDraft } from "./analysis-draft.js";
import { AnalysisExecution } from "./analysis-execution.js";
import type { AnalysisTransport } from "./analysis-transport.js";

const input = { snapshotId: "snapshot", projectRevision: 1, sourceId: "source", sourcePath: "synthetic.md", sourceSha256: "a".repeat(64), segmentId: "segment", offset: 0, text: "synthetic source", instruction: "" };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const batch = () => new AnalysisBatch(new AnalysisDraft("snapshot", 1, 1, async () => input));
describe("analysis execution coordinator", () => {
  it("holds shared admission through completion and exposes only counts", async () => {
    const finish = deferred<string>(), entered = deferred<void>(); let released = 0;
    const transport = { busy: false, run: async () => { entered.resolve(); return finish.promise; } } as unknown as AnalysisTransport;
    const execution = new AnalysisExecution({ permitted: () => true, acquire: () => () => { released++; }, createBatch: async () => batch(), transport });
    const started = execution.start(1); await entered.promise;
    expect(execution.status()).toMatchObject({ state: "running", progress: { running: 1 } });
    expect(JSON.stringify(execution.status())).not.toContain("synthetic source"); expect(execution.clear()).toBe(false);
    finish.resolve('{"requirements":[]}'); await started;
    expect(execution.status()).toMatchObject({ state: "complete", progress: { processed: 1 } }); expect(released).toBe(1); expect(execution.clear()).toBe(true);
  });
  it("cancels preparation without dispatch and releases after the pending creation settles", async () => {
    const pending = deferred<AnalysisBatch>(); let released = 0, dispatched = 0;
    const transport = { busy: false, run: async () => { dispatched++; return '{}'; } } as unknown as AnalysisTransport;
    const execution = new AnalysisExecution({ permitted: () => true, acquire: () => () => { released++; }, createBatch: () => pending.promise, transport });
    const started = execution.start(1); expect(execution.interrupt()).toBe(true); expect(released).toBe(0); pending.resolve(batch()); await started;
    expect(dispatched).toBe(0); expect(released).toBe(1); expect(execution.status().state).toBe("interrupted");
  });
  it("interrupts an active segment but waits for transport settlement before releasing", async () => {
    const finish = deferred<string>(), entered = deferred<void>(); let released = 0, aborted = false;
    const transport = { busy: false, run: async (_input: unknown, signal: AbortSignal) => { entered.resolve(); const value = await finish.promise; aborted = signal.aborted; return value; } } as unknown as AnalysisTransport;
    const execution = new AnalysisExecution({ permitted: () => true, acquire: () => () => { released++; }, createBatch: async () => batch(), transport });
    const started = execution.start(1); await entered.promise; expect(execution.interrupt()).toBe(true); expect(released).toBe(0);
    finish.resolve('{"requirements":[]}'); await started;
    expect(aborted).toBe(true); expect(released).toBe(1); expect(execution.status()).toMatchObject({ state: "interrupted", progress: { processed: 0 } });
  });
  it("does not release shared admission when transport termination is unconfirmed", async () => {
    let released = 0;
    const transport = { busy: true, run: async () => { throw new Error("synthetic failure"); } } as unknown as AnalysisTransport;
    const execution = new AnalysisExecution({ permitted: () => true, acquire: () => () => { released++; }, createBatch: async () => batch(), transport });
    await execution.start(1); expect(execution.status().state).toBe("termination-unconfirmed"); expect(released).toBe(0); expect(execution.clear()).toBe(false);
  });
  it("retains completed candidates across a failed segment and retries only that segment", async () => {
    let calls = 0, releases = 0;
    const good = JSON.stringify({ requirements: [{ origin: "source", text: "candidate", quote: "synthetic", uncertainty: "" }] });
    const transport = { busy: false, run: async () => ++calls === 2 ? "invalid" : good } as unknown as AnalysisTransport;
    const execution = new AnalysisExecution({ permitted: () => true, acquire: () => () => { releases++; }, createBatch: async () => new AnalysisBatch(new AnalysisDraft("snapshot", 1, 2, async index => ({ ...input, segmentId: `segment-${index}` }))), transport });
    await execution.start(2); expect(execution.status().state).toBe("blocked");
    const first = execution.segmentPage(0, 0); expect(first.items).toHaveLength(1); expect(execution.segmentPage(1, 0)).toMatchObject({ status: "failed", error: "INVALID_OUTPUT" });
    await expect(execution.retry(0)).rejects.toThrow(); expect(releases).toBe(1);
    await execution.retry(1); expect(execution.status().state).toBe("complete"); expect(execution.segmentPage(0, 0).items[0].id).toBe(first.items[0].id); expect(calls).toBe(3); expect(releases).toBe(2);
  });
  it("does not acquire or dispatch when policy is unverified", async () => {
    let acquired = 0;
    const execution = new AnalysisExecution({ permitted: () => false, acquire: () => { acquired++; return () => {}; }, createBatch: async () => batch(), transport: {} as AnalysisTransport });
    await expect(execution.start(1)).rejects.toThrow(); expect(acquired).toBe(0);
  });
});
