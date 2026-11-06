import type { ProtocolServerRequest } from "../codex-app-server.js";
import { AnalysisExecution } from "./analysis-execution.js";
import type { AnalysisBatch } from "./analysis-batch.js";
import { AnalysisTransport } from "./analysis-transport.js";
import type { AnalysisRouter } from "./analysis-router.js";

/** This value must originate from a future server-owned verifier, never the renderer. */
export type VerifiedAnalysisPolicy = { verified: true; config: Record<string, boolean | string>; disabledPluginIds: string[] };
type Selection = { workspaceMode: "project" | "research"; projectPath: string | null; generation: number };
type Server = { request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T>; respondError(id: ProtocolServerRequest["id"], code: number, message: string): void; stopAndWait(): Promise<void> };
type Options = { server: Server; router: AnalysisRouter; policy(): VerifiedAnalysisPolicy | null; policyCurrent(policy: VerifiedAnalysisPolicy): boolean; selection(): Selection; model(): string | null; ready(): boolean; validateProject(path: string): Promise<string>; acquire(): (() => void) | null };

/** The production caller must provide a genuine verifier; null always denies startup. */
export function createAnalysisRuntimeFactory(options: Options) {
  return (createBatch: (admitted: () => boolean) => Promise<AnalysisBatch>): AnalysisExecution | null => {
    const policy = options.policy(), selected = options.selection(), model = options.model();
    if (!policy || policy.verified !== true || selected.workspaceMode !== "project" || !selected.projectPath || !model || !options.ready() || !options.policyCurrent(policy)) return null;
    const selectedPath = selected.projectPath; let ownsAdmission = false;
    const permitted = () => { const current = options.selection(); return options.ready() && options.policyCurrent(policy) && current.workspaceMode === "project" && current.generation === selected.generation && current.projectPath === selectedPath; };
    const transport = new AnalysisTransport(options.server, {
      cwd: async () => { const resolved = await options.validateProject(selectedPath); const same = process.platform === "win32" ? resolved.toLowerCase() === selectedPath.toLowerCase() : resolved === selectedPath; if (!same || !permitted()) throw new Error("Project changed"); return resolved; },
      model, config: { ...policy.config }, disabledPluginIds: [...policy.disabledPluginIds],
      canRun: () => ownsAdmission && permitted(), acquire: () => ownsAdmission && permitted() ? () => {} : null,
    });
    options.router.register(transport);
    return new AnalysisExecution({ createBatch, permitted, transport, acquire: () => {
      const release = options.acquire(); if (!release) return null; ownsAdmission = true;
      return () => { ownsAdmission = false; release(); };
    } });
  };
}
