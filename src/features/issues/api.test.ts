import { describe, expect, it } from "vitest";
import { IssueApi } from "./api";

describe("issue project transport", () => {
  it("correlates responses and never sends a project path or permissions", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = [];
    api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("status");
    expect(api.request("status")).toBe(pending);
    expect(Object.keys(sent[0]).sort()).toEqual(["clientRequestId", "type", "v"]);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: "foreign", action: "status", ok: true, bound: true });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "status", ok: true, bound: false });
    expect(await pending).toEqual({ bound: false }); api.disconnect();
  });
  it("reports uncertain binding on disconnect and never retries automatically", async () => {
    const api = new IssueApi(), sent: string[] = []; api.connect(raw => sent.push(raw));
    const pending = api.request("bind"); api.disconnect();
    await expect(pending).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    api.connect(raw => sent.push(raw)); expect(sent).toHaveLength(1); api.disconnect();
  });
  it("preserves picker cancellation and rejects overlapping mutations", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("bind");
    await expect(api.request("bind")).rejects.toMatchObject({ code: "BUSY" });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "bind", ok: true, bound: false, cancelled: true });
    expect(await pending).toEqual({ bound: false, cancelled: true }); api.disconnect();
  });
  it("sends no path or contents for native document selection and checks the import receipt", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("import"); expect(sent[0].type).toBe("issues.document.import");
    expect(Object.keys(sent[0]).sort()).toEqual(["clientRequestId", "type", "v"]);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "import", ok: true, bound: true, issueCount: 4, alreadyImported: false });
    expect(await pending).toEqual({ bound: true, issueCount: 4, alreadyImported: false });
    const uncertain = api.request("import"); api.disconnect(); await expect(uncertain).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("accepts bounded issue views only for the correlated request", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("view", { kind: "issues", documentId: "doc-1", expectedRevision: 2, offset: 0 });
    expect(sent[0].type).toBe("issues.view.query");
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "issues", revision: 2, page: { items: [{ id: "issue-1", title: "합성", version: "1.2.0", category: null, localStatus: "needs_review", importedStatus: "completed", missingCriteria: false, unverifiedDependencies: 0 }], nextOffset: null } } });
    expect((await pending).view?.kind).toBe("issues");
    const invalid = api.request("view", { kind: "documents" });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "documents", revision: 2, documents: "invalid", nextAfterId: null } });
    await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("rejects view responses for the wrong query, revision or pagination position", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = [];
    api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "issues" as const, documentId: "doc-1", expectedRevision: 2, offset: 32 };
    const issue = { id: "issue-1", title: "합성", version: "1.0.0", category: null, localStatus: "ready", importedStatus: "ready", missingCriteria: false, unverifiedDependencies: 0 };
    const respond = (view: unknown) => api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view });
    for (const view of [
      { kind: "documents", revision: 2, documents: [], nextAfterId: null },
      { kind: "issues", revision: 3, page: { items: [issue], nextOffset: null } },
      { kind: "issues", revision: 2, page: { items: [issue], nextOffset: 32 } },
      { kind: "issues", revision: 2, page: { items: [], nextOffset: 33 } },
      { kind: "issues", revision: 2, page: { items: [issue], nextOffset: 34 } },
    ]) {
      const pending = api.request("view", query); respond(view);
      await expect(pending).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    const valid = api.request("view", query); respond({ kind: "issues", revision: 2, page: { items: [issue], nextOffset: 33 } });
    expect((await valid).view?.kind).toBe("issues");
    api.disconnect();
  });
  it("checks diagnostic totals, detail identity and document cursors against each request", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = [];
    api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const respond = (view: unknown) => api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view });
    const diagnostic = api.request("view", { kind: "diagnostics", documentId: "doc-1", expectedRevision: 2, offset: 0 });
    respond({ kind: "diagnostics", revision: 2, report: { documentRevision: 1, issueCount: 0, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [], nextOffset: null } } });
    await expect(diagnostic).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const detail = api.request("view", { kind: "detail", documentId: "doc-1", expectedRevision: 2, issueId: "issue-1" });
    respond({ kind: "detail", revision: 2, issue: { id: "issue-2", title: "합성", version: "1.0.0", category: null, localStatus: "ready", importedStatus: "ready", missingCriteria: false, unverifiedDependencies: 0, description: "", criteriaCount: 0, requirementCount: 0, dependencyCount: 0, candidateReasons: [] } });
    await expect(detail).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const documents = api.request("view", { kind: "documents", expectedRevision: 2, afterId: "doc-a" });
    respond({ kind: "documents", revision: 2, documents: [{ id: "doc-a", documentRevision: 1, issueCount: 0 }], nextAfterId: null });
    await expect(documents).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    api.disconnect();
  });
  it("requires an explicit bounded lifetime for an issue view grant", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("authorizeView");
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "authorizeView", ok: true, bound: true, authorized: true, authorizedForMs: 900000 });
    expect(await pending).toEqual({ bound: true, authorized: true, authorizedForMs: 900000 });
    const invalid = api.request("authorizeView");
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "authorizeView", ok: true, bound: true, authorized: true, authorizedForMs: 900001 });
    await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("rejects issue summaries that omit prerequisite information", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("view", { kind: "issues", documentId: "doc-1", expectedRevision: 2, offset: 0 });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "issues", revision: 2, page: { items: [{ id: "issue-1", title: "합성", version: "1.0.0", category: null, localStatus: "ready", importedStatus: "ready" }], nextOffset: null } } });
    await expect(pending).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("sends only document identity and revision for a native save and treats disconnect as uncertain", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("export", { documentId: "doc-1", expectedRevision: 2 });
    expect(sent[0]).toMatchObject({ type: "issues.document.export", documentId: "doc-1", expectedRevision: 2 });
    expect(Object.keys(sent[0]).sort()).toEqual(["clientRequestId", "documentId", "expectedRevision", "type", "v"]);
    api.disconnect(); await expect(pending).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  it("validates the document diagnostic scope and result counts", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const pending = api.request("view", { kind: "diagnostics", documentId: "doc-1", expectedRevision: 2, offset: 0 });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "diagnostics", revision: 2, report: { documentRevision: 1, issueCount: 1, requirementCount: 1, linkedRequirementCount: 1, totalFindings: 1, findings: { items: [{ code: "issue-unlinked", entityId: "i-1", title: "예시", provenance: null }], nextOffset: null } } } });
    expect((await pending).view?.kind).toBe("diagnostics");
    const invalid = api.request("view", { kind: "diagnostics", documentId: "doc-1", expectedRevision: 2, offset: 0 });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "diagnostics", revision: 2, report: { documentRevision: 1, issueCount: 1, requirementCount: 0, linkedRequirementCount: 1, totalFindings: 0, findings: { items: [], nextOffset: null } } } });
    await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("accepts matching-text findings only with a distinct bounded comparison ID", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "diagnostics" as const, documentId: "doc-1", expectedRevision: 2, offset: 0 };
    const reply = (finding: Record<string, unknown>) => ({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view: { kind: "diagnostics", revision: 2, report: { documentRevision: 1, issueCount: 2, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [finding], nextOffset: null } } } });
    const finding = { code: "issue-same-title", entityId: "issue-2", title: "합성", provenance: null, relatedEntityId: "issue-1" };
    const pending = api.request("view", query); api.receive(reply(finding)); expect((await pending).view?.kind).toBe("diagnostics");
    const orderFinding = { ...finding, code: "issue-same-version-order" };
    const orderPending = api.request("view", query); api.receive(reply(orderFinding)); expect((await orderPending).view?.kind).toBe("diagnostics");
    const orderInvalid = api.request("view", query); api.receive(reply({ ...orderFinding, relatedEntityId: undefined })); await expect(orderInvalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    for (const relatedEntityId of [undefined, "issue-2", "../outside", "x".repeat(129)]) {
      const invalid = api.request("view", query); api.receive(reply({ ...finding, relatedEntityId }));
      await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    api.disconnect();
  });
  it("accepts category findings only without comparison IDs or provenance", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "diagnostics" as const, documentId: "doc-1", expectedRevision: 2, offset: 0 };
    const reply = (finding: Record<string, unknown>) => ({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view: { kind: "diagnostics", revision: 2, report: { documentRevision: 1, issueCount: 0, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [finding], nextOffset: null } } } });
    for (const code of ["category-empty", "category-no-requirements", "category-no-issues"]) {
      const pending = api.request("view", query); api.receive(reply({ code, entityId: "cat-1", title: "분류", provenance: null })); expect((await pending).view?.kind).toBe("diagnostics");
    }
    for (const finding of [{ code: "category-empty", entityId: "cat-1", title: "분류", provenance: null, relatedEntityId: "cat-2" }, { code: "category-no-issues", entityId: "cat-1", title: "분류", provenance: { origin: "user", sourceName: null, locator: null } }, { code: "category-unknown", entityId: "cat-1", title: "분류", provenance: null }]) {
      const pending = api.request("view", query); api.receive(reply(finding)); await expect(pending).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    api.disconnect();
  });
  it("correlates a candidate preview with the immutable requested IDs and rejects partial or malformed results", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const ids = ["i-2", "i-1"], query = { kind: "candidatePreview" as const, documentId: "doc-1", expectedRevision: 2, issueIds: ids };
    const reply = (items: unknown, options: unknown = { includeRetryable: false, includeFailed: false }) => ({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view: { kind: "candidatePreview", revision: 2, options, items } });
    const item = (id: string) => ({ id, title: "합성", version: "1.0.0", order: 0, localStatus: "ready", candidateReasons: [], unverifiedDependencyCount: 0, dependencyPreview: [] });
    const pending = api.request("view", query); ids.reverse(); api.receive(reply([item("i-2"), item("i-1")])); expect((await pending).view?.kind).toBe("candidatePreview");
    const bounded = api.request("view", query); api.receive(reply([item("i-1"), { ...item("i-2"), candidateReasons: ["dependency"], unverifiedDependencyCount: 4, dependencyPreview: [{ id: "dep-1", title: "하나" }, { id: "dep-2", title: "둘" }, { id: "dep-3", title: "셋" }] }])); expect((await bounded).view?.kind).toBe("candidatePreview");
    for (const items of [[item("i-1")], [item("i-2"), item("i-1")], [item("i-1"), { ...item("i-2"), candidateReasons: ["unknown"] }], [item("i-1"), { ...item("i-2"), candidateReasons: ["state", "state"] }], [item("i-1"), { ...item("i-2"), version: "1.2" }], [item("i-1"), { ...item("i-2"), order: -1 }], [item("i-1"), { ...item("i-2"), order: Number.MAX_SAFE_INTEGER + 1 }], [item("i-1"), { ...item("i-2"), candidateReasons: ["dependency"], unverifiedDependencyCount: 1, dependencyPreview: [] }], [item("i-1"), { ...item("i-2"), unverifiedDependencyCount: 1, dependencyPreview: [{ id: "dep", title: "선행" }] }], [item("i-1"), { ...item("i-2"), candidateReasons: ["dependency"], unverifiedDependencyCount: 2, dependencyPreview: [{ id: "dep", title: "선행" }, { id: "dep", title: "중복" }] }], [item("i-1"), { ...item("i-2"), candidateReasons: ["dependency"], unverifiedDependencyCount: 1, dependencyPreview: [{ id: "i-2", title: "자기 자신" }] }]]) {
      const invalid = api.request("view", query); api.receive(reply(items)); await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    const mismatch = api.request("view", query); api.receive(reply([item("i-1"), item("i-2")], { includeRetryable: true, includeFailed: false })); await expect(mismatch).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const concealed = api.request("view", query); api.receive(reply([item("i-1"), { ...item("i-2"), localStatus: "failed" }])); await expect(concealed).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const options = { includeRetryable: true, includeFailed: false };
    const selected = api.request("view", { ...query, options }); options.includeRetryable = false;
    api.receive(reply([item("i-1"), { ...item("i-2"), localStatus: "retryable" }], { includeRetryable: true, includeFailed: false })); expect((await selected).view?.kind).toBe("candidatePreview");
    api.disconnect();
  });
  it("accepts only known, unique candidate preview reasons in issue details", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "detail" as const, documentId: "doc-1", expectedRevision: 2, issueId: "issue-1" };
    const reply = (candidateReasons: unknown) => ({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view: { kind: "detail", revision: 2, issue: { id: "issue-1", title: "합성", version: "1.0.0", category: null, localStatus: "needs_review", importedStatus: "completed", missingCriteria: true, unverifiedDependencies: 1, description: "설명", criteriaCount: 0, requirementCount: 0, dependencyCount: 1, candidateReasons } } });
    const pending = api.request("view", query); api.receive(reply(["state", "missing-criteria", "review", "dependency"])); expect((await pending).view?.kind).toBe("detail");
    for (const reasons of [undefined, ["state", "state"], ["unknown"], [null], "state"]) {
      const invalid = api.request("view", query); api.receive(reply(reasons)); await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    api.disconnect();
  });
  it("validates unreferenced source findings", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "diagnostics" as const, documentId: "doc-1", expectedRevision: 2, offset: 0 };
    const reply = (finding: Record<string, unknown>) => ({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view: { kind: "diagnostics", revision: 2, report: { documentRevision: 1, issueCount: 0, requirementCount: 0, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [finding], nextOffset: null } } } });
    const finding = { code: "source-unreferenced", entityId: "source-1", title: "자료", provenance: null };
    const pending = api.request("view", query); api.receive(reply(finding)); expect((await pending).view?.kind).toBe("diagnostics");
    for (const invalidFinding of [{ ...finding, relatedEntityId: "source-2" }, { ...finding, provenance: { origin: "source", sourceName: "자료", locator: null } }, { ...finding, entityId: "../outside" }]) {
      const invalid = api.request("view", query); api.receive(reply(invalidFinding)); await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    api.disconnect();
  });
  it("accepts AI proposal findings only with matching provenance", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "diagnostics" as const, documentId: "doc-1", expectedRevision: 2, offset: 0 };
    const reply = (origin: string) => ({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view: { kind: "diagnostics", revision: 2, report: { documentRevision: 1, issueCount: 0, requirementCount: 1, linkedRequirementCount: 0, totalFindings: 1, findings: { items: [{ code: "requirement-ai-proposal", entityId: "req-ai", title: "제안", provenance: { origin, sourceName: null, locator: null } }], nextOffset: null } } } });
    const valid = api.request("view", query); api.receive(reply("ai-proposal")); expect((await valid).view?.kind).toBe("diagnostics");
    const invalid = api.request("view", query); api.receive(reply("source")); await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    api.disconnect();
  });
  it("validates bounded requirement details and linked issue pages", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "requirementDetail" as const, documentId: "doc-1", expectedRevision: 2, requirementId: "req-1", offset: 0 };
    const requirement = { id: "req-1", text: "합성 요구사항", origin: "source", sourceName: "문서", locator: "1절", category: "기능", linkedIssueCount: 1 };
    const issue = { id: "issue-1", title: "합성 이슈", version: "1.0.0", category: null, localStatus: "ready", importedStatus: "ready", missingCriteria: false, unverifiedDependencies: 0 };
    const reply = (detail: unknown, page: unknown) => ({ type: "issues.project.result", v: 1, clientRequestId: sent.at(-1)!.clientRequestId, action: "view", ok: true, bound: true, view: { kind: "requirementDetail", revision: 2, requirement: detail, page } });
    const pending = api.request("view", query); api.receive(reply(requirement, { items: [issue], nextOffset: null })); expect((await pending).view?.kind).toBe("requirementDetail");
    for (const [detail, page] of [[{ ...requirement, origin: "unknown" }, { items: [], nextOffset: null }], [requirement, { items: [issue], nextOffset: 1 }], [{ ...requirement, linkedIssueCount: 0 }, { items: [issue], nextOffset: null }]]) {
      const invalid = api.request("view", query); api.receive(reply(detail, page)); await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    api.disconnect();
  });
  it("accepts only bounded category pages with explicit child indicators", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "categories" as const, documentId: "doc-1", expectedRevision: 2, parentId: null, offset: 0 };
    const pending = api.request("view", query);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "categories", revision: 2, page: { items: [{ id: "cat-1", title: "기능", hasChildren: true }], nextOffset: null } } });
    expect((await pending).view?.kind).toBe("categories");
    const invalid = api.request("view", query);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "categories", revision: 2, page: { items: [{ id: "cat-1", title: "기능", hasChildren: "yes" }], nextOffset: null } } });
    await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("checks freshness using only a snapshot ID and validates each returned source", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const snapshotId = "snapshot_12345678-1234-4123-8123-123456789abc", sourceId = "source_12345678-1234-4123-8123-123456789abc";
    const query = { snapshotId, expectedRevision: 2, expectedIds: [sourceId] };
    const pending = api.request("snapshotCheck", query);
    expect(sent[0]).toMatchObject({ type: "issues.analysis.check", snapshotId, expectedRevision: 2 }); expect(sent[0]).not.toHaveProperty("expectedIds");
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "snapshotCheck", ok: true, bound: true, freshness: { snapshotId, projectRevision: 2, files: [{ id: sourceId, state: "changed" }] } });
    expect((await pending).freshness?.files[0].state).toBe("changed");
    const invalid = api.request("snapshotCheck", query);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "snapshotCheck", ok: true, bound: true, freshness: { snapshotId, projectRevision: 2, files: [{ id: sourceId, state: ["unchanged"] }] } });
    await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("requires a matching revision and complete unprocessed snapshot summary", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const sourceId = "source_12345678-1234-4123-8123-123456789abc", sha256 = "a".repeat(64);
    const request = { expectedRevision: 2, expectedSources: [{ id: sourceId, sha256 }], instruction: "synthetic" };
    const pending = api.request("snapshotPrepare", request);
    expect(sent[0]).toMatchObject({ type: "issues.analysis.prepare", ...request });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "snapshotPrepare", ok: true, bound: true, snapshot: { id: "snapshot_12345678-1234-4123-8123-123456789abc", projectRevision: 2, sources: [{ id: sourceId, sha256, relativePath: "plan.md", segmentCount: 1 }], totalSegments: 1, processedSegments: 0, hasInstruction: true } });
    expect((await pending).snapshot?.processedSegments).toBe(0);
    const invalid = api.request("snapshotPrepare", request);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "snapshotPrepare", ok: true, bound: true, snapshot: { id: "snapshot_12345678-1234-4123-8123-123456789abc", projectRevision: 3, sources: [{ id: sourceId, sha256, relativePath: "plan.md", segmentCount: 1 }], totalSegments: 1, processedSegments: 1, hasInstruction: true } });
    await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("sends source selection without paths and validates preview identity", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const sourceId = "source_12345678-1234-4123-8123-123456789abc";
    const added = api.request("sourceAdd");
    expect(Object.keys(sent[0]).sort()).toEqual(["clientRequestId", "type", "v"]);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "sourceAdd", ok: true, bound: true, sources: { items: [{ id: sourceId, relativePath: "plan.md", bytes: 4, sha256: "a".repeat(64), projectRevision: 1 }], totalBytes: 4 } });
    expect((await added).sources?.items[0].id).toBe(sourceId);
    const read = api.request("sourceRead", { sourceId, offset: 0 });
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "sourceRead", ok: true, bound: true, chunk: { sourceId: "source_other", offset: 0, text: "data", nextOffset: null } });
    await expect(read).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const list = api.request("sourceList");
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[2].clientRequestId, action: "sourceList", ok: true, bound: true, sources: { items: [{ id: sourceId, relativePath: "../secret.txt", bytes: 4, sha256: "a".repeat(64), projectRevision: 1 }], totalBytes: 4 } });
    await expect(list).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
  it("validates bounded project search cursors and partial empty results", async () => {
    const api = new IssueApi(), sent: Record<string, unknown>[] = []; api.connect(raw => sent.push(JSON.parse(raw) as Record<string, unknown>));
    const query = { kind: "projectIssues" as const, expectedRevision: 2, cursor: { issueOffset: 0 }, filters: { search: "합성" } };
    const pending = api.request("view", query);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[0].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "projectIssues", revision: 2, page: { documentId: null, items: [], scannedDocuments: 8, nextCursor: { afterId: "doc-8", issueOffset: 0 } } } });
    expect((await pending).view?.kind).toBe("projectIssues");
    const invalid = api.request("view", query);
    api.receive({ type: "issues.project.result", v: 1, clientRequestId: sent[1].clientRequestId, action: "view", ok: true, bound: true, view: { kind: "projectIssues", revision: 2, page: { documentId: null, items: [], scannedDocuments: 9, nextCursor: { afterId: "../outside", issueOffset: 0 } } } });
    await expect(invalid).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); api.disconnect();
  });
});
