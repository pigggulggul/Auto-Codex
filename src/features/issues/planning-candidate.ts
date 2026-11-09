import type { AnalysisCandidate } from "../../../shared/issues/sources";
import type { IssueDocument } from "../../../server/issues/document";

/** A selected model result remains a proposal even when it includes a quote. */
export function addCandidateRequirement(document: IssueDocument, candidate: AnalysisCandidate, requirementId: string, text: string): void {
  const evidence = candidate.evidence;
  if (evidence) {
    if (evidence.sourcePath.length > 255) throw new Error("자료 경로가 문서에 저장할 수 있는 길이를 초과했습니다.");
    const hash = `sha256:${evidence.sourceSha256}`;
    const existing = document.sources.find(source => source.id === evidence.sourceId);
    if (existing && (existing.name !== evidence.sourcePath || existing.contentHash !== hash)) throw new Error("같은 자료 ID의 정보가 달라 후보를 추가하지 않았습니다.");
    if (!existing) document.sources.push({ id: evidence.sourceId, name: evidence.sourcePath, contentHash: hash });
  }
  const details = [evidence ? `구간 ${evidence.segmentId}, 위치 ${evidence.start}–${evidence.end}, 인용: ${evidence.quote}` : "", candidate.uncertainty ? `불확실성: ${candidate.uncertainty}` : ""].filter(Boolean).join(" · ");
  if (details.length > 1024) throw new Error("후보 근거와 불확실성이 저장 한도를 초과했습니다.");
  document.requirements.push({ id: requirementId, categoryId: null, text, origin: "ai-proposal", ...(evidence ? { sourceId: evidence.sourceId } : {}), ...(details ? { locator: details } : {}) });
}
