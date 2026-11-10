import { parseIssueDocument, type IssueDocument } from "./document.js";
import { randomUUID } from "node:crypto";
import type { SemanticDecision, SemanticFinding, SemanticRecord, SemanticResult } from "../../shared/issues/sources.js";

/** Internal, in-memory draft. Authorization, persistence and source freshness are
 * the caller's responsibility; this class is not an issue registration API. */
export type DraftReview = {
  requirementId: string;
  issueId: string;
  decision: "confirmed" | "deferred";
  reason: string;
};
export type PlanningMessage = { revision: number; role: "user" | "assistant"; text: string };

export class PlanningDraftError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "VERSION_CONFLICT" | "NOT_FOUND" | "LIMIT_EXCEEDED") { super(code); }
}

const documentBytes = (document: IssueDocument): Uint8Array =>
  new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(document)}\n\`\`\``);

function checkedSemanticRecord(value: unknown, revision: number, projectRevision: number, document: IssueDocument): SemanticRecord {
  const invalid = (): never => { throw new PlanningDraftError("INVALID_INPUT"); };
  const obj = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
  const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
  const bounded = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !!v.trim() && !v.includes("\0");
  if (!obj(value) || Object.keys(value).sort().join(",") !== "decisions,result,segmentIndex" || !Number.isSafeInteger(value.segmentIndex) || Number(value.segmentIndex) < 0 || Number(value.segmentIndex) >= 2048 || !obj(value.result) || !Array.isArray(value.decisions) || value.decisions.length > 512) return invalid();
  const result = value.result;
  if (Object.keys(result).sort().join(",") !== "draftRevision,findings,projectRevision,segmentId,snapshotId,sourcePath,sourceSha256" || !Number.isSafeInteger(result.projectRevision) || Number(result.projectRevision) < 1 || !Number.isSafeInteger(result.draftRevision) || Number(result.draftRevision) < 1 || Number(result.draftRevision) > revision || !id(result.snapshotId) || !id(result.segmentId) || typeof result.sourcePath !== "string" || !result.sourcePath || result.sourcePath.length > 1024 || result.sourcePath.includes("\\") || result.sourcePath.split("/").some(part => !part || part === "." || part === ".." || part.includes(":")) || typeof result.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.sourceSha256) || !Array.isArray(result.findings) || result.findings.length > 16) return invalid();
  if (Number(result.draftRevision) === revision && result.projectRevision !== projectRevision) return invalid();
  const ids = new Set<string>();
  const findings: SemanticFinding[] = result.findings.map(item => {
    if (!obj(item) || Object.keys(item).sort().join(",") !== "evidence,id,issueId,kind,requirementId,summary,uncertainty" || !id(item.id) || ids.has(item.id) || !["possible-omission", "possible-mismatch", "possible-duplicate", "unclear-criteria"].includes(String(item.kind)) || !bounded(item.summary, 600) || !bounded(item.uncertainty, 500) || !(item.requirementId === null || id(item.requirementId)) || !(item.issueId === null || id(item.issueId))) return invalid();
    if (Number(result.draftRevision) === revision && (item.requirementId !== null && !document.requirements.some(v => v.id === item.requirementId) || item.issueId !== null && !document.issues.some(v => v.id === item.issueId))) return invalid();
    ids.add(item.id); let evidence: SemanticFinding["evidence"] = null;
    if (item.evidence !== null) {
      const e = item.evidence;
      if (!obj(e) || Object.keys(e).sort().join(",") !== "end,quote,segmentId,sourceId,sourceSha256,start" || !id(e.sourceId) || !id(e.segmentId) || e.segmentId !== result.segmentId || typeof e.sourceSha256 !== "string" || e.sourceSha256 !== result.sourceSha256 || !bounded(e.quote, 300) || !Number.isSafeInteger(e.start) || Number(e.start) < 0 || !Number.isSafeInteger(e.end) || Number(e.end) - Number(e.start) !== e.quote.length) return invalid();
      evidence = { sourceId: e.sourceId, segmentId: e.segmentId, sourceSha256: e.sourceSha256, quote: e.quote, start: Number(e.start), end: Number(e.end) };
    }
    return { id: item.id, kind: item.kind as SemanticFinding["kind"], summary: item.summary, uncertainty: item.uncertainty, requirementId: item.requirementId as string | null, issueId: item.issueId as string | null, evidence };
  });
  const decisions: SemanticDecision[] = value.decisions.map(item => {
    if (!obj(item) || Object.keys(item).sort().join(",") !== "findingId,reason,status" || !id(item.findingId) || !ids.has(item.findingId) || !(item.status === "resolved" || item.status === "deferred") || !bounded(item.reason, 2000)) return invalid();
    return { findingId: item.findingId, status: item.status, reason: item.reason };
  });
  return { segmentIndex: Number(value.segmentIndex), result: { projectRevision: Number(result.projectRevision), draftRevision: Number(result.draftRevision), snapshotId: result.snapshotId, sourcePath: result.sourcePath, sourceSha256: result.sourceSha256, segmentId: result.segmentId, findings }, decisions };
}

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
  private validations: SemanticRecord[] = [];
  private conversation: PlanningMessage[] = [];
  private revision = 1;

  constructor(document: unknown, readonly projectRevision: number) {
    if (!Number.isSafeInteger(projectRevision) || projectRevision < 1) throw new PlanningDraftError("INVALID_INPUT");
    this.document = checkedDocument(document);
  }

  /** Restore only validated snapshots from a trusted storage layer. A snapshot
   * carries no project authorization; the caller must verify project identity. */
  static restore(value: unknown): PlanningDraft {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningDraftError("INVALID_INPUT");
    const state = value as Record<string, unknown>;
    if (Object.keys(state).some(key => !["document", "history", "projectRevision", "reviews", "revision", "validations", "conversation"].includes(key)) || !["document", "history", "projectRevision", "reviews", "revision"].every(key => Object.hasOwn(state, key)) || !Number.isSafeInteger(state.revision) || Number(state.revision) < 1 || !Number.isSafeInteger(state.projectRevision) || Number(state.projectRevision) < 1 || !Array.isArray(state.reviews) || !Array.isArray(state.history) || state.reviews.length + state.history.length > 4096 || state.validations !== undefined && (!Array.isArray(state.validations) || state.validations.length > 32) || state.conversation !== undefined && (!Array.isArray(state.conversation) || state.conversation.length > 256)) throw new PlanningDraftError("INVALID_INPUT");
    let serialized: string;
    try { serialized = JSON.stringify(state); } catch { throw new PlanningDraftError("INVALID_INPUT"); }
    if (Buffer.byteLength(serialized, "utf8") > 4 * 1024 * 1024) throw new PlanningDraftError("LIMIT_EXCEEDED");
    const draft = new PlanningDraft(state.document, Number(state.projectRevision));
    draft.revision = Number(state.revision);
    const validateReview = (input: unknown): DraftReview => {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlanningDraftError("INVALID_INPUT");
      const review = input as Record<string, unknown>;
      if (Object.keys(review).sort().join(",") !== "decision,issueId,reason,requirementId" || typeof review.requirementId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(review.requirementId) || typeof review.issueId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(review.issueId) || !(review.decision === "confirmed" || review.decision === "deferred") || typeof review.reason !== "string" || !review.reason.trim() || review.reason.length > 2000 || review.reason.includes("\0")) throw new PlanningDraftError("INVALID_INPUT");
      return { requirementId: review.requirementId, issueId: review.issueId, decision: review.decision, reason: review.reason };
    };
    for (const raw of state.reviews) {
      const review = validateReview(raw), key = JSON.stringify([review.requirementId, review.issueId]);
      if (draft.reviews.has(key) || !draft.document.issues.some(issue => issue.id === review.issueId && issue.requirementIds.includes(review.requirementId)) || !draft.document.requirements.some(item => item.id === review.requirementId)) throw new PlanningDraftError("INVALID_INPUT");
      draft.reviews.set(key, review);
    }
    for (const raw of state.history) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PlanningDraftError("INVALID_INPUT");
      const entry = raw as Record<string, unknown>;
      if (Object.keys(entry).sort().join(",") !== "review,revision" || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1 || Number(entry.revision) > draft.revision) throw new PlanningDraftError("INVALID_INPUT");
      draft.history.push({ revision: Number(entry.revision), review: validateReview(entry.review) });
    }
    const findingIds = new Set<string>();
    for (const raw of (state.validations as unknown[] | undefined) ?? []) {
      const validation = checkedSemanticRecord(raw, draft.revision, draft.projectRevision, draft.document);
      for (const finding of validation.result.findings) { if (findingIds.has(finding.id)) throw new PlanningDraftError("INVALID_INPUT"); findingIds.add(finding.id); }
      draft.validations.push(validation);
    }
    for (const raw of (state.conversation as unknown[] | undefined) ?? []) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PlanningDraftError("INVALID_INPUT");
      const item = raw as Record<string, unknown>;
      if (Object.keys(item).sort().join(",") !== "revision,role,text" || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1 || Number(item.revision) > draft.revision || !(item.role === "user" || item.role === "assistant") || typeof item.text !== "string" || !item.text.trim() || item.text.length > 65536 || item.text.includes("\0")) throw new PlanningDraftError("INVALID_INPUT");
      draft.conversation.push({ revision: Number(item.revision), role: item.role, text: item.text });
    }
    return draft;
  }

  /** Copy a stale saved draft to the current project revision only after an
   * explicit user action. All old reviews become historical, not approval. */
  static rebase(value: unknown, projectRevision: number): PlanningDraft {
    const old = PlanningDraft.restore(value);
    if (!Number.isSafeInteger(projectRevision) || projectRevision < 1 || projectRevision === old.projectRevision || old.revision >= Number.MAX_SAFE_INTEGER) throw new PlanningDraftError("INVALID_INPUT");
    const state = old.read();
    if (state.history.length + state.reviews.length > 4096) throw new PlanningDraftError("LIMIT_EXCEEDED");
    return PlanningDraft.restore({ projectRevision, revision: state.revision + 1, document: state.document, reviews: [], history: [...state.history, ...state.reviews.map(review => ({ revision: state.revision, review }))], validations: state.validations, conversation: state.conversation });
  }

  /** A separately requested copy receives fresh identities; existing document
   * and dependency links are never overwritten. Historical reviews refer to
   * the original IDs and are not current review decisions for the copy. */
  static copyAsNew(value: unknown, projectRevision: number): PlanningDraft {
    const state = PlanningDraft.restore(value).read();
    if (!Number.isSafeInteger(projectRevision) || projectRevision < 1 || state.revision >= Number.MAX_SAFE_INTEGER || state.history.length + state.reviews.length > 4096) throw new PlanningDraftError("INVALID_INPUT");
    const document = structuredClone(state.document);
    const sources = new Map(document.sources.map(item => [item.id, `source_${randomUUID()}`]));
    const categories = new Map(document.categories.map(item => [item.id, `category_${randomUUID()}`]));
    const requirements = new Map(document.requirements.map(item => [item.id, `req_${randomUUID()}`]));
    const issues = new Map(document.issues.map(item => [item.id, `issue_${randomUUID()}`]));
    document.documentId = `doc_${randomUUID()}`; document.revision = 1;
    for (const item of document.sources) item.id = sources.get(item.id)!;
    for (const item of document.categories) { item.id = categories.get(item.id)!; item.parentId = item.parentId === null ? null : categories.get(item.parentId)!; }
    for (const item of document.requirements) { item.id = requirements.get(item.id)!; item.categoryId = item.categoryId === null ? null : categories.get(item.categoryId)!; if (item.sourceId) item.sourceId = sources.get(item.sourceId)!; }
    for (const item of document.issues) { item.id = issues.get(item.id)!; item.categoryId = item.categoryId === null ? null : categories.get(item.categoryId)!; item.requirementIds = item.requirementIds.map(id => requirements.get(id)!); item.dependencyIds = item.dependencyIds.map(id => issues.get(id)!); if (item.status === "completed") item.status = "needs_review"; }
    return PlanningDraft.restore({ projectRevision, revision: state.revision + 1, document, reviews: [], history: [...state.history, ...state.reviews.map(review => ({ revision: state.revision, review }))], validations: state.validations, conversation: state.conversation });
  }

  private requireRevision(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected !== this.revision) throw new PlanningDraftError("VERSION_CONFLICT");
  }

  /** Return copies so callers cannot change a reviewed revision in place. */
  read() {
    return { projectRevision: this.projectRevision, revision: this.revision, document: structuredClone(this.document), reviews: structuredClone([...this.reviews.values()]), history: structuredClone(this.history), validations: structuredClone(this.validations), conversation: structuredClone(this.conversation) };
  }
  hasConversationCapacity(count: number): boolean { return Number.isSafeInteger(count) && count > 0 && this.conversation.length + count <= 256; }
  addConversation(expectedRevision: number, role: "user" | "assistant", text: string): void {
    this.requireRevision(expectedRevision);
    if (!(role === "user" || role === "assistant") || typeof text !== "string" || !text.trim() || text.length > 65536 || text.includes("\0")) throw new PlanningDraftError("INVALID_INPUT");
    if (!this.hasConversationCapacity(1)) throw new PlanningDraftError("LIMIT_EXCEEDED");
    if (Buffer.byteLength(JSON.stringify({ ...this.read(), conversation: [...this.conversation, { revision: this.revision, role, text }] }), "utf8") > 4 * 1024 * 1024) throw new PlanningDraftError("LIMIT_EXCEEDED");
    this.conversation.push({ revision: this.revision, role, text });
  }

  addSemanticResult(expectedRevision: number, segmentIndex: number, result: SemanticResult): void {
    this.requireRevision(expectedRevision);
    if (result.projectRevision !== this.projectRevision || result.draftRevision !== this.revision || this.validations.length >= 32) throw new PlanningDraftError("VERSION_CONFLICT");
    const next = checkedSemanticRecord({ segmentIndex, result, decisions: [] }, this.revision, this.projectRevision, this.document);
    if (this.validations.some(record => record.result.findings.some(old => next.result.findings.some(item => item.id === old.id)))) throw new PlanningDraftError("INVALID_INPUT");
    if (Buffer.byteLength(JSON.stringify({ ...this.read(), validations: [...this.validations, next] }), "utf8") > 4 * 1024 * 1024) throw new PlanningDraftError("LIMIT_EXCEEDED");
    this.validations.push(next);
  }
  reviewSemantic(expectedRevision: number, findingId: string, status: "resolved" | "deferred", reason: string): void {
    this.requireRevision(expectedRevision);
    if (!(status === "resolved" || status === "deferred") || typeof reason !== "string" || !reason.trim() || reason.length > 2000 || reason.includes("\0")) throw new PlanningDraftError("INVALID_INPUT");
    const record = this.validations.find(value => value.result.findings.some(item => item.id === findingId));
    if (!record) throw new PlanningDraftError("NOT_FOUND");
    if (record.result.draftRevision !== this.revision || record.result.projectRevision !== this.projectRevision) throw new PlanningDraftError("VERSION_CONFLICT");
    if (record.decisions.length >= 512) throw new PlanningDraftError("LIMIT_EXCEEDED");
    if (Buffer.byteLength(JSON.stringify(this.read()), "utf8") + Buffer.byteLength(reason, "utf8") + 256 > 4 * 1024 * 1024) throw new PlanningDraftError("LIMIT_EXCEEDED");
    record.decisions.push({ findingId, status, reason });
  }
  semanticSource(expectedRevision: number, findingId: string): { sourcePath: string; sourceSha256: string } {
    this.requireRevision(expectedRevision);
    const record = this.validations.find(value => value.result.findings.some(item => item.id === findingId));
    if (!record) throw new PlanningDraftError("NOT_FOUND");
    if (record.result.draftRevision !== this.revision || record.result.projectRevision !== this.projectRevision) throw new PlanningDraftError("VERSION_CONFLICT");
    return { sourcePath: record.result.sourcePath, sourceSha256: record.result.sourceSha256 };
  }

  replace(expectedRevision: number, value: unknown): void {
    this.requireRevision(expectedRevision);
    const next = checkedDocument(value);
    if (next.documentId !== this.document.documentId || next.revision !== this.document.revision) throw new PlanningDraftError("INVALID_INPUT");
    if (this.revision === Number.MAX_SAFE_INTEGER) throw new PlanningDraftError("LIMIT_EXCEEDED");
    if (this.history.length + this.reviews.size > 4096) throw new PlanningDraftError("LIMIT_EXCEEDED");
    if (Buffer.byteLength(JSON.stringify({ ...this.read(), revision: this.revision + 1, document: next, reviews: [], history: [...this.history, ...[...this.reviews.values()].map(review => ({ revision: this.revision, review }))] }), "utf8") > 4 * 1024 * 1024) throw new PlanningDraftError("LIMIT_EXCEEDED");
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
    if (this.history.length + this.reviews.size >= 4096) throw new PlanningDraftError("LIMIT_EXCEEDED");
    if (Buffer.byteLength(JSON.stringify(this.read()), "utf8") + Buffer.byteLength(JSON.stringify(input), "utf8") + 256 > 4 * 1024 * 1024) throw new PlanningDraftError("LIMIT_EXCEEDED");
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
