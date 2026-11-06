import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { IssueStore } from "./store.js";
import { IssueView } from "./issue-view.js";

const scratch = path.resolve(".cache"), roots: string[] = [], stores: IssueStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) { expect(path.dirname(await realpath(root))).toBe(await realpath(scratch)); await rm(root, { recursive: true, force: true }); } });
async function setup() {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, "issue-view-")); roots.push(root);
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  const store = await IssueStore.open(root); stores.push(store); const project = await store.createProject(workspace);
  const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-1", revision: 1,
    sources: [{ id: "source-1", name: "기획서", contentHash: `sha256:${"a".repeat(64)}` }],
    categories: [{ id: "cat-1", parentId: null, title: "기능", order: 0 }],
    requirements: [{ id: "req-1", categoryId: "cat-1", text: "근거 요구사항", origin: "source", sourceId: "source-1", locator: "2절" }],
    issues: [
      { id: "issue-later", categoryId: "cat-1", requirementIds: [], version: "1.10.0", order: 0, title: "나중", description: "", acceptanceCriteria: [], dependencyIds: ["issue-first"], status: "ready" },
      { id: "issue-first", categoryId: "cat-1", requirementIds: ["req-1"], version: "1.2.0", order: 0, title: "<script>unsafe</script>", description: "상세 설명", acceptanceCriteria: Array.from({ length: 40 }, (_, i) => `조건 ${i}`), dependencyIds: [], status: "completed" },
    ] };
  await store.importDocument(project.id, 1, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
  return { root, store, project, view: new IssueView(store) };
}
describe("bounded issue views", () => {
  it("flags cross-branch issue and requirement categories without flagging parent-child links", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-categories", revision: 1, sources: [], categories: [{ id: "root-a", parentId: null, title: "A", order: 0 }, { id: "child-a", parentId: "root-a", title: "A1", order: 0 }, { id: "root-b", parentId: null, title: "B", order: 1 }], requirements: [{ id: "req-a", categoryId: "root-a", text: "같은 가지", origin: "user" }, { id: "req-b", categoryId: "root-b", text: "다른 가지", origin: "user" }], issues: [{ id: "issue-a", categoryId: "child-a", requirementIds: ["req-a", "req-b"], version: "1.0.0", order: 0, title: "이슈", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const report = await t.view.diagnostics(t.project.id, "doc-categories", 3, 0);
    expect(report.findings.items.filter(item => item.code === "issue-requirement-category-mismatch")).toEqual([{ code: "issue-requirement-category-mismatch", entityId: "issue-a", title: "이슈", provenance: null, relatedEntityId: "req-b" }]);
    await expect(t.view.diagnostics(t.project.id, "doc-categories", 2, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("traces recorded sources to requirements at the selected revision without reading source files", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-source-trace", revision: 1, sources: [{ id: "source-a", name: "원본", contentHash: `sha256:${"a".repeat(64)}` }, { id: "source-b", name: "미연결", contentHash: `sha256:${"b".repeat(64)}` }], categories: [], requirements: Array.from({ length: 40 }, (_, i) => ({ id: `req-${String(i).padStart(2, "0")}`, categoryId: null, text: `요구 ${i}`, origin: "source", sourceId: "source-a" })), issues: [] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.sourceTrace(t.project.id, "doc-source-trace", 3, 0);
    expect(first.items).toHaveLength(32); expect(first.nextOffset).toBe(32);
    const last = await t.view.sourceTrace(t.project.id, "doc-source-trace", 3, 32);
    expect(last.items).toHaveLength(9); expect(last.items.at(-1)).toEqual({ sourceId: "source-b", sourceName: "미연결", requirement: null }); expect(last.nextOffset).toBeNull();
    expect(first.items[0]).toMatchObject({ sourceId: "source-a", requirement: { id: "req-00", origin: "source" } });
    await expect(t.view.sourceTrace(t.project.id, "doc-source-trace", 2, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(t.view.sourceTrace(t.project.id, "doc-source-trace", 3, 42)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await expect(t.view.sourceTrace("project_00000000-0000-4000-8000-000000000000", "doc-source-trace", 3, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("reports sources without any recorded requirement reference, without reading originals", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-sources", revision: 1, sources: [{ id: "source-unused", name: "미연결 자료", contentHash: `sha256:${"a".repeat(64)}` }, { id: "source-used", name: "연결 자료", contentHash: `sha256:${"b".repeat(64)}` }], categories: [], requirements: [{ id: "req-used", categoryId: null, text: "요구사항", origin: "source", sourceId: "source-used" }], issues: [] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const report = await t.view.diagnostics(t.project.id, "doc-sources", 3, 0);
    expect(report.findings.items.filter(item => item.code === "source-unlinked")).toEqual([{ code: "source-unlinked", entityId: "source-unused", title: "미연결 자료", provenance: null }]);
    expect((await t.store.readProject(t.project.id)).revision).toBe(3);
    await expect(t.view.diagnostics(t.project.id, "doc-sources", 2, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("shows numeric version order and separates imported completion from local status", async () => {
    const t = await setup(), page = await t.view.list(t.project.id, "doc-1", 2, 0);
    expect(page.items.map(item => item.id)).toEqual(["issue-first", "issue-later"]);
    expect(page.items[0]).toMatchObject({ importedStatus: "completed", localStatus: "needs_review", category: "기능", missingCriteria: false, unverifiedDependencies: 0 });
    expect(page.items[1]).toMatchObject({ localStatus: "needs_review", missingCriteria: true, unverifiedDependencies: 1 });
    expect(page.nextOffset).toBeNull();
    expect(await t.view.detail(t.project.id, "doc-1", 2, "issue-first")).toMatchObject({ description: "상세 설명", criteriaCount: 40, requirementCount: 1, missingCriteria: false, unverifiedDependencies: 0 });
    expect(await t.view.detail(t.project.id, "doc-1", 2, "issue-later")).toMatchObject({ missingCriteria: true, unverifiedDependencies: 1 });
  });
  it("pages criteria and includes requirement origin without exposing other projects", async () => {
    const t = await setup(), first = await t.view.criteria(t.project.id, "doc-1", 2, "issue-first", 0);
    expect(first.items).toHaveLength(32); expect(first.nextOffset).toBe(32);
    expect((await t.view.criteria(t.project.id, "doc-1", 2, "issue-first", 32)).items).toHaveLength(8);
    expect((await t.view.requirements(t.project.id, "doc-1", 2, "issue-first", 0)).items).toEqual([{ id: "req-1", text: "근거 요구사항", origin: "source", sourceName: "기획서", locator: "2절" }]);
    expect((await t.view.dependencies(t.project.id, "doc-1", 2, "issue-later", 0)).items).toEqual([{ id: "issue-first", title: "<script>unsafe</script>", localStatus: "needs_review", importedStatus: "completed" }]);
    await expect(t.view.detail("project_00000000-0000-4000-8000-000000000000", "doc-1", 2, "issue-first")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.view.list(t.project.id, "doc-1", 1, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(t.view.criteria(t.project.id, "doc-1", 2, "issue-first", 41)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("shows a requirement and its linked issues only within the selected document and revision", async () => {
    const t = await setup();
    expect(await t.view.requirementDetail(t.project.id, "doc-1", 2, "req-1", 0)).toMatchObject({ requirement: { id: "req-1", text: "근거 요구사항", category: "기능", origin: "source", sourceName: "기획서", locator: "2절", linkedIssueCount: 1 }, page: { items: [{ id: "issue-first", importedStatus: "completed", localStatus: "needs_review" }], nextOffset: null } });
    await expect(t.view.requirementDetail(t.project.id, "doc-1", 2, "missing", 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.view.requirementDetail(t.project.id, "missing", 2, "req-1", 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.view.requirementDetail("project_00000000-0000-4000-8000-000000000000", "doc-1", 2, "req-1", 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.view.requirementDetail(t.project.id, "doc-1", 1, "req-1", 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(t.view.requirementDetail(t.project.id, "doc-1", 2, "req-1", 2)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("pages linked issues without exceeding response limits for a large escaped requirement", async () => {
    const t = await setup(), content = "\u0001".repeat(32768);
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-trace", revision: 1, sources: [], categories: [], requirements: [{ id: "req-trace", categoryId: null, text: content, origin: "user" }, { id: "req-empty", categoryId: null, text: "미연결", origin: "user" }], issues: Array.from({ length: 40 }, (_, i) => ({ id: `trace-${String(i).padStart(2, "0")}`, categoryId: null, requirementIds: ["req-trace"], version: "1.0.0", order: i, title: `${"\u0001".repeat(240)}-${i}`, description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" })) };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.requirementDetail(t.project.id, "doc-trace", 3, "req-trace", 0);
    expect(first.requirement.text).toBe(content); expect(first.requirement.linkedIssueCount).toBe(40); expect(first.page.items.length).toBeGreaterThan(0); expect(first.page.items.length).toBeLessThan(32); expect(first.page.nextOffset).toBe(first.page.items.length);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(240 * 1024);
    const last = await t.view.requirementDetail(t.project.id, "doc-trace", 3, "req-trace", first.page.nextOffset!);
    expect(first.page.items.length + last.page.items.length).toBe(40); expect(last.page.nextOffset).toBeNull(); expect(Buffer.byteLength(JSON.stringify(last))).toBeLessThan(240 * 1024);
    expect(await t.view.requirementDetail(t.project.id, "doc-trace", 3, "req-empty", 0)).toMatchObject({ requirement: { linkedIssueCount: 0 }, page: { items: [], nextOffset: null } });
  });
  it("reports scoped missing links and fields without treating imported completion as verified", async () => {
    const t = await setup(), report = await t.view.diagnostics(t.project.id, "doc-1", 2, 0);
    expect(report).toMatchObject({ documentRevision: 1, issueCount: 2, requirementCount: 1, linkedRequirementCount: 1, totalFindings: 4 });
    expect(report.findings.items).toEqual([
      { code: "issue-unverified-completion", entityId: "issue-first", title: "<script>unsafe</script>", provenance: null },
      { code: "issue-unlinked", entityId: "issue-later", title: "나중", provenance: null },
      { code: "issue-missing-description", entityId: "issue-later", title: "나중", provenance: null },
      { code: "issue-missing-criteria", entityId: "issue-later", title: "나중", provenance: null },
    ]);
    expect(await t.store.readProject(t.project.id)).toMatchObject({ revision: 2 });
    await expect(t.view.diagnostics(t.project.id, "doc-1", 1, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(t.view.diagnostics("project_00000000-0000-4000-8000-000000000000", "doc-1", 2, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("counts each linked requirement once and lists uncategorized or unlinked requirements", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-links", revision: 1, sources: [{ id: "src-link", name: "원본", contentHash: `sha256:${"b".repeat(64)}` }], categories: [], requirements: [{ id: "req-a", categoryId: null, text: "연결", origin: "user" }, { id: "req-b", categoryId: null, text: "미연결", origin: "source", sourceId: "src-link", locator: "3절" }], issues: ["issue-a", "issue-b"].map((id, order) => ({ id, categoryId: null, requirementIds: ["req-a"], version: "1.0.0", order, title: id, description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" })) };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const report = await t.view.diagnostics(t.project.id, "doc-links", 3, 0);
    expect(report).toMatchObject({ issueCount: 2, requirementCount: 2, linkedRequirementCount: 1, totalFindings: 5 });
    expect(report.findings.items.slice(0, 3)).toEqual([{ code: "requirement-uncategorized", entityId: "req-a", title: "연결", provenance: { origin: "user", sourceName: null, locator: null } }, { code: "requirement-unlinked", entityId: "req-b", title: "미연결", provenance: { origin: "source", sourceName: "원본", locator: "3절" } }, { code: "requirement-uncategorized", entityId: "req-b", title: "미연결", provenance: { origin: "source", sourceName: "원본", locator: "3절" } }]);
  });
  it("flags matching text as a review candidate with stable comparison IDs across pages", async () => {
    const t = await setup();
    const requirements = Array.from({ length: 35 }, (_, i) => ({ id: `duplicate-req-${String(i).padStart(2, "0")}`, categoryId: "dup-category", text: i % 2 ? "  로그인\n화면  " : "로그인 화면", origin: "user" }));
    requirements.push({ id: "distinct-req", categoryId: "dup-category", text: "로그인 화면!", origin: "user" });
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-duplicates", revision: 1, sources: [], categories: [{ id: "dup-category", parentId: null, title: "기능", order: 0 }], requirements, issues: [
      { id: "dup-first", categoryId: "dup-category", requirementIds: requirements.map(item => item.id), version: "1.0.0", order: 0, title: "Login   screen", description: "첫 설명", acceptanceCriteria: ["확인"], dependencyIds: [], status: "ready" },
      { id: "dup-second", categoryId: "dup-category", requirementIds: ["distinct-req"], version: "2.0.0", order: 0, title: " login screen ", description: "다른 설명", acceptanceCriteria: ["확인"], dependencyIds: [], status: "ready" },
    ] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.diagnostics(t.project.id, "doc-duplicates", 3, 0);
    expect(first.totalFindings).toBe(35); expect(first.findings.items).toHaveLength(32); expect(first.findings.nextOffset).toBe(32);
    const last = await t.view.diagnostics(t.project.id, "doc-duplicates", 3, 32);
    expect(last.findings.nextOffset).toBeNull();
    const all = [...first.findings.items, ...last.findings.items];
    expect(all.filter(item => item.code === "requirement-same-text")).toHaveLength(34);
    expect(all.find(item => item.entityId === "duplicate-req-01")).toMatchObject({ code: "requirement-same-text", relatedEntityId: "duplicate-req-00", provenance: { origin: "user" } });
    expect(all.find(item => item.code === "issue-same-title")).toMatchObject({ entityId: "dup-second", relatedEntityId: "dup-first", provenance: null });
    expect(all.some(item => item.entityId === "distinct-req")).toBe(false);
    expect((await t.store.readProject(t.project.id)).revision).toBe(3);
    await expect(t.view.diagnostics(t.project.id, "doc-duplicates", 2, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("flags same-version order collisions with stable comparison IDs across pages", async () => {
    const t = await setup();
    const issues = Array.from({ length: 35 }, (_, i) => ({ id: `order-${String(i).padStart(2, "0")}`, categoryId: "cat-order", requirementIds: ["req-order"], version: i % 2 ? "01.00.0" : "1.0.0", order: 3, title: `항목 ${i}`, description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }));
    issues.push({ ...issues[0], id: "other-version", version: "2.0.0", title: "다른 버전" });
    issues.push({ ...issues[0], id: "other-order", order: 4, title: "다른 순서" });
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-order", revision: 1, sources: [], categories: [{ id: "cat-order", parentId: null, title: "분류", order: 0 }], requirements: [{ id: "req-order", categoryId: "cat-order", text: "요구사항", origin: "user" }], issues: issues.reverse() };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.diagnostics(t.project.id, "doc-order", 3, 0);
    const last = await t.view.diagnostics(t.project.id, "doc-order", 3, 32);
    expect(first.totalFindings).toBe(34); expect(first.findings.items).toHaveLength(32); expect(first.findings.nextOffset).toBe(32);
    expect(last.findings.items).toHaveLength(2); expect(last.findings.nextOffset).toBeNull();
    expect([...first.findings.items, ...last.findings.items]).toEqual(Array.from({ length: 34 }, (_, i) => ({ code: "issue-same-version-order", entityId: `order-${String(i + 1).padStart(2, "0")}`, title: `항목 ${i + 1}`, provenance: null, relatedEntityId: "order-00" })));
    expect((await t.store.readProject(t.project.id)).revision).toBe(3);
    await expect(t.view.diagnostics(t.project.id, "doc-order", 2, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("flags recorded AI-proposal origins even when linked, without treating other origins as proposals", async () => {
    const t = await setup();
    const requirements = Array.from({ length: 35 }, (_, i) => ({ id: `proposal-${String(i).padStart(2, "0")}`, categoryId: "cat-proposals", text: `제안 ${i}`, origin: "ai-proposal" }));
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-proposals", revision: 1, sources: [{ id: "src-proposals", name: "기획서", contentHash: `sha256:${"a".repeat(64)}` }], categories: [{ id: "cat-proposals", parentId: null, title: "분류", order: 0 }], requirements: [...requirements, { id: "source-req", categoryId: "cat-proposals", text: "원본", origin: "source", sourceId: "src-proposals" }, { id: "user-req", categoryId: "cat-proposals", text: "사용자", origin: "user" }], issues: [{ id: "proposal-issue", categoryId: "cat-proposals", requirementIds: [...requirements.map(item => item.id), "source-req", "user-req"], version: "1.0.0", order: 0, title: "연결", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.diagnostics(t.project.id, "doc-proposals", 3, 0), last = await t.view.diagnostics(t.project.id, "doc-proposals", 3, 32);
    expect(first).toMatchObject({ totalFindings: 35, linkedRequirementCount: 37, findings: { nextOffset: 32 } });
    expect(last.findings).toMatchObject({ nextOffset: null });
    expect([...first.findings.items, ...last.findings.items]).toEqual(requirements.map(item => ({ code: "requirement-ai-proposal", entityId: item.id, title: item.text, provenance: { origin: "ai-proposal", sourceName: null, locator: null } })));
    expect((await t.view.requirementDetail(t.project.id, "doc-proposals", 3, "proposal-00", 0)).page.items.map(item => item.id)).toEqual(["proposal-issue"]);
    await expect(t.view.diagnostics(t.project.id, "doc-proposals", 2, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await t.store.readProject(t.project.id)).revision).toBe(3);
  });
  it("pages large requirement findings without truncating their text", async () => {
    const t = await setup(), longText = "\u0001".repeat(32768);
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-large-findings", revision: 1, sources: [], categories: [], requirements: [{ id: "req-big", categoryId: null, text: longText, origin: "user" }], issues: [] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.diagnostics(t.project.id, "doc-large-findings", 3, 0);
    expect(first.findings.items).toHaveLength(1); expect(first.findings.items[0].title).toBe(longText); expect(first.findings.nextOffset).toBe(1);
    const last = await t.view.diagnostics(t.project.id, "doc-large-findings", 3, 1);
    expect(last.findings.items[0].title).toBe(longText); expect(last.findings.nextOffset).toBeNull();
  });
  it("reports zero findings only for the explicit checks, including an empty document", async () => {
    const t = await setup();
    const clean = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-clean", revision: 1, sources: [], categories: [{ id: "clean-cat", parentId: null, title: "분류", order: 0 }], requirements: [{ id: "clean-req", categoryId: "clean-cat", text: "요구사항", origin: "user" }], issues: [{ id: "clean-issue", categoryId: "clean-cat", requirementIds: ["clean-req"], version: "1.0.0", order: 0, title: "이슈", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(clean)}\n\`\`\``));
    expect(await t.view.diagnostics(t.project.id, "doc-clean", 3, 0)).toMatchObject({ totalFindings: 0, linkedRequirementCount: 1, requirementCount: 1, findings: { items: [], nextOffset: null } });
    const empty = { ...clean, documentId: "doc-empty", categories: [], requirements: [], issues: [] };
    await t.store.importDocument(t.project.id, 3, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(empty)}\n\`\`\``));
    expect(await t.view.diagnostics(t.project.id, "doc-empty", 4, 0)).toMatchObject({ totalFindings: 0, linkedRequirementCount: 0, requirementCount: 0, issueCount: 0, findings: { items: [], nextOffset: null } });
  });
  it("splits large escaped conditions without truncating their contents", async () => {
    const t = await setup(), condition = "\u0001".repeat(32768);
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-large", revision: 1, sources: [], categories: [], requirements: [], issues: [{ id: "issue-large", categoryId: null, requirementIds: [], version: "1.0.0", order: 0, title: "큰 조건", description: "", acceptanceCriteria: [condition, condition], dependencyIds: [], status: "ready" }] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const page = await t.view.criteria(t.project.id, "doc-large", 3, "issue-large", 0);
    expect(page.items).toEqual([condition]); expect(page.nextOffset).toBe(1);
    expect((await t.view.criteria(t.project.id, "doc-large", 3, "issue-large", 1)).items).toEqual([condition]);
  });
  it("filters the complete document before paging, combining text, local status and numeric version", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-filter", revision: 1, sources: [], categories: [{ id: "cat", parentId: null, title: "검색 분류", order: 0 }], requirements: [], issues: Array.from({ length: 75 }, (_, i) => ({ id: `item-${String(i).padStart(2, "0")}`, categoryId: "cat", requirementIds: [], version: i < 70 ? "1.2.0" : "1.10.0", order: i, title: i < 70 ? `Alpha ${i}` : `Beta ${i}`, description: i === 72 ? "특별한 설명" : "", acceptanceCriteria: ["검증"], dependencyIds: [], status: i === 71 ? "completed" : "ready" })) };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.list(t.project.id, "doc-filter", 3, 0, { search: "alpha", status: "ready", version: "01.02.00" });
    expect(first.items).toHaveLength(32); expect(first.nextOffset).toBe(32);
    const third = await t.view.list(t.project.id, "doc-filter", 3, 64, { search: "ALPHA", status: "ready", version: "1.2.0" });
    expect(third.items.map(issue => issue.id)).toEqual(["item-64", "item-65", "item-66", "item-67", "item-68", "item-69"]); expect(third.nextOffset).toBeNull();
    expect((await t.view.list(t.project.id, "doc-filter", 3, 0, { search: "특별한 설명" })).items.map(issue => issue.id)).toEqual(["item-72"]);
    expect((await t.view.list(t.project.id, "doc-filter", 3, 0, { search: "검색 분류", status: "needs_review" })).items.map(issue => issue.id)).toEqual(["item-71"]);
    expect((await t.view.list(t.project.id, "doc-filter", 3, 0, { search: "not found" })).items).toEqual([]);
    const seen: string[] = []; let offset: number | null = 0, total = 0;
    while (offset !== null) { const report = await t.view.diagnostics(t.project.id, "doc-filter", 3, offset); total = report.totalFindings; seen.push(...report.findings.items.map(item => `${item.code}:${item.entityId}`)); offset = report.findings.nextOffset; }
    expect(seen.length).toBe(total); expect(new Set(seen).size).toBe(total); expect(total).toBeGreaterThan(32);
    await expect(t.view.diagnostics(t.project.id, "doc-filter", 3, total + 1)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("matches canonically equivalent Unicode in document and project searches", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-unicode", revision: 1, sources: [], categories: [{ id: "unicode-cat", parentId: null, title: "화면".normalize("NFD"), order: 0 }], requirements: [], issues: [
      { id: "unicode-title", categoryId: null, requirementIds: [], version: "1.0.0", order: 0, title: "한글".normalize("NFD"), description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" },
      { id: "unicode-description", categoryId: null, requirementIds: [], version: "1.0.0", order: 1, title: "설명 항목", description: "카페", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" },
      { id: "unicode-category", categoryId: "unicode-cat", requirementIds: [], version: "1.0.0", order: 2, title: "분류 항목", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }
    ] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    expect((await t.view.list(t.project.id, "doc-unicode", 3, 0, { search: "한글" })).items.map(item => item.id)).toEqual(["unicode-title"]);
    expect((await t.view.list(t.project.id, "doc-unicode", 3, 0, { search: "카페".normalize("NFD") })).items.map(item => item.id)).toEqual(["unicode-description"]);
    expect((await t.view.list(t.project.id, "doc-unicode", 3, 0, { search: "화면" })).items.map(item => item.id)).toEqual(["unicode-category"]);
    expect((await t.view.projectSearch(t.project.id, 3, { issueOffset: 0 }, { search: "한글" })).items.map(item => item.id)).toEqual(["unicode-title"]);
    expect((await t.view.list(t.project.id, "doc-unicode", 3, 0, { search: "다른 단어" })).items).toEqual([]);
  });
  it("filters canonically equivalent text before paginating", async () => {
    const t = await setup();
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-unicode-pages", revision: 1, sources: [], categories: [], requirements: [], issues: Array.from({ length: 35 }, (_, i) => ({ id: `unicode-page-${i}`, categoryId: null, requirementIds: [], version: "1.0.0", order: i, title: `${"한글".normalize("NFD")} ${i}`, description: "", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" })) };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.list(t.project.id, "doc-unicode-pages", 3, 0, { search: "한글" });
    const second = await t.view.list(t.project.id, "doc-unicode-pages", 3, 32, { search: "한글" });
    expect(first.items).toHaveLength(32); expect(first.nextOffset).toBe(32);
    expect(second.items).toHaveLength(3); expect(second.nextOffset).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(35);
  });
  it("pages all unresolved prerequisites, including those beyond the first page", async () => {
    const t = await setup();
    const predecessors = Array.from({ length: 35 }, (_, i) => ({ id: `dep-${i}`, categoryId: null, requirementIds: [], version: "1.0.0", order: i, title: `선행 ${i}`, description: "", acceptanceCriteria: ["조건"], dependencyIds: [], status: i === 34 ? "completed" : "ready" }));
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-deps", revision: 1, sources: [], categories: [], requirements: [], issues: [...predecessors, { id: "dependent", categoryId: null, requirementIds: [], version: "2.0.0", order: 0, title: "후행", description: "", acceptanceCriteria: ["조건"], dependencyIds: predecessors.map(item => item.id), status: "ready" }] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    expect(await t.view.detail(t.project.id, "doc-deps", 3, "dependent")).toMatchObject({ localStatus: "ready", missingCriteria: false, unverifiedDependencies: 35 });
    const first = await t.view.dependencies(t.project.id, "doc-deps", 3, "dependent", 0), last = await t.view.dependencies(t.project.id, "doc-deps", 3, "dependent", 32);
    expect(first.items).toHaveLength(32); expect(first.nextOffset).toBe(32);
    expect(last.items).toHaveLength(3); expect(last.nextOffset).toBeNull();
    expect(last.items[2]).toMatchObject({ id: "dep-34", importedStatus: "completed", localStatus: "needs_review" });
    await expect(t.view.dependencies(t.project.id, "doc-deps", 2, "dependent", 32)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("pages sibling categories and filters every descendant without mixing in unclassified issues", async () => {
    const t = await setup();
    const roots = Array.from({ length: 40 }, (_, i) => ({ id: `root-${String(i).padStart(2, "0")}`, parentId: null, title: `분류 ${i}`, order: i }));
    const categories = [...roots, { id: "child-1", parentId: "root-00", title: "하위", order: 0 }, { id: "child-2", parentId: "root-00", title: "빈 분류", order: 1 }, { id: "grandchild", parentId: "child-1", title: "더 아래", order: 0 }];
    const entries = ["root-00", "child-1", "grandchild", "root-01", null];
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-categories", revision: 1, sources: [], categories, requirements: [], issues: entries.map((categoryId, index) => ({ id: `issue-cat-${index}`, categoryId, requirementIds: [], version: "1.0.0", order: index, title: `제목 ${index}`, description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" })) };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    const first = await t.view.categories(t.project.id, "doc-categories", 3, null, 0), last = await t.view.categories(t.project.id, "doc-categories", 3, null, 32);
    expect(first.items).toHaveLength(32); expect(first.nextOffset).toBe(32); expect(first.items[0]).toEqual({ id: "root-00", title: "분류 0", hasChildren: true });
    expect(last.items).toHaveLength(8); expect(last.nextOffset).toBeNull();
    expect((await t.view.categories(t.project.id, "doc-categories", 3, "root-00", 0)).items).toEqual([{ id: "child-1", title: "하위", hasChildren: true }, { id: "child-2", title: "빈 분류", hasChildren: false }]);
    expect((await t.view.list(t.project.id, "doc-categories", 3, 0, { categoryId: "root-00" })).items.map(item => item.id)).toEqual(["issue-cat-0", "issue-cat-1", "issue-cat-2"]);
    expect((await t.view.list(t.project.id, "doc-categories", 3, 0, { categoryId: "child-1", search: "제목 2", status: "ready" })).items.map(item => item.id)).toEqual(["issue-cat-2"]);
    expect((await t.view.list(t.project.id, "doc-categories", 3, 0, { categoryId: null })).items.map(item => item.id)).toEqual(["issue-cat-4"]);
    expect((await t.view.list(t.project.id, "doc-categories", 3, 0, { categoryId: "child-2" })).items).toEqual([]);
    await expect(t.view.categories(t.project.id, "doc-categories", 3, "foreign", 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.view.list(t.project.id, "doc-categories", 3, 0, { categoryId: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.view.categories(t.project.id, "doc-categories", 2, null, 0)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("handles deep category ancestry iteratively", async () => {
    const t = await setup();
    const categories = Array.from({ length: 2000 }, (_, i) => ({ id: `node-${i}`, parentId: i ? `node-${i - 1}` : null, title: `분류 ${i}`, order: 0 }));
    const data = { format: "auto-codex-issues", formatVersion: 1, documentId: "doc-deep", revision: 1, sources: [], categories, requirements: [], issues: [{ id: "deep-issue", categoryId: "node-1999", requirementIds: [], version: "1.0.0", order: 0, title: "깊은 항목", description: "설명", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" }] };
    await t.store.importDocument(t.project.id, 2, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    expect((await t.view.list(t.project.id, "doc-deep", 3, 0, { categoryId: "node-0" })).items.map(item => item.id)).toEqual(["deep-issue"]);
    expect((await t.view.categories(t.project.id, "doc-deep", 3, "node-1998", 0)).items[0].id).toBe("node-1999");
  });
  it("continues a project search across empty document batches and multiple issue pages", async () => {
    const t = await setup(); let revision = 2;
    for (let i = 0; i < 12; i++) {
      const data = { format: "auto-codex-issues", formatVersion: 1, documentId: `glob-${String(i).padStart(2, "0")}`, revision: 1, sources: [], categories: [], requirements: [], issues: Array.from({ length: i === 8 ? 35 : 1 }, (_, j) => ({ id: `glob-issue-${i}-${j}`, categoryId: null, requirementIds: [], version: "1.2.0", order: j, title: i === 8 ? `target ${j}` : `other ${j}`, description: "", acceptanceCriteria: ["조건"], dependencyIds: [], status: "ready" })) };
      await t.store.importDocument(t.project.id, revision++, new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(data)}\n\`\`\``));
    }
    const filters = { search: "TARGET", status: "ready" as const, version: "01.2.0" };
    const first = await t.view.projectSearch(t.project.id, revision, { issueOffset: 0 }, filters);
    expect(first).toEqual({ documentId: null, items: [], scannedDocuments: 8, nextCursor: { afterId: "glob-06", issueOffset: 0 } });
    expect(await t.view.projectSearch(t.project.id, revision, { issueOffset: 0 }, filters)).toEqual(first);
    const second = await t.view.projectSearch(t.project.id, revision, first.nextCursor!, filters);
    expect(second.documentId).toBe("glob-08"); expect(second.items).toHaveLength(32); expect(second.scannedDocuments).toBe(2);
    expect(second.nextCursor).toEqual({ afterId: "glob-07", issueOffset: 32 });
    const third = await t.view.projectSearch(t.project.id, revision, second.nextCursor!, filters);
    expect(third.documentId).toBe("glob-08"); expect(third.items).toHaveLength(3); expect(third.nextCursor).toEqual({ afterId: "glob-08", issueOffset: 0 });
    expect(new Set([...second.items, ...third.items].map(item => item.id)).size).toBe(35);
    const final = await t.view.projectSearch(t.project.id, revision, third.nextCursor!, filters);
    expect(final).toEqual({ documentId: null, items: [], scannedDocuments: 3, nextCursor: null });
    await expect(t.view.projectSearch(t.project.id, revision - 1, { issueOffset: 0 }, filters)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("keeps project searches isolated and reports an empty project without a continuation", async () => {
    const t = await setup(), otherPath = path.join(t.root, "other"); await mkdir(otherPath);
    const other = await t.store.createProject(otherPath);
    expect(await t.view.projectSearch(other.id, 1, { issueOffset: 0 })).toEqual({ documentId: null, items: [], scannedDocuments: 0, nextCursor: null });
    expect((await t.view.projectSearch(t.project.id, 2, { issueOffset: 0 })).items.length).toBe(2);
  });
  it("rejects the whole search when the project revision changes during a scan", async () => {
    const t = await setup();
    const empty = (documentId: string) => new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify({ format: "auto-codex-issues", formatVersion: 1, documentId, revision: 1, sources: [], categories: [], requirements: [], issues: [] })}\n\`\`\``);
    await t.store.importDocument(t.project.id, 2, empty("doc-next"));
    const original = t.store.listDocuments.bind(t.store); let calls = 0;
    const spy = vi.spyOn(t.store, "listDocuments").mockImplementation(async (...args) => {
      if (++calls === 2) await t.store.importDocument(t.project.id, 3, empty("doc-added"));
      return original(...args);
    });
    try { await expect(t.view.projectSearch(t.project.id, 3, { issueOffset: 0 }, { search: "no-match" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" }); }
    finally { spy.mockRestore(); }
  });
});
