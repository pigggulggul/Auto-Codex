import { describe, expect, it } from "vitest";
import { IssueProjectContext, type IssueProjectSelection } from "./project-context.js";
import { IssueWorkerClientError } from "./worker-client.js";
import type { IssueWorkerRequest, IssueWorkerResult } from "./worker-contract.js";

const project = { id: "project_12345678-1234-4123-8123-123456789abc", revision: 1 };
const initial = (): IssueProjectSelection => ({ workspaceMode: "project", projectPath: "C:/synthetic/one", generation: 1 });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("bridge-owned issue project context", () => {
  it("uses the selected bridge path and never creates a binding during lookup", async () => {
    const calls: IssueWorkerRequest[] = [], selection = initial();
    const context = new IssueProjectContext(() => selection, { request: async input => { calls.push(input); return { kind: "project.lookup", project: null }; } });
    expect(await context.status()).toEqual({ project: null });
    expect(calls).toEqual([{ operation: "project.lookup", selectedPath: "C:/synthetic/one" }]);
    expect(JSON.stringify(await context.status())).not.toContain("synthetic");
  });
  it("creates only on explicit bind, and returns existing bindings without creating again", async () => {
    let bound = false; const calls: string[] = [];
    const context = new IssueProjectContext(initial, { request: async input => {
      calls.push(input.operation);
      if (input.operation === "project.lookup") return { kind: "project.lookup", project: bound ? project : null };
      if (input.operation === "project.create") { bound = true; return { kind: "project", ...project }; }
      throw new Error("unexpected operation");
    } });
    expect(await context.bind()).toEqual({ project, alreadyBound: false });
    expect(await context.bind()).toEqual({ project, alreadyBound: true });
    expect(calls).toEqual(["project.lookup", "project.create", "project.lookup"]);
  });
  it("rejects old lookup results even if selection switches away and back", async () => {
    let selection = initial(); const waiting = deferred<IssueWorkerResult>();
    const context = new IssueProjectContext(() => selection, { request: () => waiting.promise });
    const result = context.status(); selection = { ...selection, generation: 3 }; waiting.resolve({ kind: "project.lookup", project });
    await expect(result).rejects.toMatchObject({ code: "STALE_SELECTION" });
  });
  it("does not report a created binding as the currently selected project after a switch", async () => {
    let selection = initial(); const creating = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(() => selection, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project: null }); started.resolve(); return creating.promise; } });
    const result = context.bind(); await started.promise;
    selection = { ...selection, projectPath: "C:/synthetic/two", generation: 2 }; creating.resolve({ kind: "project", ...project });
    await expect(result).rejects.toMatchObject({ code: "STALE_SELECTION" });
  });
  it("preserves an unknown mutation outcome when selection changes", async () => {
    let selection = initial(); const creating = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(() => selection, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project: null }); started.resolve(); return creating.promise; } });
    const result = context.bind(); await started.promise;
    selection = { ...selection, generation: 2 };
    creating.reject(new IssueWorkerClientError("OUTCOME_UNKNOWN", "synthetic"));
    await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("resolves simultaneous binding only by rechecking the same selected project", async () => {
    let count = 0;
    const context = new IssueProjectContext(initial, { request: async input => {
      if (input.operation === "project.lookup") return { kind: "project.lookup", project: count++ ? project : null };
      throw new IssueWorkerClientError("BINDING_EXISTS", "synthetic");
    } });
    expect(await context.bind()).toEqual({ project, alreadyBound: true });
  });
  it("requires a selected project and rejects research mode", async () => {
    const context = new IssueProjectContext(() => ({ workspaceMode: "research", projectPath: null, generation: 2 }), { request: async () => { throw new Error("must not call"); } });
    await expect(context.status()).rejects.toMatchObject({ code: "PROJECT_REQUIRED" });
    await expect(context.bind()).rejects.toMatchObject({ code: "PROJECT_REQUIRED" });
  });
  it("does not dispatch an import after the caller withdraws while lookup is pending", async () => {
    const waiting = deferred<IssueWorkerResult>(), operations: string[] = []; let allowed = true;
    const context = new IssueProjectContext(initial, { request: input => { operations.push(input.operation); return waiting.promise; } });
    const result = context.importDocument(new Uint8Array([1]), () => allowed);
    allowed = false; waiting.resolve({ kind: "project.lookup", project });
    await expect(result).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(operations).toEqual(["project.lookup"]);
  });
  it("binds requirement detail to the selected project and discards it if the view grant expires", async () => {
    const waiting = deferred<IssueWorkerResult>(), started = deferred<void>(), calls: IssueWorkerRequest[] = []; let allowed = true;
    const context = new IssueProjectContext(initial, { request: input => { calls.push(input); if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return waiting.promise; } });
    const pending = context.view({ kind: "requirementDetail", documentId: "doc-1", expectedRevision: 1, requirementId: "req-1", offset: 0 }, () => allowed);
    await started.promise;
    expect(calls[1]).toEqual({ operation: "requirement.detail", projectId: project.id, documentId: "doc-1", expectedRevision: 1, requirementId: "req-1", offset: 0 });
    allowed = false; waiting.resolve({ kind: "requirement.detail", requirement: { id: "req-1", text: "합성", origin: "user", sourceName: null, locator: null, category: null, linkedIssueCount: 0 }, page: { items: [], nextOffset: null } });
    await expect(pending).rejects.toMatchObject({ code: "STALE_SELECTION" });
  });
  it("preserves an unknown document import result after project selection changes", async () => {
    let selection = initial(); const importing = deferred<IssueWorkerResult>(), started = deferred<void>();
    const context = new IssueProjectContext(() => selection, { request: input => { if (input.operation === "project.lookup") return Promise.resolve({ kind: "project.lookup", project }); started.resolve(); return importing.promise; } });
    const result = context.importDocument(new Uint8Array([1]), () => true); await started.promise;
    selection = { ...selection, generation: 2 }; importing.reject(new IssueWorkerClientError("OUTCOME_UNKNOWN", "synthetic"));
    await expect(result).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
});
