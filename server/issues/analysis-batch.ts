import { AnalysisDraft } from "./analysis-draft.js";

type Transport = Parameters<AnalysisDraft["runNext"]>[0];
export type AnalysisBatchOutcome = "complete" | "blocked" | "limit" | "interrupted";

/**
 * Server-internal sequencing only. The caller owns authorization, input freshness,
 * tool isolation and shared runtime admission; this class grants none of them.
 */
export class AnalysisBatch {
  private running = false;
  private stopRequested = false;
  private disposed = false;

  constructor(private readonly draft: AnalysisDraft) {}

  inspect() {
    return { running: this.running, disposed: this.disposed, ...this.draft.inspect() };
  }

  interrupt(): void {
    if (!this.running) return;
    this.stopRequested = true;
    this.draft.interrupt();
  }

  dispose(): void {
    this.disposed = true;
    this.interrupt();
    this.draft.dispose();
  }

  retry(index: number): void {
    if (this.disposed || this.running) throw new Error("Analysis batch is unavailable");
    this.draft.retry(index);
  }

  async run(transport: Transport, maxSegments: number): Promise<AnalysisBatchOutcome> {
    if (this.disposed || this.running) throw new Error("Analysis batch is unavailable");
    if (!Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 2048) throw new Error("Invalid segment limit");
    this.running = true;
    this.stopRequested = false;
    try {
      let started = 0;
      while (true) {
        if (this.stopRequested) return "interrupted";
        const progress = this.draft.progress();
        if (progress.failed || progress.interrupted) return "blocked";
        if (!progress.pending) return "complete";
        if (started === maxSegments) return "limit";
        started++;
        await this.draft.runNext(transport);
      }
    } finally {
      this.running = false;
    }
  }
}
