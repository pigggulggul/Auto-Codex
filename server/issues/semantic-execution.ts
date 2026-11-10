import { SemanticValidationRun, type SemanticInput } from "./semantic-validation.js";

type Transport = { readonly busy: boolean; runSemantic(input: SemanticInput, signal: AbortSignal): Promise<string> };
type Options = { owner: AbortSignal; permitted: () => boolean; acquire: () => (() => void) | null; load: (admitted: () => boolean) => Promise<SemanticInput>; transport: Transport };

/** The owner must supply a view grant, source revalidation, dedicated transport
 * and shared admission. A lost termination confirmation keeps admission held. */
export class SemanticExecution {
  private run: SemanticValidationRun | null = null;
  private held = false;
  private terminationUnconfirmed = false;
  constructor(private readonly options: Options) {}
  get busy() { return this.held; }
  status() { const current = this.run?.read(); return { state: this.terminationUnconfirmed ? "termination-unconfirmed" as const : this.held && current?.state === "interrupted" ? "running" as const : current?.state ?? "idle" as const, result: this.terminationUnconfirmed ? null : current?.result ?? null }; }
  interrupt() { if (!this.held || !this.run) return false; this.run.interrupt(); return true; }
  clear() { if (this.held) return false; this.run?.dispose(); this.run = null; return true; }
  async start(): Promise<void> {
    if (this.run || this.held || this.options.owner.aborted || !this.options.permitted()) throw new Error("Semantic validation unavailable");
    const release = this.options.acquire(); if (!release) throw new Error("Semantic validation busy");
    this.held = true;
    const permitted = () => this.held && !this.options.owner.aborted && this.options.permitted();
    const run = new SemanticValidationRun(async () => { if (!permitted()) throw new Error("Grant expired"); const input = await this.options.load(permitted); if (!permitted()) throw new Error("Grant expired"); return input; });
    this.run = run;
    const abort = () => run.interrupt(); this.options.owner.addEventListener("abort", abort, { once: true });
    try { await run.start((input, _request, signal) => this.options.transport.runSemantic(input, signal)); }
    finally {
      this.options.owner.removeEventListener("abort", abort);
      if (this.options.transport.busy) { this.terminationUnconfirmed = true; run.dispose(); }
      else { this.held = false; release(); }
    }
  }
}
