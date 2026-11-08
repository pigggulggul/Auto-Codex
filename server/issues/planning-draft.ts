import { parseIssueDocument, type IssueDocument } from "./document.js";

/** Internal, in-memory draft. Authorization, persistence and source freshness are
 * the caller's responsibility; this class is not an issue registration API. */
export type DraftReview = {
  requirementId: string;
  issueId: string;
  decision: "confirmed" | "deferred";
  reason: string;
};

export class PlanningDraftError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "VERSION_CONFLICT" | "NOT_FOUND" | "LIMIT_EXCEEDED") { super(code); }
}

const documentBytes = (document: IssueDocument): Uint8Array =>
  new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(document)}\n\`\`\``);

/** Parse again at every boundary: a TypeScript type is not input validation. */
function checkedDocument(value: unknown): IssueDocument {
  let json: string;
  try {
    json = JSON.stringify(value);
    if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > 4 * 1024 * 1024) throw new Error();
    return parseIssueDocument(new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${json}\n\`\`\``));
  } catch { throw new PlanningDraftError("INVALID_INPUT"); }
}

export class PlanningDraft {
  private document: IssueDocument;
  private reviews = new Map<string, DraftReview>();
  private history: { revision: number; review: DraftReview }[] = [];
  private revision = 1;

  constructor(document: unknown, readonly projectRevision: number) {
    if (!Number.isSafeInteger(projectRevision) || projectRevision < 1) throw new PlanningDraftError("INVALID_INPUT");
    this.document = checkedDocument(document);
  }

  private requireRevision(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected !== this.revision) throw new PlanningDraftError("VERSION_CONFLICT");
  }

  /** Return copies so callers cannot change a reviewed revision in place. */
  read() {
    return { projectRevision: this.projectRevision, revision: this.revision, document: structuredClone(this.document), reviews: structuredClone([...this.reviews.values()]), history: structuredClone(this.history) };
  }

  replace(expectedRevision: number, value: unknown): void {
    this.requireRevision(expectedRevision);
    const next = checkedDocument(value);
    if (next.documentId !== this.document.documentId || next.revision !== this.document.revision) throw new PlanningDraftError("INVALID_INPUT");
    if (this.revision === Number.MAX_SAFE_INTEGER) throw new PlanningDraftError("LIMIT_EXCEEDED");
    if (this.history.length + this.reviews.size > 4096) throw new PlanningDraftError("LIMIT_EXCEEDED");
    for (const review of this.reviews.values()) this.history.push({ revision: this.revision, review });
    this.document = next;
    this.revision++;
    // A previous semantic decision cannot be carried to changed text or links.
    this.reviews.clear();
  }

  review(expectedRevision: number, value: unknown): void {
    this.requireRevision(expectedRevision);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningDraftError("INVALID_INPUT");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).length !== 4 || !["requirementId", "issueId", "decision", "reason"].every(key => Object.hasOwn(input, key)) || typeof input.requirementId !== "string" || typeof input.issueId !== "string" || !(input.decision === "confirmed" || input.decision === "deferred") || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000 || input.reason.includes("\0")) throw new PlanningDraftError("INVALID_INPUT");
    const issue = this.document.issues.find(item => item.id === input.issueId);
    if (!issue || !issue.requirementIds.includes(input.requirementId) || !this.document.requirements.some(item => item.id === input.requirementId)) throw new PlanningDraftError("NOT_FOUND");
    const key = JSON.stringify([input.requirementId, input.issueId]);
    const previous = this.reviews.get(key);
    if (previous) {
      if (this.history.length >= 4096) throw new PlanningDraftError("LIMIT_EXCEEDED");
      this.history.push({ revision: this.revision, review: previous });
    }
    this.reviews.set(key, { requirementId: input.requirementId, issueId: input.issueId, decision: input.decision, reason: input.reason });
  }

  /** A review describes individual links only, never overall semantic coverage. */
  coverage(expectedRevision: number) {
    this.requireRevision(expectedRevision);
    const links = this.document.issues.flatMap(issue => issue.requirementIds.map(requirementId => ({ requirementId, issueId: issue.id })));
    const reviewed = links.filter(link => this.reviews.has(JSON.stringify([link.requirementId, link.issueId]))).length;
    const deferred = [...this.reviews.values()].filter(review => review.decision === "deferred").length;
    const linked = new Set(links.map(link => link.requirementId));
    return { links: links.length, reviewed, deferred, unreviewed: links.length - reviewed, unlinkedRequirements: this.document.requirements.filter(requirement => !linked.has(requirement.id)).length, unlinkedIssues: this.document.issues.filter(issue => issue.requirementIds.length === 0).length, semanticCompleteness: "unverified" as const };
  }

  /** Serialization is not authorization or registration. The caller must
   * recheck the project, snapshot and grant immediately before persisting. */
  exportForRegistration(expectedRevision: number, currentProjectRevision: number): Uint8Array {
    this.requireRevision(expectedRevision);
    if (currentProjectRevision !== this.projectRevision) throw new PlanningDraftError("VERSION_CONFLICT");
    return documentBytes(checkedDocument(this.document));
  }
}
