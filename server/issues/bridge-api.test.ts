import { describe, expect, it, vi } from "vitest";
import { IssueBridgeApi } from "./bridge-api.js";
import { IssueWorkerClientError } from "./worker-client.js";
import { SelectedDocumentError } from "./selected-document.js";
import { AnalysisSourceError } from "./analysis-source.js";
import { IssueWriteAdmission } from "../issue-write-admission.js";
import type { IssueProjectSelection } from "./project-context.js";

const id = "12345678-1234-4123-8123-123456789abc";
const wire = (type: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type, v: 1, clientRequestId: id, ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup() {
  let selection: IssueProjectSelection = { workspaceMode: "project", projectPath: "C:/synthetic/project", generation: 1 };
  let picks = 0, binds = 0, bound = false, busy = false, connected = true;
  const options = {
    selection: () => selection,
    context: () => ({ status: async () => ({ project: bound ? { id: "opaque", revision: 1 } : null }), bind: async () => { binds++; bound = true; return { project: { id: "opaque", revision: 1 }, alreadyBound: false }; }, importDocument: async (_bytes: Uint8Array, mayStart: () => boolean) => { if (!mayStart()) throw new Error("cancelled"); return { issueCount: 1, alreadyImported: false }; }, exportDocument: async (_id: string, _revision: number, mayStart: () => boolean) => { if (!mayStart()) throw new Error("cancelled"); return new Uint8Array([1]); }, view: async () => ({ kind: "documents" as const, revision: 1, documents: [], nextAfterId: null }) }),
    pick: async () => { picks++; return "C:/synthetic/project" as string | null; },
    pickView: async () => "C:/synthetic/project" as string | null,
    pickDocument: async () => "C:/synthetic/plan.md" as string | null,
    pickExport: async (_path: string) => "C:/synthetic/project/output.md" as string | null,
    pickSource: async (_path: string) => "C:/synthetic/project/plan.md" as string | null,
    readSource: async (_project: string, _path: string) => ({ relativePath: "plan.md", bytes: 9, sha256: "a".repeat(64), text: "synthetic" }),
    readDocument: async (_path: string) => new Uint8Array([1, 2, 3]),
    writeExport: async (_project: string, _path: string, _bytes: Uint8Array, before: () => Promise<void>) => { await before(); return { cleanupWarning: false }; },
    tryAcquireWrite: (): (() => void) | null => () => {},
    canonical: async (path: string) => path,
    busy: () => busy,
    now: () => Date.now(),
  };
  return { options, api: new IssueBridgeApi(options), connected: () => connected, change: (next: IssueProjectSelection) => { selection = next; }, setBusy: (next: boolean) => { busy = next; }, disconnect: () => { connected = false; }, counts: () => ({ picks, binds }) };
}

describe("issue binding bridge boundary", () => {
  it("guards analysis batches with the authorized snapshot and rechecks originals before and after transport", async () => {
    const t = setup(), socket = new AbortController(); let admitted = true, originalHash = "a".repeat(64), calls = 0;
    t.options.readSource = async () => ({ relativePath: "plan.md", bytes: 9, sha256: originalHash, text: "synthetic" });
    const ask = (type: string, extra: Record<string, unknown> = {}) => t.api.handle(wire(type, extra), true, t.connected, socket.signal);
    await ask("issues.project.bind"); await ask("issues.view.authorize");
    const selected = await ask("issues.sources.add"); if (!selected.ok || !selected.sources) throw new Error("missing source");
    const prepared = await ask("issues.analysis.prepare", { expectedRevision: 1, expectedSources: selected.sources.items.map(({ id, sha256 }) => ({ id, sha256 })), instruction: "" });
    if (!prepared.ok || !prepared.snapshot) throw new Error("missing snapshot");
    const create = () => t.api.createAnalysisBatch(socket.signal, t.connected, () => admitted, prepared.snapshot!.id, 1);
    admitted = false; await expect(create()).rejects.toMatchObject({ code: "STALE_INPUT" }); admitted = true;
    const batch = await create();
    originalHash = "b".repeat(64);
    expect(await batch.run(async () => { calls++; return '{"requirements":[]}'; }, 1)).toBe("blocked");
    expect(calls).toBe(0);
    expect(batch.inspect().segments[0]).toMatchObject({ status: "failed", error: "STALE_INPUT" });
    originalHash = "a".repeat(64); batch.retry(0);
    expect(await batch.run(async () => { calls++; originalHash = "b".repeat(64); return '{"requirements":[]}'; }, 1)).toBe("blocked");
    expect(calls).toBe(1); expect(batch.inspect().processedSegments).toBe(0);
    originalHash = "a".repeat(64); batch.retry(0);
    const base = t.options.context;
    expect(await batch.run(async () => { t.options.context = () => ({ ...base(), status: async () => ({ project: { id: "different", revision: 1 } }) }); return '{"requirements":[]}'; }, 1)).toBe("blocked");
    expect(batch.inspect().processedSegments).toBe(0);
    t.options.context = base; batch.retry(0);
    expect(await batch.run(async () => '{"requirements":[]}', 1)).toBe("complete");
    socket.abort();
    await expect(create()).rejects.toMatchObject({ code: "STALE_INPUT" });
  });

  it("discards a result when its view grant or admission expires during the source recheck", async () => {
    for (const revoke of ["view", "admission"] as const) {
      const t = setup(), socket = new AbortController(); let admitted = true;
      const ask = (type: string, extra: Record<string, unknown> = {}) => t.api.handle(wire(type, extra), true, t.connected, socket.signal);
      await ask("issues.project.bind"); await ask("issues.view.authorize");
      const selected = await ask("issues.sources.add"); if (!selected.ok || !selected.sources) throw new Error("missing source");
      const prepared = await ask("issues.analysis.prepare", { expectedRevision: 1, expectedSources: selected.sources.items.map(({ id, sha256 }) => ({ id, sha256 })), instruction: "" });
      if (!prepared.ok || !prepared.snapshot) throw new Error("missing snapshot");
      const batch = await t.api.createAnalysisBatch(socket.signal, t.connected, () => admitted, prepared.snapshot.id, 1);
      const started = deferred<void>(), finish = deferred<{ relativePath: string; bytes: number; sha256: string; text: string }>(); let reads = 0;
      t.options.readSource = async () => { reads++; if (reads === 2) { started.resolve(); return finish.promise; } return { relativePath: "plan.md", bytes: 9, sha256: "a".repeat(64), text: "synthetic" }; };
      const pending = batch.run(async () => '{"requirements":[]}', 1); await started.promise;
      if (revoke === "view") await ask("issues.view.release"); else admitted = false;
      finish.resolve({ relativePath: "plan.md", bytes: 9, sha256: "a".repeat(64), text: "synthetic" });
      expect(await pending).toBe("blocked");
      expect(batch.inspect()).toMatchObject({ processedSegments: 0, segments: [{ status: "failed", error: "STALE_INPUT" }] });
      socket.abort();
    }
  });
  it("requires UI origin and rejects renderer-supplied paths or permissions", async () => {
    const t = setup();
    for (const raw of [wire("issues.project.bind", { path: "C:/outside" }), wire("issues.project.bind", { permissions: "all" }), wire("issues.project.bind", { v: 2 })]) expect((await t.api.handle(raw, true, t.connected)).ok).toBe(false);
    expect((await t.api.handle(wire("issues.project.bind"), false, t.connected)).ok).toBe(false);
    expect(t.counts()).toEqual({ picks: 0, binds: 0 });
  });
  it("requires a native matching folder choice before binding and returns no paths or IDs", async () => {
    const t = setup();
    expect(await t.api.handle(wire("issues.project.status"), true, t.connected)).toMatchObject({ ok: true, bound: false });
    const response = await t.api.handle(wire("issues.project.bind"), true, t.connected);
    expect(response).toMatchObject({ ok: true, bound: true });
    expect(JSON.stringify(response)).not.toContain("synthetic"); expect(JSON.stringify(response)).not.toContain("opaque");
    expect(t.counts()).toEqual({ picks: 1, binds: 1 });
  });
  it("does not bind after cancel, a different folder, or an active run", async () => {
    const t = setup(); t.options.pick = async () => null;
    expect(await t.api.handle(wire("issues.project.bind"), true, t.connected)).toMatchObject({ ok: true, cancelled: true });
    t.options.pick = async () => "C:/synthetic/other";
    expect(await t.api.handle(wire("issues.project.bind"), true, t.connected)).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    t.setBusy(true);
    expect(await t.api.handle(wire("issues.project.bind"), true, t.connected)).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(t.counts().binds).toBe(0);
  });
  it("rejects a changed selection or disconnected caller while the picker is open", async () => {
    const t = setup(), picker = deferred<string | null>(); t.options.pick = () => picker.promise;
    const first = t.api.handle(wire("issues.project.bind"), true, t.connected);
    expect(await t.api.handle(wire("issues.project.bind"), true, t.connected)).toMatchObject({ ok: false, error: { code: "BUSY" } });
    t.change({ workspaceMode: "project", projectPath: "C:/synthetic/project", generation: 3 }); picker.resolve("C:/synthetic/project");
    expect(await first).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    const other = setup(), picker2 = deferred<string | null>(); other.options.pick = () => picker2.promise;
    const disconnected = other.api.handle(wire("issues.project.bind"), true, other.connected); other.disconnect(); picker2.resolve("C:/synthetic/project");
    expect(await disconnected).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } }); expect(other.counts().binds).toBe(0);
  });
  it("preserves an unknown worker mutation outcome", async () => {
    const t = setup(); const base = t.options.context; t.options.context = () => ({ ...base(), status: async () => ({ project: null }), bind: async () => { throw new IssueWorkerClientError("OUTCOME_UNKNOWN", "확인 필요"); } });
    expect(await t.api.handle(wire("issues.project.bind"), true, t.connected)).toMatchObject({ ok: false, error: { code: "OUTCOME_UNKNOWN" } });
  });
  it("cancels the owned folder picker when the caller disconnects", async () => {
    const t = setup(), controller = new AbortController(); let aborted = false;
    const api = new IssueBridgeApi({ ...t.options, pick: signal => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true });
    }) });
    const result = api.handle(wire("issues.project.bind"), true, t.connected, controller.signal);
    controller.abort();
    expect(await result).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    expect(aborted).toBe(true); expect(t.counts().binds).toBe(0);
    const alreadyClosed = setup(), closed = new AbortController(); closed.abort();
    expect(await alreadyClosed.api.handle(wire("issues.project.bind"), true, alreadyClosed.connected, closed.signal)).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    expect(alreadyClosed.counts().picks).toBe(0);
  });
  it("does not hide an unknown mutation outcome when disconnect races the worker", async () => {
    const t = setup(), controller = new AbortController(), started = deferred<void>();
    let reject!: (error: Error) => void;
    const waiting = new Promise<{ project: { id: string; revision: number }; alreadyBound: boolean }>((_resolve, fail) => { reject = fail; });
    const base = t.options.context; t.options.context = () => ({ ...base(), status: async () => ({ project: null }), bind: () => { started.resolve(); return waiting; } });
    const result = t.api.handle(wire("issues.project.bind"), true, t.connected, controller.signal);
    await started.promise; controller.abort(); reject(new IssueWorkerClientError("OUTCOME_UNKNOWN", "확인 필요"));
    expect(await result).toMatchObject({ ok: false, error: { code: "OUTCOME_UNKNOWN" } });
  });
  it("does not bind when cancellation arrives during path validation", async () => {
    const t = setup(), controller = new AbortController(), entered = deferred<void>(), wait = deferred<string>();
    let first = true;
    t.options.canonical = async path => { if (first) { first = false; entered.resolve(); return wait.promise; } return path; };
    const result = t.api.handle(wire("issues.project.bind"), true, t.connected, controller.signal);
    await entered.promise; controller.abort(); wait.resolve("C:/synthetic/project");
    expect(await result).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    expect(t.counts().binds).toBe(0);
  });
  it("imports only a native-selected document for the bound project", async () => {
    const t = setup(); let selected = 0, imported = 0;
    t.options.pickDocument = async () => { selected++; return "C:/synthetic/external.md"; };
    t.options.readDocument = async filename => { expect(filename).toBe("C:/synthetic/external.md"); return new Uint8Array([1, 2, 3]); };
    const base = t.options.context;
    t.options.context = () => ({ ...base(), importDocument: async (bytes, mayStart) => { expect([...bytes]).toEqual([1, 2, 3]); expect(mayStart()).toBe(true); imported++; return { issueCount: 4, alreadyImported: false }; } });
    expect(await t.api.handle(wire("issues.document.import", { path: "C:/outside.md" }), true, t.connected)).toMatchObject({ ok: false });
    expect((await t.api.handle(wire("issues.document.import"), true, t.connected))).toMatchObject({ ok: false, error: { code: "PROJECT_UNBOUND" } });
    expect(selected).toBe(0);
    await t.api.handle(wire("issues.project.bind"), true, t.connected);
    const result = await t.api.handle(wire("issues.document.import"), true, t.connected);
    expect(result).toMatchObject({ ok: true, action: "import", issueCount: 4, alreadyImported: false });
    expect(JSON.stringify(result)).not.toContain("external.md"); expect(imported).toBe(1);
  });
  it("discards selected document bytes after a project switch", async () => {
    const t = setup(), reading = deferred<Uint8Array<ArrayBuffer>>(), started = deferred<void>(); let imported = false;
    await t.api.handle(wire("issues.project.bind"), true, t.connected);
    t.options.readDocument = () => { started.resolve(); return reading.promise; };
    const base = t.options.context;
    t.options.context = () => ({ ...base(), importDocument: async () => { imported = true; return { issueCount: 1, alreadyImported: false }; } });
    const result = t.api.handle(wire("issues.document.import"), true, t.connected); await started.promise;
    t.change({ workspaceMode: "project", projectPath: "C:/synthetic/other", generation: 2 }); reading.resolve(new Uint8Array([1]));
    expect(await result).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } }); expect(imported).toBe(false);
  });
  it("keeps cancellation and unsafe document errors distinct", async () => {
    const t = setup(); await t.api.handle(wire("issues.project.bind"), true, t.connected);
    t.options.pickDocument = async () => null;
    expect(await t.api.handle(wire("issues.document.import"), true, t.connected)).toMatchObject({ ok: true, bound: true, cancelled: true });
    t.options.pickDocument = async () => "C:/synthetic/plan.md";
    t.options.readDocument = async () => { throw new SelectedDocumentError("PATH_INVALID", "안전하지 않은 문서"); };
    expect(await t.api.handle(wire("issues.document.import"), true, t.connected)).toMatchObject({ ok: false, error: { code: "PATH_INVALID" } });
  });
  it("restricts issue viewing to the confirmed socket and selection", async () => {
    const t = setup(), first = new AbortController(), second = new AbortController();
    await t.api.handle(wire("issues.project.bind"), true, t.connected, first.signal);
    const query = wire("issues.view.query", { query: { kind: "documents" } });
    expect(await t.api.handle(query, true, t.connected, first.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await t.api.handle(wire("issues.view.authorize"), true, t.connected, first.signal)).toMatchObject({ ok: true, authorized: true });
    expect(await t.api.handle(query, true, t.connected, first.signal)).toMatchObject({ ok: true, view: { kind: "documents" } });
    expect(await t.api.handle(query, true, t.connected, second.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "projectIssues", expectedRevision: 1, cursor: { issueOffset: 0 } } }), true, t.connected, second.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "categories", documentId: "doc-1", expectedRevision: 1, parentId: null, offset: 0 } }), true, t.connected, second.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "diagnostics", documentId: "doc-1", expectedRevision: 1, offset: 0 } }), true, t.connected, second.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "requirementDetail", documentId: "doc-1", expectedRevision: 1, requirementId: "req-1", offset: 0 } }), true, t.connected, second.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "requirementDetail", documentId: "doc-1", expectedRevision: 1, requirementId: "req-1", offset: 0, projectId: "foreign" } }), true, t.connected, first.signal)).toMatchObject({ ok: false });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "requirementDetail", documentId: "doc-1", expectedRevision: 1, requirementId: "../outside", offset: 0 } }), true, t.connected, first.signal)).toMatchObject({ ok: false });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "diagnostics", documentId: "doc-1", expectedRevision: 1, offset: 0, projectId: "foreign" } }), true, t.connected, first.signal)).toMatchObject({ ok: false });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "documents", projectId: "foreign" } }), true, t.connected, first.signal)).toMatchObject({ ok: false });
    t.change({ workspaceMode: "project", projectPath: "C:/synthetic/project", generation: 3 });
    expect(await t.api.handle(query, true, t.connected, first.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
  });
  it("rejects malformed search filters before they reach the project context", async () => {
    const t = setup(), session = new AbortController();
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    const base = { kind: "issues", documentId: "doc-1", expectedRevision: 1, offset: 0 };
    for (const filters of [{ search: "x".repeat(121) }, { status: "completed" }, { status: ["ready"] }, { version: "1.2" }, { categoryId: "../outside" }, { search: "ok", projectId: "other" }, []]) {
      expect(await t.api.handle(wire("issues.view.query", { query: { ...base, filters } }), true, t.connected, session.signal)).toMatchObject({ ok: false });
    }
    expect(await t.api.handle(wire("issues.view.query", { query: { ...base, filters: { search: "hello", status: "ready", version: "1.2.0" } } }), true, t.connected, session.signal)).toMatchObject({ ok: true });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "categories", documentId: "doc-1", expectedRevision: 1, parentId: null, offset: 0, projectId: "foreign" } }), true, t.connected, session.signal)).toMatchObject({ ok: false });
    for (const query of [{ kind: "projectIssues", expectedRevision: 1, cursor: { issueOffset: -1 } }, { kind: "projectIssues", expectedRevision: 1, cursor: { issueOffset: 0, afterId: "../outside" } }, { kind: "projectIssues", expectedRevision: 1, cursor: { issueOffset: 0 }, filters: { categoryId: null } }, { kind: "projectIssues", expectedRevision: 1, cursor: { issueOffset: 0 }, projectId: "foreign" }]) expect(await t.api.handle(wire("issues.view.query", { query }), true, t.connected, session.signal)).toMatchObject({ ok: false });
  });
  it("exports only after a session grant and native choice, with revision and selection checks", async () => {
    const t = setup(), session = new AbortController(), other = new AbortController();
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    const request = wire("issues.document.export", { documentId: "doc-1", expectedRevision: 1 });
    expect(await t.api.handle(request, true, t.connected, session.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    expect(await t.api.handle(request, true, t.connected, other.signal)).toMatchObject({ ok: false });
    expect(await t.api.handle(wire("issues.document.export", { documentId: "doc-1", expectedRevision: 1, path: "C:/outside.md" }), true, t.connected, session.signal)).toMatchObject({ ok: false });
    expect(await t.api.handle(wire("issues.document.export", { documentId: "doc-1", expectedRevision: 2 }), true, t.connected, session.signal)).toMatchObject({ ok: false });
    expect(await t.api.handle(request, true, t.connected, session.signal)).toMatchObject({ ok: true, action: "export", cleanupWarning: false });
    const waiting = deferred<string | null>(), entered = deferred<void>();
    t.options.pickExport = async () => { entered.resolve(); return waiting.promise; };
    const pending = t.api.handle(request, true, t.connected, session.signal); await entered.promise;
    t.change({ workspaceMode: "project", projectPath: "C:/synthetic/project", generation: 2 }); waiting.resolve("C:/synthetic/project/output.md");
    expect(await pending).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
  });
  it("reports an uncertain export outcome if selection changes after a write", async () => {
    const t = setup(), session = new AbortController();
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    t.options.writeExport = async (_project, _path, _bytes, before) => { await before(); t.change({ workspaceMode: "project", projectPath: "C:/synthetic/project", generation: 2 }); return { cleanupWarning: false }; };
    expect(await t.api.handle(wire("issues.document.export", { documentId: "doc-1", expectedRevision: 1 }), true, t.connected, session.signal)).toMatchObject({ ok: false, error: { code: "OUTCOME_UNKNOWN" } });
  });
  it("holds export admission until the write settles and releases it on failure", async () => {
    const t = setup(), session = new AbortController(), admission = new IssueWriteAdmission(), started = deferred<void>(), finish = deferred<void>();
    t.options.tryAcquireWrite = () => admission.tryAcquire(() => false);
    t.options.writeExport = async (_project, _path, _bytes, before) => { await before(); started.resolve(); await finish.promise; throw new Error("synthetic failure"); };
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    const pending = t.api.handle(wire("issues.document.export", { documentId: "doc-1", expectedRevision: 1 }), true, t.connected, session.signal);
    await started.promise; expect(admission.busy).toBe(true); expect(admission.tryAcquire(() => false)).toBeNull();
    finish.resolve(); expect(await pending).toMatchObject({ ok: false }); expect(admission.busy).toBe(false);
  });
  it("keeps admission while an interrupted file operation is still settling", async () => {
    const t = setup(), session = new AbortController(), admission = new IssueWriteAdmission(), started = deferred<void>(), finish = deferred<void>();
    t.options.tryAcquireWrite = () => admission.tryAcquire(() => false);
    t.options.writeExport = async (_project, _path, _bytes, before) => { await before(); started.resolve(); await finish.promise; throw new Error("interrupted"); };
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    const pending = t.api.handle(wire("issues.document.export", { documentId: "doc-1", expectedRevision: 1 }), true, t.connected, session.signal);
    await started.promise; session.abort(); expect(admission.busy).toBe(true);
    finish.resolve(); expect(await pending).toMatchObject({ ok: false }); expect(admission.busy).toBe(false);
  });
  it("does not reserve or write when another runtime starts during the save dialog", async () => {
    const t = setup(), session = new AbortController(), picker = deferred<string | null>(), started = deferred<void>();
    const admission = new IssueWriteAdmission(); let wrote = false;
    t.options.tryAcquireWrite = () => admission.tryAcquire(t.options.busy);
    t.options.pickExport = async () => { started.resolve(); return picker.promise; };
    t.options.writeExport = async () => { wrote = true; return { cleanupWarning: false }; };
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    const pending = t.api.handle(wire("issues.document.export", { documentId: "doc-1", expectedRevision: 1 }), true, t.connected, session.signal);
    await started.promise; t.setBusy(true); picker.resolve("C:/synthetic/project/output.md");
    expect(await pending).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    expect(admission.busy).toBe(false); expect(wrote).toBe(false);
  });
  it("reports busy without writing if admission cannot be acquired", async () => {
    const t = setup(), session = new AbortController(); let wrote = false;
    t.options.tryAcquireWrite = () => null;
    t.options.writeExport = async () => { wrote = true; return { cleanupWarning: false }; };
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    expect(await t.api.handle(wire("issues.document.export", { documentId: "doc-1", expectedRevision: 1 }), true, t.connected, session.signal)).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(wrote).toBe(false);
  });
  it("expires and revokes a view grant without restoring it", async () => {
    const t = setup(), session = new AbortController(), now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
      await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
      now.mockReturnValue(1000 + 15 * 60_000);
      expect(await t.api.handle(wire("issues.view.query", { query: { kind: "documents" } }), true, t.connected, session.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
      now.mockReturnValue(1000); await t.api.handle(wire("issues.view.release"), true, t.connected, session.signal);
      expect(await t.api.handle(wire("issues.view.query", { query: { kind: "documents" } }), true, t.connected, session.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    } finally { now.mockRestore(); }
  });
  it("does not issue a grant for a different folder or return data after a selection change", async () => {
    const t = setup(), session = new AbortController(); await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    t.options.pickView = async () => "C:/synthetic/other";
    expect(await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal)).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    t.options.pickView = async () => "C:/synthetic/project";
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    const waiting = deferred<{ kind: "documents"; revision: number; documents: never[]; nextAfterId: null }>();
    const base = t.options.context; t.options.context = () => ({ ...base(), view: () => waiting.promise });
    const result = t.api.handle(wire("issues.view.query", { query: { kind: "documents" } }), true, t.connected, session.signal);
    t.change({ workspaceMode: "project", projectPath: "C:/synthetic/other", generation: 2 }); waiting.resolve({ kind: "documents", revision: 1, documents: [], nextAfterId: null });
    expect(await result).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
  });
  it("keeps selected source text scoped to the authorized socket and rejects supplied paths", async () => {
    const t = setup(), session = new AbortController(), other = new AbortController();
    const ask = (type: string, extra: Record<string, unknown> = {}, signal = session.signal) => t.api.handle(wire(type, extra), true, t.connected, signal);
    await ask("issues.project.bind");
    expect(await ask("issues.sources.add")).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    await ask("issues.view.authorize");
    expect(await ask("issues.sources.add", { path: "C:/outside.txt" })).toMatchObject({ ok: false });
    expect(await ask("issues.sources.add", { text: "injected" })).toMatchObject({ ok: false });
    const added = await ask("issues.sources.add");
    expect(added).toMatchObject({ ok: true, sources: { totalBytes: 9, items: [{ relativePath: "plan.md" }] } });
    expect(JSON.stringify(added)).not.toContain("synthetic");
    if (!added.ok || !added.sources) throw new Error("source was not added");
    const sourceId = added.sources.items[0].id;
    expect(await ask("issues.sources.read", { sourceId, offset: 0 }, other.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await ask("issues.sources.read", { sourceId, offset: 0 })).toMatchObject({ ok: true, chunk: { text: "synthetic", nextOffset: null } });
    expect(await ask("issues.sources.remove", { sourceId })).toMatchObject({ ok: true, sources: { items: [], totalBytes: 0 } });
    expect(await ask("issues.sources.read", { sourceId, offset: 0 })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    session.abort();
  });
  it("prepares only the authorized connection's current sources and rejects forged input", async () => {
    const t = setup(), session = new AbortController(), other = new AbortController();
    const ask = (type: string, extra: Record<string, unknown> = {}, signal = session.signal) => t.api.handle(wire(type, extra), true, t.connected, signal);
    await ask("issues.project.bind"); await ask("issues.view.authorize");
    const selected = await ask("issues.sources.add"); if (!selected.ok || !selected.sources) throw new Error("missing selected source");
    const expectedSources = selected.sources.items.map(({ id, sha256 }) => ({ id, sha256 }));
    const request = { expectedRevision: 1, expectedSources, instruction: "synthetic request" };
    expect(await ask("issues.analysis.prepare", request, other.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await ask("issues.analysis.prepare", { ...request, path: "C:/outside" })).toMatchObject({ ok: false });
    expect(await ask("issues.analysis.prepare", { ...request, expectedSources: [{ ...expectedSources[0], text: "injected" }] })).toMatchObject({ ok: false });
    expect(await ask("issues.analysis.prepare", { ...request, expectedRevision: 2 })).toMatchObject({ ok: false, error: { code: "STALE_INPUT" } });
    const prepared = await ask("issues.analysis.prepare", request);
    expect(prepared).toMatchObject({ ok: true, snapshot: { projectRevision: 1, totalSegments: 1, processedSegments: 0, hasInstruction: true } });
    expect(JSON.stringify(prepared)).not.toContain("synthetic request"); expect(JSON.stringify(prepared)).not.toContain("synthetic");
    await ask("issues.sources.remove", { sourceId: expectedSources[0].id });
    expect(await ask("issues.analysis.prepare", request)).toMatchObject({ ok: false }); session.abort();
  });
  it("checks only session-owned snapshot files and distinguishes changes from unavailable files", async () => {
    const t = setup(), session = new AbortController(), other = new AbortController();
    const ask = (type: string, extra: Record<string, unknown> = {}, signal = session.signal) => t.api.handle(wire(type, extra), true, t.connected, signal);
    await ask("issues.project.bind"); await ask("issues.view.authorize");
    const selected = await ask("issues.sources.add"); if (!selected.ok || !selected.sources) throw new Error("missing selected source");
    const expectedSources = selected.sources.items.map(({ id, sha256 }) => ({ id, sha256 }));
    const prepared = await ask("issues.analysis.prepare", { expectedRevision: 1, expectedSources, instruction: "" }); if (!prepared.ok || !prepared.snapshot) throw new Error("missing snapshot");
    const request = { snapshotId: prepared.snapshot.id, expectedRevision: 1 };
    expect(await ask("issues.analysis.check", request, other.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    expect(await ask("issues.analysis.check", { ...request, path: "C:/outside" })).toMatchObject({ ok: false });
    expect(await ask("issues.analysis.check", { ...request, expectedRevision: 2 })).toMatchObject({ ok: false, error: { code: "STALE_INPUT" } });
    expect(await ask("issues.analysis.check", request)).toMatchObject({ ok: true, freshness: { snapshotId: prepared.snapshot.id, files: [{ id: expectedSources[0].id, state: "unchanged" }] } });
    t.options.readSource = async () => ({ relativePath: "plan.md", bytes: 3, sha256: "b".repeat(64), text: "new" });
    expect(await ask("issues.analysis.check", request)).toMatchObject({ ok: true, freshness: { files: [{ state: "changed" }] } });
    t.options.readSource = async () => { throw new AnalysisSourceError("PATH_INVALID", "private synthetic path"); };
    const unavailable = await ask("issues.analysis.check", request);
    expect(unavailable).toMatchObject({ ok: true, freshness: { files: [{ state: "unavailable" }] } }); expect(JSON.stringify(unavailable)).not.toContain("private synthetic path");
    await ask("issues.sources.remove", { sourceId: expectedSources[0].id });
    expect(await ask("issues.analysis.check", request)).toMatchObject({ ok: false, error: { code: "STALE_INPUT" } }); session.abort();
  });
  it("does not return freshness after a project or grant changes during file reading", async () => {
    const t = setup(), session = new AbortController(), entered = deferred<void>(), finish = deferred<{ relativePath: string; bytes: number; sha256: string; text: string }>();
    const ask = (type: string, extra: Record<string, unknown> = {}) => t.api.handle(wire(type, extra), true, t.connected, session.signal);
    await ask("issues.project.bind"); await ask("issues.view.authorize");
    const selected = await ask("issues.sources.add"); if (!selected.ok || !selected.sources) throw new Error("missing selected source");
    const prepared = await ask("issues.analysis.prepare", { expectedRevision: 1, expectedSources: selected.sources.items.map(({ id, sha256 }) => ({ id, sha256 })), instruction: "" }); if (!prepared.ok || !prepared.snapshot) throw new Error("missing snapshot");
    t.options.readSource = async () => { entered.resolve(); return finish.promise; };
    const pending = ask("issues.analysis.check", { expectedRevision: 1, snapshotId: prepared.snapshot.id }); await entered.promise;
    t.change({ workspaceMode: "project", projectPath: "C:/synthetic/project", generation: 2 });
    finish.resolve({ relativePath: "plan.md", bytes: 9, sha256: "a".repeat(64), text: "synthetic" });
    expect(await pending).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } }); session.abort();
  });
  it("limits freshness reads globally and releases the slot after failure", async () => {
    const t = setup(), first = new AbortController(), second = new AbortController();
    const ask = (signal: AbortSignal, type: string, extra: Record<string, unknown> = {}) => t.api.handle(wire(type, extra), true, t.connected, signal);
    await ask(first.signal, "issues.project.bind");
    const snapshots: string[] = [];
    for (const session of [first, second]) {
      await ask(session.signal, "issues.view.authorize");
      const selected = await ask(session.signal, "issues.sources.add"); if (!selected.ok || !selected.sources) throw new Error("missing source");
      const prepared = await ask(session.signal, "issues.analysis.prepare", { expectedRevision: 1, expectedSources: selected.sources.items.map(({ id, sha256 }) => ({ id, sha256 })), instruction: "" }); if (!prepared.ok || !prepared.snapshot) throw new Error("missing snapshot"); snapshots.push(prepared.snapshot.id);
    }
    const entered = deferred<void>(), finish = deferred<{ relativePath: string; bytes: number; sha256: string; text: string }>();
    t.options.readSource = async () => { entered.resolve(); return finish.promise; };
    const pending = ask(first.signal, "issues.analysis.check", { expectedRevision: 1, snapshotId: snapshots[0] }); await entered.promise;
    expect(await ask(second.signal, "issues.analysis.check", { expectedRevision: 1, snapshotId: snapshots[1] })).toMatchObject({ ok: false, error: { code: "BUSY" } });
    first.abort(); finish.resolve({ relativePath: "plan.md", bytes: 9, sha256: "a".repeat(64), text: "synthetic" }); expect(await pending).toMatchObject({ ok: false });
    t.options.readSource = async () => ({ relativePath: "plan.md", bytes: 9, sha256: "a".repeat(64), text: "synthetic" });
    expect(await ask(second.signal, "issues.analysis.check", { expectedRevision: 1, snapshotId: snapshots[1] })).toMatchObject({ ok: true, freshness: { files: [{ state: "unchanged" }] } }); second.abort();
  });
  it("discards sources on expiry, explicit clearing, and a cancelled reauthorization", async () => {
    const t = setup(), session = new AbortController(); let now = 1000; t.options.now = () => now;
    const ask = (type: string) => t.api.handle(wire(type), true, t.connected, session.signal);
    await ask("issues.project.bind"); await ask("issues.view.authorize"); await ask("issues.sources.add");
    t.api.clearSources(); expect(await ask("issues.sources.list")).toMatchObject({ ok: true, sources: { items: [] } });
    await ask("issues.sources.add"); now += 15 * 60_000;
    expect(await ask("issues.sources.list")).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
    await ask("issues.view.authorize"); expect(await ask("issues.sources.list")).toMatchObject({ ok: true, sources: { items: [] } });
    await ask("issues.sources.add"); t.options.pickView = async () => null; await ask("issues.view.authorize");
    expect(await ask("issues.sources.list")).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } }); session.abort();
  });
  it("rejects a source selected after the project changes during the native picker", async () => {
    const t = setup(), session = new AbortController(), started = deferred<void>(), finish = deferred<string | null>(); let read = false;
    await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    t.options.pickSource = async () => { started.resolve(); return finish.promise; };
    t.options.readSource = async () => { read = true; return { relativePath: "plan.md", bytes: 9, sha256: "a".repeat(64), text: "synthetic" }; };
    const pending = t.api.handle(wire("issues.sources.add"), true, t.connected, session.signal); await started.promise;
    t.change({ workspaceMode: "project", projectPath: "C:/synthetic/project", generation: 2 }); finish.resolve("C:/synthetic/project/plan.md");
    expect(await pending).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } }); expect(read).toBe(false); session.abort();
  });
  it("revokes a prior grant before a cancelled confirmation", async () => {
    const t = setup(), session = new AbortController(); await t.api.handle(wire("issues.project.bind"), true, t.connected, session.signal);
    await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal);
    t.options.pickView = async () => null;
    expect(await t.api.handle(wire("issues.view.authorize"), true, t.connected, session.signal)).toMatchObject({ ok: true, authorized: false, cancelled: true });
    expect(await t.api.handle(wire("issues.view.query", { query: { kind: "documents" } }), true, t.connected, session.signal)).toMatchObject({ ok: false, error: { code: "VIEW_AUTH_REQUIRED" } });
  });
});
