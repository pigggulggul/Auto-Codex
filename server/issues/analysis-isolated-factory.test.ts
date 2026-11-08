import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { AnalysisBatch } from "./analysis-batch.js";
import { AnalysisDraft } from "./analysis-draft.js";
import { createIsolatedAnalysisFactory } from "./analysis-isolated-factory.js";

const input = { snapshotId: "snapshot", projectRevision: 1, sourceId: "source", sourcePath: "synthetic.md", sourceSha256: "a".repeat(64), segmentId: "segment", offset: 0, text: "synthetic", instruction: "" };
const batch = async () => new AnalysisBatch(new AnalysisDraft("snapshot", 1, 1, async () => input));

describe("isolated analysis factory", () => {
  it("does not start a worker after the owner or project selection changes", async () => {
    let generation = 1;
    const spawnWorker = vi.fn(() => spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: ["pipe", "pipe", "pipe"] }));
    const create = createIsolatedAnalysisFactory({ root: process.cwd(), platform: "win32", selection: () => ({ workspaceMode: "project", projectPath: "C:/synthetic", generation }), model: () => "synthetic-model", ready: () => true, validateProject: async value => value, acquire: () => () => {}, spawnWorker });
    const owner = new AbortController(), first = create(batch, owner.signal); if (!first) throw new Error("missing execution");
    generation++; await expect(first.start(1)).rejects.toThrow(); expect(spawnWorker).not.toHaveBeenCalled();
    const second = create(batch, owner.signal); if (!second) throw new Error("missing execution");
    owner.abort(); await expect(second.start(1)).rejects.toThrow(); expect(spawnWorker).not.toHaveBeenCalled();
  });
  it("rejects unsupported platforms and missing models before worker creation", () => {
    const create = createIsolatedAnalysisFactory({ root: process.cwd(), platform: "linux", selection: () => ({ workspaceMode: "project", projectPath: "/synthetic", generation: 1 }), model: () => "synthetic-model", ready: () => true, validateProject: async value => value, acquire: () => () => {} });
    expect(create(batch, new AbortController().signal)).toBeNull();
    const missingModel = createIsolatedAnalysisFactory({ root: process.cwd(), platform: "win32", selection: () => ({ workspaceMode: "project", projectPath: "C:/synthetic", generation: 1 }), model: () => null, ready: () => true, validateProject: async value => value, acquire: () => () => {} });
    expect(missingModel(batch, new AbortController().signal)).toBeNull();
  });
});
