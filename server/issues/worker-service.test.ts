import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { IssueStore } from "./store.js";
import { MAX_DOCUMENT_BYTES } from "./document.js";
import { dispatchIssueWorkerRequest, safeIssueWorkerError, validateIssueWorkerRequest } from "./worker-service.js";

const scratch = path.resolve(".cache"), roots: string[] = [], stores: IssueStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) { expect(path.dirname(await realpath(root))).toBe(await realpath(scratch)); await rm(root, { recursive: true, force: true }); }
});
async function setup() {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, "issue-worker-service-")); roots.push(root);
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  const store = await IssueStore.open(root); stores.push(store); return { root, workspace, store };
}
const project = "project_12345678-1234-4123-8123-123456789abc";

describe("issue worker internal contract", () => {
  it("rejects unknown operations, permission fields, malformed IDs and oversized documents", () => {
    for (const request of [
      null, [], { operation: "shell.run" },
      { operation: "project.create", selectedPath: "test", network: true },
      { operation: "project.read", projectId: "wrong" },
      { operation: "document.read", projectId: project, documentId: "../outside" },
      { operation: "document.import", projectId: project, expectedRevision: 1, bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1) },
      { operation: "document.list", projectId: project, expectedRevision: 1, limit: 101 },
      { operation: "issue.list", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, filters: { status: ["ready"] } },
      { operation: "issue.list", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, filters: { version: "1.2.3", path: "elsewhere" } },
      { operation: "document.diagnostics", projectId: project, documentId: "doc", expectedRevision: 1, offset: -1 },
      { operation: "document.diagnostics", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, path: "elsewhere" },
      { operation: "document.sourceTrace", projectId: project, documentId: "../outside", expectedRevision: 1, offset: 0 },
      { operation: "document.sourceTrace", projectId: project, documentId: "doc", expectedRevision: 1, offset: -1 },
      { operation: "document.sourceTrace", projectId: project, documentId: "doc", expectedRevision: 1, offset: 0, path: "elsewhere" },
      { operation: "requirement.detail", projectId: project, documentId: "doc", expectedRevision: 1, requirementId: "../outside", offset: 0 },
      { operation: "requirement.detail", projectId: project, documentId: "doc", expectedRevision: 1, requirementId: "req", offset: -1 },
      { operation: "requirement.detail", projectId: project, documentId: "doc", expectedRevision: 1, requirementId: "req", offset: 0, network: true },
      { operation: "category.list", projectId: project, documentId: "doc", expectedRevision: 1, parentId: "../outside", offset: 0 },
      { operation: "category.list", projectId: project, documentId: "doc", expectedRevision: 1, parentId: null, offset: -1 },
      { operation: "issue.projectSearch", projectId: project, expectedRevision: 1, cursor: { issueOffset: -1 } },
      { operation: "issue.projectSearch", projectId: project, expectedRevision: 1, cursor: { issueOffset: 0 }, filters: { categoryId: "foreign" } },
    ]) expect(() => validateIssueWorkerRequest(request)).toThrow();
  });
  it("dispatches only valid requests against the internal store", async () => {
    const { store, workspace } = await setup();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    expect(created.kind).toBe("project"); if (created.kind !== "project") throw new Error("wrong response");
    expect(await dispatchIssueWorkerRequest(store, { operation: "project.read", projectId: created.id })).toEqual(created);
    expect(await dispatchIssueWorkerRequest(store, { operation: "document.list", projectId: created.id, expectedRevision: 1 })).toMatchObject({ kind: "documents", documents: [] });
    await expect(dispatchIssueWorkerRequest(store, { operation: "document.read", projectId: created.id, documentId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("dispatches requirement detail against a real store at the expected revision", async () => {
    const { store, workspace } = await setup();
    const created = await dispatchIssueWorkerRequest(store, { operation: "project.create", selectedPath: workspace });
    if (created.kind !== "project") throw new Error("wrong response");
    const doc = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc", revision: 1, sources: [], categories: [], requirements: [{ id: "req", categoryId: null, text: "합성", origin: "user" }], issues: [{ id: "issue", categoryId: null, requirementIds: ["req"], version: "1.0.0", order: 0, title: "이슈", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] };
    const bytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(doc)}\n\`\`\``);
    await dispatchIssueWorkerRequest(store, { operation: "document.import", projectId: created.id, expectedRevision: 1, bytes });
    const request = { operation: "requirement.detail", projectId: created.id, documentId: "doc", expectedRevision: 2, requirementId: "req", offset: 0 };
    expect(await dispatchIssueWorkerRequest(store, request)).toMatchObject({ kind: "requirement.detail", requirement: { id: "req", linkedIssueCount: 1 }, page: { items: [{ id: "issue" }], nextOffset: null } });
    await expect(dispatchIssueWorkerRequest(store, { ...request, expectedRevision: 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("does not expose unknown exception messages or stack data", () => {
    expect(safeIssueWorkerError(new Error("private synthetic value"))).toEqual({ code: "STORAGE_FAILED", message: "이슈 저장소 작업에 실패했습니다. 기존 데이터를 확인하세요." });
    expect(safeIssueWorkerError(null).message).not.toContain("private synthetic value");
  });
});
