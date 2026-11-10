import { randomUUID } from "node:crypto";

type Outcome = "verification-finished" | "failed" | "interrupted" | "outcome-unknown";
type Item = { issueId: string; idempotencyKey: string; state: "pending" | "running" | Outcome | "blocked"; reason?: string };
type Options = {
  /** Must recheck the project, revision, live grant and prerequisites. */
  preflight(issueId: string): Promise<{ allowed: boolean; reason?: string }>;
  /** The runtime must record dispatch, confirm process termination and perform
   * verification before returning verification-finished. */
  execute(issueId: string, idempotencyKey: string, signal: AbortSignal): Promise<Outcome>;
};

/** Server-internal queue only. It confers no project or execution authority. */
export class IssueExecutionQueue {
  private readonly items: Item[];
  private readonly controller = new AbortController();
  private state: "idle" | "running" | "completed" | "limit" | "blocked" | "interrupted" | "outcome-unknown" = "idle";
  constructor(issueIds: readonly string[], private readonly maxStarts: number, private readonly options: Options) {
    if (!Array.isArray(issueIds) || issueIds.length < 1 || issueIds.length > 2048 || !Number.isSafeInteger(maxStarts) || maxStarts < 1 || maxStarts > issueIds.length || issueIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) || new Set(issueIds).size !== issueIds.length) throw new Error("Invalid issue queue");
    this.items = issueIds.map(issueId => ({ issueId, idempotencyKey: `attempt_${randomUUID()}`, state: "pending" }));
  }
  read() { return { state: this.state, items: structuredClone(this.items) }; }
  interrupt(): boolean { if (this.state !== "running") return false; this.controller.abort(); return true; }
  async run(): Promise<void> {
    if (this.state !== "idle") throw new Error("Queue cannot be restarted");
    this.state = "running";
    let started = 0;
    for (const item of this.items) {
      if (this.controller.signal.aborted) { this.state = "interrupted"; return; }
      if (started >= this.maxStarts) { this.state = "limit"; return; }
      let check: { allowed: boolean; reason?: string };
      try { check = await this.options.preflight(item.issueId); }
      catch { item.state = "blocked"; item.reason = "preflight-unavailable"; this.state = "blocked"; return; }
      if (this.controller.signal.aborted) { this.state = "interrupted"; return; }
      if (!check || check.allowed !== true) { item.state = "blocked"; item.reason = "precondition-unverified"; this.state = "blocked"; return; }
      item.state = "running";
      started++;
      let outcome: Outcome;
      try { outcome = await this.options.execute(item.issueId, item.idempotencyKey, this.controller.signal); }
      catch { outcome = "outcome-unknown"; }
      if (!["verification-finished", "failed", "interrupted", "outcome-unknown"].includes(outcome)) outcome = "outcome-unknown";
      item.state = outcome;
      if (outcome === "outcome-unknown") { this.state = "outcome-unknown"; return; }
      if (outcome !== "verification-finished") { this.state = outcome === "interrupted" ? "interrupted" : "blocked"; return; }
      if (this.controller.signal.aborted) { this.state = "interrupted"; return; }
    }
    this.state = "completed";
  }
}
