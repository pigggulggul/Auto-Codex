import type { AnalysisBatch, AnalysisBatchOutcome } from "./analysis-batch.js";
import type { SegmentEvidence } from "./analysis-output.js";

export type AnalysisExecutionState = "preparing" | "running" | "complete" | "blocked" | "limit" | "interrupted" | "failed" | "termination-unconfirmed";
type Session = { batch?: AnalysisBatch; state: AnalysisExecutionState; cancelled: boolean; release: () => void; admitted: boolean };
type Options = { acquire: () => (() => void) | null; permitted: () => boolean; createBatch: (admitted: () => boolean) => Promise<AnalysisBatch>; transport: { readonly busy: boolean; run(input: SegmentEvidence & { instruction: string }, signal: AbortSignal): Promise<string> } };

/** Trusted per-connection coordinator. Callers must enforce view grants and route runtime events. */
export class AnalysisExecution {
  private session: Session | null = null;
  constructor(private readonly options: Options) {}
  status() { const s = this.session; return s ? { state: s.state, progress: s.batch?.progress() ?? null } : { state: "idle" as const, progress: null }; }
  segmentPage(index: number, offset: number) { const s = this.session; if (!s?.batch || s.cancelled && s.admitted) throw new Error("Analysis unavailable"); return s.batch.segmentPage(index, offset); }
  async start(maxSegments: number): Promise<void> {
    if (this.session || !this.options.permitted() || !Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 2048) throw new Error("Analysis unavailable");
    const release = this.options.acquire(); if (!release) throw new Error("Analysis busy");
    const s: Session = { state: "preparing", cancelled: false, release, admitted: true }; this.session = s;
    try {
      s.batch = await this.options.createBatch(() => s.admitted && !s.cancelled && this.options.permitted());
      if (s.cancelled || !this.options.permitted()) { s.batch.dispose(); s.state = "interrupted"; return; }
      await this.runBatch(s, maxSegments);
    } catch { s.state = this.options.transport.busy ? "termination-unconfirmed" : s.cancelled ? "interrupted" : "failed"; }
    finally {
      if (s.state !== "termination-unconfirmed") { s.admitted = false; s.release(); }
    }
  }
  private async runBatch(s: Session, maxSegments: number): Promise<void> {
    s.state = "running";
    const outcome: AnalysisBatchOutcome = await s.batch!.run((input, signal) => this.options.transport.run(input, signal), maxSegments);
    s.state = this.options.transport.busy ? "termination-unconfirmed" : outcome;
  }
  async retry(index: number): Promise<void> {
    const s = this.session;
    if (!s?.batch || s.admitted || !["blocked", "interrupted"].includes(s.state) || !this.options.permitted()) throw new Error("Retry unavailable");
    const page = s.batch.segmentPage(index, 0);
    if (!["failed", "interrupted"].includes(page.status)) throw new Error("Retry unavailable");
    const release = this.options.acquire(); if (!release) throw new Error("Analysis busy");
    s.release = release; s.admitted = true; s.cancelled = false;
    try { s.batch.retry(index); await this.runBatch(s, 2048); }
    catch { s.state = this.options.transport.busy ? "termination-unconfirmed" : s.cancelled ? "interrupted" : "failed"; }
    finally { if (s.state !== "termination-unconfirmed") { s.admitted = false; s.release(); } }
  }
  interrupt(): boolean { const s = this.session; if (!s || !["preparing", "running"].includes(s.state)) return false; s.cancelled = true; s.batch?.interrupt(); return true; }
  clear(): boolean { const s = this.session; if (!s || s.admitted) return false; s.batch?.dispose(); this.session = null; return true; }
}
