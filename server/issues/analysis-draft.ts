import { AnalysisOutputError, parseSegmentRequirements, type RequirementCandidate, type SegmentEvidence } from "./analysis-output.js";

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
  constructor(readonly snapshotId: string, readonly projectRevision: number, totalSegments: number, private readonly loadSegment: (index: number) => Promise<Input>) {
    if (!Number.isSafeInteger(projectRevision) || projectRevision < 1 || !Number.isSafeInteger(totalSegments) || totalSegments < 0 || totalSegments > 2048 || !snapshotId) throw new Error("Invalid analysis draft");
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
  interrupt(): void {
    if (!this.active) return;
    this.segments[this.active.index] = { status: "interrupted", requirements: [] };
    this.active.controller.abort();
  }
  retry(index: number): void {
    if (this.active || !Number.isSafeInteger(index) || !["failed", "interrupted"].includes(this.segments[index]?.status)) throw new Error("Segment cannot be retried");
    this.segments[index] = { status: "pending", requirements: [] };
  }
  async runNext(transport: Transport): Promise<void> {
    if (this.active) throw new Error("Analysis already running");
    const index = this.segments.findIndex(item => item.status === "pending");
    if (index < 0) throw new Error("No pending segment");
    const run = { index, controller: new AbortController() }; this.active = run;
    this.segments[index] = { status: "running", requirements: [] };
    try {
      const input = await this.loadSegment(index);
      if (run.controller.signal.aborted) return;
      if (input.snapshotId !== this.snapshotId || input.projectRevision !== this.projectRevision) throw new StaleInput();
      const raw = await transport(Object.freeze({ ...input }), run.controller.signal);
      if (run.controller.signal.aborted) return;
      const current = await this.loadSegment(index);
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
