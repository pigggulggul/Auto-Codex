import { AnalysisOutputError, parseSegmentRequirements, type RequirementCandidate, type SegmentEvidence } from "./analysis-output.js";
import type { AnalysisSegmentPage } from "../../shared/issues/sources.js";

type SegmentStatus = "pending" | "running" | "processed" | "failed" | "interrupted";
type Failure = "STALE_INPUT" | "INVALID_OUTPUT" | "MODEL_FAILED" | "LIMIT_EXCEEDED";
type SegmentState = { status: SegmentStatus; error?: Failure; requirements: RequirementCandidate[] };
type Input = SegmentEvidence & { instruction: string };
type Transport = (input: Input, signal: AbortSignal) => Promise<string>;
const MAX_REQUIREMENTS = 512;

/** In-memory orchestration only. A caller must enforce grant, revision and runtime permissions in loadSegment and transport. */
export class AnalysisDraft {
  private readonly segments: SegmentState[];
  private active: { index: number; controller: AbortController } | null = null;
  private disposed = false;
  private loadSegment: ((index: number) => Promise<Input>) | null;
  constructor(readonly snapshotId: string, readonly projectRevision: number, totalSegments: number, loadSegment: (index: number) => Promise<Input>) {
    if (!Number.isSafeInteger(projectRevision) || projectRevision < 1 || !Number.isSafeInteger(totalSegments) || totalSegments < 0 || totalSegments > 2048 || !snapshotId) throw new Error("Invalid analysis draft");
    this.loadSegment = loadSegment;
    this.segments = Array.from({ length: totalSegments }, () => ({ status: "pending", requirements: [] }));
  }
  inspect() {
    return { snapshotId: this.snapshotId, projectRevision: this.projectRevision, totalSegments: this.segments.length, processedSegments: this.segments.filter(item => item.status === "processed").length, segments: structuredClone(this.segments) };
  }
  /** Counts only; unlike inspect(), this does not copy candidate text on every batch step. */
  progress() {
    const counts: Record<SegmentStatus, number> = { pending: 0, running: 0, processed: 0, failed: 0, interrupted: 0 };
    for (const segment of this.segments) counts[segment.status]++;
    return counts;
  }
  /** One segment and a bounded candidate page; no instruction or raw source is returned. */
  segmentPage(index: number, offset: number): AnalysisSegmentPage {
    if (this.disposed || !Number.isSafeInteger(index) || index < 0 || index >= this.segments.length || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid segment position");
    const segment = this.segments[index]; if (offset > segment.requirements.length) throw new Error("Invalid candidate position");
    const items: RequirementCandidate[] = []; let bytes = 1024;
    for (const candidate of segment.requirements.slice(offset, offset + 32)) {
      const size = Buffer.byteLength(JSON.stringify(candidate), "utf8") + 1;
      if (bytes + size > 192 * 1024) break;
      items.push(candidate); bytes += size;
    }
    if (!items.length && offset < segment.requirements.length) throw new Error("Candidate exceeds response limit");
    return structuredClone({ index, status: segment.status, error: segment.error ?? null, items, nextOffset: offset + items.length < segment.requirements.length ? offset + items.length : null });
  }
  interrupt(): void {
    if (!this.active) return;
    this.segments[this.active.index] = { status: "interrupted", requirements: [] };
    this.active.controller.abort();
  }
  /** Release retained candidates and the source loader; in-flight transport data cannot be recalled. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.interrupt();
    this.loadSegment = null;
    for (const segment of this.segments) segment.requirements = [];
  }
  retry(index: number): void {
    if (this.disposed || this.active || !Number.isSafeInteger(index) || !["failed", "interrupted"].includes(this.segments[index]?.status)) throw new Error("Segment cannot be retried");
    this.segments[index] = { status: "pending", requirements: [] };
  }
  async runNext(transport: Transport): Promise<void> {
    if (this.disposed || !this.loadSegment) throw new Error("Analysis draft is unavailable");
    if (this.active) throw new Error("Analysis already running");
    const index = this.segments.findIndex(item => item.status === "pending");
    if (index < 0) throw new Error("No pending segment");
    const run = { index, controller: new AbortController() }; this.active = run;
    this.segments[index] = { status: "running", requirements: [] };
    try {
      const loaded = await this.loadSegment(index);
      // Keep the exact values supplied to the transport, not a potentially
      // reusable/mutable loader object. All contract fields are primitives.
      const input = Object.freeze({ snapshotId: loaded.snapshotId, projectRevision: loaded.projectRevision, sourceId: loaded.sourceId, sourcePath: loaded.sourcePath, sourceSha256: loaded.sourceSha256, segmentId: loaded.segmentId, offset: loaded.offset, text: loaded.text, instruction: loaded.instruction });
      if (run.controller.signal.aborted) return;
      if (input.snapshotId !== this.snapshotId || input.projectRevision !== this.projectRevision) throw new StaleInput();
      const raw = await transport(input, run.controller.signal);
      if (run.controller.signal.aborted) return;
      const loader = this.loadSegment;
      if (!loader) return;
      const current = await loader(index);
      if (run.controller.signal.aborted) return;
      if (current.snapshotId !== input.snapshotId || current.projectRevision !== input.projectRevision || current.segmentId !== input.segmentId || current.sourceId !== input.sourceId || current.sourcePath !== input.sourcePath || current.sourceSha256 !== input.sourceSha256 || current.offset !== input.offset || current.text !== input.text || current.instruction !== input.instruction) throw new StaleInput();
      const parsed = parseSegmentRequirements(raw, input);
      const count = this.segments.reduce((sum, item) => sum + item.requirements.length, 0);
      if (count + parsed.requirements.length > MAX_REQUIREMENTS) { this.segments[index] = { status: "failed", error: "LIMIT_EXCEEDED", requirements: [] }; return; }
      this.segments[index] = { status: "processed", requirements: parsed.requirements };
    } catch (error) {
      if (run.controller.signal.aborted) return;
      const code = error instanceof AnalysisOutputError ? "INVALID_OUTPUT" : error instanceof StaleInput || error instanceof Error && "code" in error && error.code === "STALE_INPUT" ? "STALE_INPUT" : "MODEL_FAILED";
      this.segments[index] = { status: "failed", error: code, requirements: [] };
    } finally { if (this.active === run) this.active = null; }
  }
}
class StaleInput extends Error {}
