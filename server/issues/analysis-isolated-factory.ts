import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { AnalysisExecution } from "./analysis-execution.js";
import type { AnalysisBatch } from "./analysis-batch.js";
import { IsolatedAnalysisTransport } from "./analysis-isolated-transport.js";
import { SemanticExecution } from "./semantic-execution.js";
import type { SemanticInput } from "./semantic-validation.js";
import { PlanningProposalExecution } from "./planning-proposal-execution.js";
import type { PlanningDraft } from "./planning-draft.js";

type Selection = { workspaceMode: "project" | "research"; projectPath: string | null; generation: number };
type Options = { root: string; selection(): Selection; model(): string | null; ready(): boolean; validateProject(path: string): Promise<string>; acquire(): (() => void) | null; spawnWorker?: () => ChildProcessWithoutNullStreams; platform?: NodeJS.Platform };

/** Uses a fresh, tool-disabled worker; browser input never supplies configuration. */
export function createIsolatedAnalysisFactory(options: Options) {
  return (createBatch: (admitted: () => boolean) => Promise<AnalysisBatch>, owner: AbortSignal): AnalysisExecution | null => {
    const selected = options.selection(), model = options.model();
    const platform = options.platform ?? process.platform;
    if (platform !== "win32" || owner.aborted || selected.workspaceMode !== "project" || !selected.projectPath || !model || !options.ready()) return null;
    const selectedPath = selected.projectPath;
    const permitted = () => { const current = options.selection(); return !owner.aborted && options.ready() && current.workspaceMode === "project" && current.projectPath === selectedPath && current.generation === selected.generation; };
    const transport = new IsolatedAnalysisTransport({ root: options.root, model, permitted, spawnWorker: options.spawnWorker, validateProject: async () => {
      const resolved = await options.validateProject(selectedPath);
      if ((platform === "win32" ? resolved.toLowerCase() !== selectedPath.toLowerCase() : resolved !== selectedPath) || !permitted()) throw new Error("Project changed");
    } });
    return new AnalysisExecution({ createBatch, permitted, transport, acquire: options.acquire });
  };
}

/** Separate semantic worker with the same server-owned policy and admission. */
export function createIsolatedSemanticFactory(options: Options) {
  return (load: (admitted: () => boolean) => Promise<SemanticInput>, owner: AbortSignal): SemanticExecution | null => {
    const selected = options.selection(), model = options.model(), platform = options.platform ?? process.platform;
    if (platform !== "win32" || owner.aborted || selected.workspaceMode !== "project" || !selected.projectPath || !model || !options.ready()) return null;
    const selectedPath = selected.projectPath;
    const permitted = () => { const current = options.selection(); return !owner.aborted && options.ready() && current.workspaceMode === "project" && current.projectPath === selectedPath && current.generation === selected.generation; };
    const transport = new IsolatedAnalysisTransport({ root: options.root, model, permitted, spawnWorker: options.spawnWorker, validateProject: async () => {
      const resolved = await options.validateProject(selectedPath);
      if ((platform === "win32" ? resolved.toLowerCase() !== selectedPath.toLowerCase() : resolved !== selectedPath) || !permitted()) throw new Error("Project changed");
    } });
    return new SemanticExecution({ owner, permitted, transport, acquire: options.acquire, load });
  };
}

export function createIsolatedPlanningProposalFactory(options: Options) {
  return (load: (admitted: () => boolean) => Promise<ReturnType<PlanningDraft["read"]>>, owner: AbortSignal): PlanningProposalExecution | null => {
    const selected = options.selection(), model = options.model(), platform = options.platform ?? process.platform;
    if (platform !== "win32" || owner.aborted || selected.workspaceMode !== "project" || !selected.projectPath || !model || !options.ready()) return null;
    const selectedPath = selected.projectPath;
    const permitted = () => { const current = options.selection(); return !owner.aborted && options.ready() && current.workspaceMode === "project" && current.projectPath === selectedPath && current.generation === selected.generation; };
    const transport = new IsolatedAnalysisTransport({ root: options.root, model, permitted, spawnWorker: options.spawnWorker, validateProject: async () => {
      const resolved = await options.validateProject(selectedPath);
      if ((platform === "win32" ? resolved.toLowerCase() !== selectedPath.toLowerCase() : resolved !== selectedPath) || !permitted()) throw new Error("Project changed");
    } });
    return new PlanningProposalExecution({ owner, permitted, transport, acquire: options.acquire, load });
  };
}
