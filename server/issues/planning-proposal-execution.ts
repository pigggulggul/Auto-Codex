import type { PlanningDraft } from "./planning-draft.js";
import { buildPlanningProposalRequest, PlanningProposalSession } from "./planning-proposal.js";

type Snapshot = ReturnType<PlanningDraft["read"]>;
type Transport = { readonly busy: boolean; runProposal(snapshot: Snapshot, request: string, signal: AbortSignal): Promise<string> };
type Options = { owner: AbortSignal; permitted: () => boolean; acquire: () => (() => void) | null; load: (admitted: () => boolean) => Promise<Snapshot>; transport: Transport };

/** The owner supplies an authorized grant, snapshot recheck and process-tree
 * containment. Proposals never confer execution or approval permissions. */
export class PlanningProposalExecution {
  private state: "idle" | "running" | "complete" | "failed" | "interrupted" | "stale" | "termination-unconfirmed" = "idle";
  private session: PlanningProposalSession | null = null;
  private controller: AbortController | null = null;
  private held = false;
  constructor(private readonly options: Options) {}
  get busy() { return this.held; }
  status() { return { state: this.held && this.state === "interrupted" ? "running" as const : this.state, result: this.state === "complete" ? this.session?.read() ?? null : null }; }
  interrupt() { if (!this.held || !this.controller) return false; this.state = "interrupted"; this.controller.abort(); return true; }
  clear() { if (this.held) return false; this.session?.dispose(); this.session = null; this.state = "idle"; return true; }
  failRecording() { if (this.held) return; this.session?.dispose(); this.session = null; this.state = "failed"; }
  apply(draft: PlanningDraft, revision: number, id: string) { if (this.held || this.state !== "complete" || !this.session) throw new Error("Proposal unavailable"); this.session.apply(draft, revision, id); this.session = null; this.state = "idle"; }
  async start(request: string): Promise<void> {
    if (this.state !== "idle" || this.held || this.options.owner.aborted || !this.options.permitted()) throw new Error("Proposal unavailable");
    const release = this.options.acquire(); if (!release) throw new Error("Proposal busy");
    this.held = true; this.state = "running";
    const controller = new AbortController(); this.controller = controller;
    const valid = () => this.held && !controller.signal.aborted && !this.options.owner.aborted && this.options.permitted();
    const abort = () => this.interrupt(); this.options.owner.addEventListener("abort", abort, { once: true });
    try {
      const before = await this.options.load(valid); if (!valid()) return;
      buildPlanningProposalRequest(before, request);
      const raw = await this.options.transport.runProposal(before, request, controller.signal); if (!valid()) return;
      const after = await this.options.load(valid); if (!valid()) return;
      if (JSON.stringify(before) !== JSON.stringify(after)) { this.state = "stale"; return; }
      this.session = new PlanningProposalSession(before, raw); this.state = "complete";
    } catch (error) {
      if (!controller.signal.aborted) this.state = error && typeof error === "object" && "code" in error && error.code === "STALE_INPUT" ? "stale" : "failed";
    }
    finally {
      this.options.owner.removeEventListener("abort", abort); this.controller = null;
      if (this.options.transport.busy) { this.state = "termination-unconfirmed"; this.session?.dispose(); this.session = null; }
      else { this.held = false; release(); }
    }
  }
}
