import { describe, expect, it, vi } from "vitest";
import type { IssueViewQuery, IssueViewResult } from "../../../shared/issues/view";
import { orderCandidatePreviews, previewCandidateSelection } from "./candidate-preview";

const item = (id: string) => ({ id, title: id, version: "1.0.0", order: 0, localStatus: "ready" as const, candidateReasons: [], unverifiedDependencyCount: 0, dependencyPreview: [] });
const defaultOptions = { includeRetryable: false, includeFailed: false };
describe("selected issue preview", () => {
  it("orders by numeric version, order and ID without mutating selection order", () => {
    const items = [{ ...item("later"), version: "1.10.0" }, { ...item("z"), version: "01.02.0", order: 3 }, { ...item("a"), version: "1.2.0", order: 3 }, { ...item("first"), version: "1.2.0", order: 1 }, { ...item("large"), version: "999999999999999999999.0.0" }];
    expect(orderCandidatePreviews(items).map(value => value.id)).toEqual(["first", "a", "z", "later", "large"]);
    expect(items.map(value => value.id)).toEqual(["later", "z", "a", "first", "large"]);
  });
  it("reads all selected issues in one fixed-revision request", async () => {
    const request = vi.fn(async (query: IssueViewQuery): Promise<IssueViewResult> => {
      if (query.kind !== "candidatePreview") throw new Error("unexpected");
      return { kind: "candidatePreview", revision: 4, options: query.options ?? defaultOptions, items: query.issueIds.map(item) };
    });
    const result = await previewCandidateSelection("doc-1", 4, ["b", "a"], request, () => true);
    expect(result.map(value => value.id)).toEqual(["b", "a"]);
    expect(request.mock.calls).toEqual([[{ kind: "candidatePreview", documentId: "doc-1", expectedRevision: 4, issueIds: ["b", "a"], options: defaultOptions }]]);
  });
  it("does not return a partial preview when the read fails", async () => {
    const request = vi.fn(async (): Promise<IssueViewResult> => { throw new Error("VIEW_AUTH_REQUIRED"); });
    await expect(previewCandidateSelection("doc-1", 4, ["a", "b"], request, () => true)).rejects.toThrow("VIEW_AUTH_REQUIRED");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("discards a response after the view changes and rejects stale or incomplete results", async () => {
    let live = true;
    const stopped = vi.fn(async (): Promise<IssueViewResult> => { live = false; return { kind: "candidatePreview", revision: 4, options: defaultOptions, items: [item("a")] }; });
    await expect(previewCandidateSelection("doc-1", 4, ["a"], stopped, () => live)).rejects.toThrow("취소");
    for (const result of [{ kind: "candidatePreview" as const, revision: 5, options: defaultOptions, items: [item("a")] }, { kind: "candidatePreview" as const, revision: 4, options: defaultOptions, items: [item("other")] }, { kind: "candidatePreview" as const, revision: 4, options: defaultOptions, items: [] }, { kind: "candidatePreview" as const, revision: 4, options: { ...defaultOptions, includeFailed: true }, items: [item("a")] }]) await expect(previewCandidateSelection("doc-1", 4, ["a"], async () => result, () => true)).rejects.toThrow("응답");
  });
  it("rejects empty, malformed, duplicated and over-limit selections before reading", async () => {
    const request = vi.fn();
    for (const ids of [[], ["a", "a"], ["../outside"], Array.from({ length: 9 }, (_, i) => `i-${i}`)]) await expect(previewCandidateSelection("doc-1", 4, ids, request, () => true)).rejects.toThrow("선택");
    expect(request).not.toHaveBeenCalled();
  });
});
