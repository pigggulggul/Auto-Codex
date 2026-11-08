import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { SegmentEvidence } from "./analysis-output.js";

type Input = SegmentEvidence & { instruction: string };
type Options = { root: string; model: string; permitted(): boolean; validateProject(): Promise<void>; spawnWorker?: () => ChildProcessWithoutNullStreams; timeoutMs?: number; cancelTimeoutMs?: number };

/** One restricted App Server per segment. Only source text crosses this internal IPC. */
export class IsolatedAnalysisTransport {
  private active = false;
  private stuck = false;
  constructor(private readonly options: Options) {}
  get busy(): boolean { return this.active || this.stuck; }

  async run(input: Input, signal: AbortSignal): Promise<string> {
    if (this.busy || signal.aborted || !this.options.permitted()) throw new Error("Analysis unavailable");
    this.active = true;
    let childStarted = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => reject(new Error("Analysis cancelled"));
        signal.addEventListener("abort", aborted, { once: true });
        Promise.resolve().then(() => this.options.validateProject()).then(() => { signal.removeEventListener("abort", aborted); resolve(); }, () => { signal.removeEventListener("abort", aborted); reject(new Error("Project unavailable")); });
        if (signal.aborted) aborted();
      });
      if (signal.aborted || !this.options.permitted()) throw new Error("Analysis cancelled");
      const child = this.options.spawnWorker?.() ?? spawn(process.execPath, [path.join(this.options.root, "tools", "verify-issue-real-model.mjs"), "--worker"], { cwd: this.options.root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      childStarted = true;
      return await new Promise<string>((resolve, reject) => {
        let output = "", bytes = 0, finished = false, cancelRequested = false;
        let cancelTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (safe: boolean, result?: string) => {
          if (finished) return; finished = true;
          clearTimeout(deadline); if (cancelTimer) clearTimeout(cancelTimer); signal.removeEventListener("abort", cancel);
          if (!safe) this.stuck = true;
          if (safe && !cancelRequested && !signal.aborted && typeof result === "string") resolve(result);
          else reject(new Error(safe ? "Analysis failed or was interrupted" : "Analysis termination could not be confirmed"));
        };
        const cancel = () => {
          if (finished || cancelRequested) return;
          cancelRequested = true;
          try { child.stdin.write('{"cancel":true}\n'); } catch { /* Wait for a confirmed exit. */ }
          cancelTimer = setTimeout(() => { try { child.kill(); } catch { /* Keep admission latched. */ } finish(false); }, this.options.cancelTimeoutMs ?? 30000);
          cancelTimer.unref();
        };
        const deadline = setTimeout(cancel, this.options.timeoutMs ?? 180000); deadline.unref();
        signal.addEventListener("abort", cancel, { once: true });
        child.stderr.resume();
        child.stdin.on("error", cancel);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk, "utf8");
          if (bytes > 256 * 1024) { cancel(); return; }
          output += chunk;
        });
        child.once("error", () => finish(false));
        child.once("close", (code, childSignal) => {
          let reply: unknown; try { reply = JSON.parse(output); } catch { finish(false); return; }
          if (!reply || typeof reply !== "object" || Array.isArray(reply)) { finish(false); return; }
          const record = reply as Record<string, unknown>;
          if (record.termination !== "confirmed" || childSignal !== null || !(code === 0 && record.ok === true || code === 1 && record.ok === false)) { finish(false); return; }
          if (record.ok === true && typeof record.output === "string" && Buffer.byteLength(record.output, "utf8") <= 64 * 1024) finish(true, record.output);
          else if (record.ok === false) finish(true);
          else finish(false);
        });
        try { child.stdin.write(`${JSON.stringify({ text: input.text, instruction: input.instruction, model: this.options.model })}\n`); }
        catch { cancel(); }
        if (signal.aborted) cancel();
      });
    } finally {
      if (!childStarted || !this.stuck) this.active = false;
    }
  }
}
