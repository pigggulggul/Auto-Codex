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
  it("does not expose unknown exception messages or stack data", () => {
    expect(safeIssueWorkerError(new Error("private synthetic value"))).toEqual({ code: "STORAGE_FAILED", message: "이슈 저장소 작업에 실패했습니다. 기존 데이터를 확인하세요." });
    expect(safeIssueWorkerError(null).message).not.toContain("private synthetic value");
  });
});
