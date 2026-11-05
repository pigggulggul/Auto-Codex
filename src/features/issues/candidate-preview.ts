import { validCandidateIds, validCandidateOptions, type IssueCandidateOptions, type IssueCandidatePreview, type IssueViewQuery, type IssueViewResult } from "../../../shared/issues/view";
import { compareVersions } from "../../../shared/issues/planning";

/** Display order only. Eligibility and dependencies remain the bridge's responsibility. */
export function orderCandidatePreviews(items: readonly IssueCandidatePreview[]): IssueCandidatePreview[] {
  return [...items].sort((a, b) => compareVersions(a.version, b.version) || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One fixed-revision read, with stale or mismatched results rejected. Never starts an issue. */
export async function previewCandidateSelection(documentId: string, revision: number, ids: readonly string[], request: (query: IssueViewQuery) => Promise<IssueViewResult>, current: () => boolean, options: IssueCandidateOptions = { includeRetryable: false, includeFailed: false }): Promise<IssueCandidatePreview[]> {
  if (!validCandidateIds(ids) || !validCandidateOptions(options)) throw new Error("이슈 선택을 확인하세요.");
  const issueIds = [...ids], capturedOptions = { ...options };
  if (!current()) throw new Error("점검이 취소되었습니다.");
  const result = await request({ kind: "candidatePreview", documentId, expectedRevision: revision, issueIds, options: { ...capturedOptions } });
  if (!current()) throw new Error("점검이 취소되었습니다.");
  if (result.kind !== "candidatePreview" || result.revision !== revision || result.options.includeRetryable !== capturedOptions.includeRetryable || result.options.includeFailed !== capturedOptions.includeFailed || result.items.length !== issueIds.length || result.items.some((item, index) => item.id !== issueIds[index])) throw new Error("이슈 점검 응답이 올바르지 않습니다.");
  return result.items;
}
