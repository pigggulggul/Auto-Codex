import { comparePlannedIssues, normalizeVersion } from "../../shared/issues/planning.js";
import type { IssueCategoryView, IssueDependencyView, IssueDetail, IssueDiagnosticReport, IssueFinding, IssueFilters, IssueRequirementView, IssueSummary, Page, ProjectIssueCursor, ProjectIssueFilters, ProjectIssuePage, RequirementDetail } from "../../shared/issues/view.js";
import { IssueStore, IssueStoreError } from "./store.js";

const PAGE_SIZE = 32;
const SEARCH_DOCUMENT_LIMIT = 8;
const MAX_RESPONSE_BYTES = 240 * 1024;
const invalidOffset = () => { throw new IssueStoreError("LIMIT_EXCEEDED", "이슈 목록 위치가 올바르지 않습니다."); };
const searchKey = (value: string) => value.normalize("NFC").toLowerCase();
function offsetValue(offset: number): number { if (!Number.isSafeInteger(offset) || offset < 0) invalidOffset(); return offset; }
function boundedPage<T>(values: T[], offset: number, reservedBytes = 512): Page<T> {
  offsetValue(offset);
  if (offset > values.length) invalidOffset();
  if (reservedBytes > MAX_RESPONSE_BYTES) throw new IssueStoreError("LIMIT_EXCEEDED", "이 항목이 표시 크기 제한을 초과했습니다.");
  const items: T[] = []; let size = reservedBytes;
  for (const value of values.slice(offset, offset + PAGE_SIZE)) {
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
    if (size + bytes > MAX_RESPONSE_BYTES) break;
    items.push(value); size += bytes;
  }
  if (!items.length && offset < values.length) throw new IssueStoreError("LIMIT_EXCEEDED", "이 항목이 표시 크기 제한을 초과했습니다.");
  return { items, nextOffset: offset + items.length < values.length ? offset + items.length : null };
}

export class IssueView {
  constructor(private readonly store: IssueStore) {}
  private async load(projectId: string, documentId: string, revision: number) {
    return this.store.readDocument(projectId, documentId, revision);
  }
  /** Search at most eight documents per request; the cursor represents unsearched work. */
  async projectSearch(projectId: string, revision: number, cursor: ProjectIssueCursor, filters: ProjectIssueFilters = {}): Promise<ProjectIssuePage> {
    let afterId = cursor.afterId, issueOffset = cursor.issueOffset, scannedDocuments = 0;
    for (; scannedDocuments < SEARCH_DOCUMENT_LIMIT;) {
      const documents = await this.store.listDocuments(projectId, revision, 2, afterId);
      const document = documents.documents[0];
      if (!document) return { documentId: null, items: [], scannedDocuments, nextCursor: null };
      const page = await this.list(projectId, document.id, revision, issueOffset, filters);
      scannedDocuments++;
      const nextCursor = page.nextOffset !== null ? { ...(afterId ? { afterId } : {}), issueOffset: page.nextOffset } : documents.documents.length > 1 ? { afterId: document.id, issueOffset: 0 } : null;
      if (page.items.length) return { documentId: document.id, items: page.items, scannedDocuments, nextCursor };
      if (!nextCursor) return { documentId: null, items: [], scannedDocuments, nextCursor: null };
      afterId = nextCursor.afterId; issueOffset = nextCursor.issueOffset;
    }
    return { documentId: null, items: [], scannedDocuments, nextCursor: { ...(afterId ? { afterId } : {}), issueOffset } };
  }
  async categories(projectId: string, documentId: string, revision: number, parentId: string | null, offset: number): Promise<Page<IssueCategoryView>> {
    const { document } = await this.load(projectId, documentId, revision);
    if (parentId !== null && !document.categories.some(category => category.id === parentId)) throw new IssueStoreError("NOT_FOUND", "이 문서의 분류를 찾을 수 없습니다.");
    const parents = new Set(document.categories.map(category => category.parentId).filter((id): id is string => id !== null));
    const children = document.categories.filter(category => category.parentId === parentId).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return boundedPage(children.map(category => ({ id: category.id, title: category.title, hasChildren: parents.has(category.id) })), offset);
  }
  /** Deterministic checks of imported records only; this is not a persisted or semantic validation run. */
  async diagnostics(projectId: string, documentId: string, revision: number, offset: number): Promise<IssueDiagnosticReport> {
    const { document } = await this.load(projectId, documentId, revision);
    const linked = new Set(document.issues.flatMap(issue => issue.requirementIds));
    const sources = new Map(document.sources.map(source => [source.id, source.name]));
    const requirementTexts = new Map<string, string>(), issueTitles = new Map<string, string>(), issueOrders = new Map<string, string>();
    const comparisonKey = (text: string) => text.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
    const findings: IssueFinding[] = [];
    for (const requirement of [...document.requirements].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      const provenance = { origin: requirement.origin, sourceName: requirement.sourceId ? sources.get(requirement.sourceId) ?? null : null, locator: requirement.locator ?? null };
      if (!linked.has(requirement.id)) findings.push({ code: "requirement-unlinked", entityId: requirement.id, title: requirement.text, provenance });
      if (!requirement.categoryId) findings.push({ code: "requirement-uncategorized", entityId: requirement.id, title: requirement.text, provenance });
      if (requirement.origin === "ai-proposal") findings.push({ code: "requirement-ai-proposal", entityId: requirement.id, title: requirement.text, provenance });
      const key = comparisonKey(requirement.text), relatedEntityId = requirementTexts.get(key);
      if (key && relatedEntityId) findings.push({ code: "requirement-same-text", entityId: requirement.id, title: requirement.text, provenance, relatedEntityId });
      else if (key) requirementTexts.set(key, requirement.id);
    }
    for (const issue of [...document.issues].sort(comparePlannedIssues)) {
      const add = (code: IssueFinding["code"]) => findings.push({ code, entityId: issue.id, title: issue.title, provenance: null });
      if (!issue.requirementIds.length) add("issue-unlinked");
      if (!issue.categoryId) add("issue-uncategorized");
      if (!issue.description.trim()) add("issue-missing-description");
      if (!issue.acceptanceCriteria.length) add("issue-missing-criteria");
      if (issue.status === "completed") add("issue-unverified-completion");
      const key = comparisonKey(issue.title), relatedEntityId = issueTitles.get(key);
      if (key && relatedEntityId) findings.push({ code: "issue-same-title", entityId: issue.id, title: issue.title, provenance: null, relatedEntityId });
      else if (key) issueTitles.set(key, issue.id);
      const orderKey = JSON.stringify([normalizeVersion(issue.version), issue.order]), firstWithOrder = issueOrders.get(orderKey);
      if (firstWithOrder) findings.push({ code: "issue-same-version-order", entityId: issue.id, title: issue.title, provenance: null, relatedEntityId: firstWithOrder });
      else issueOrders.set(orderKey, issue.id);
    }
    return { documentRevision: document.revision, issueCount: document.issues.length, requirementCount: document.requirements.length, linkedRequirementCount: document.requirements.filter(item => linked.has(item.id)).length, totalFindings: findings.length, findings: boundedPage(findings, offset) };
  }
  /** Requirement and linked issues are limited to the authorized document and fixed revision. */
  async requirementDetail(projectId: string, documentId: string, revision: number, requirementId: string, offset: number): Promise<{ requirement: RequirementDetail; page: Page<IssueSummary> }> {
    const { document, issues } = await this.load(projectId, documentId, revision);
    const item = document.requirements.find(entry => entry.id === requirementId);
    if (!item) throw new IssueStoreError("NOT_FOUND", "이 문서의 요구사항을 찾을 수 없습니다.");
    const states = new Map(issues.map(issue => [issue.issueId, issue]));
    const categories = new Map(document.categories.map(category => [category.id, category.title]));
    const linked = document.issues.filter(issue => issue.requirementIds.includes(requirementId)).sort(comparePlannedIssues);
    const requirement: RequirementDetail = { id: item.id, text: item.text, origin: item.origin, sourceName: item.sourceId ? document.sources.find(source => source.id === item.sourceId)?.name ?? null : null, locator: item.locator ?? null, category: item.categoryId ? categories.get(item.categoryId) ?? null : null, linkedIssueCount: linked.length };
    const summaries = linked.map(issue => {
      const state = states.get(issue.id);
      if (!state) throw new IssueStoreError("STORAGE_FAILED", "연결된 이슈의 저장 상태를 확인할 수 없습니다.");
      return { id: issue.id, title: issue.title, version: issue.version, category: issue.categoryId ? categories.get(issue.categoryId) ?? null : null, localStatus: state.localStatus, importedStatus: state.importedStatus, missingCriteria: issue.acceptanceCriteria.length === 0, unverifiedDependencies: issue.dependencyIds.length };
    });
    return { requirement, page: boundedPage(summaries, offset, 1024 + Buffer.byteLength(JSON.stringify(requirement))) };
  }
  async list(projectId: string, documentId: string, revision: number, offset: number, filters: IssueFilters = {}): Promise<Page<IssueSummary>> {
    const { document, issues } = await this.load(projectId, documentId, revision);
    const status = new Map(issues.map(issue => [issue.issueId, issue]));
    const categories = new Map(document.categories.map(category => [category.id, category.title]));
    let subtree: Set<string> | undefined;
    if (typeof filters.categoryId === "string") {
      if (!categories.has(filters.categoryId)) throw new IssueStoreError("NOT_FOUND", "이 문서의 분류를 찾을 수 없습니다.");
      const children = new Map<string, string[]>();
      for (const category of document.categories) if (category.parentId) { const entries = children.get(category.parentId) ?? []; entries.push(category.id); children.set(category.parentId, entries); }
      subtree = new Set([filters.categoryId]); const queue = [filters.categoryId];
      for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) ?? []) if (!subtree.has(child)) { subtree.add(child); queue.push(child); }
    }
    const search = filters.search === undefined ? undefined : searchKey(filters.search.trim()), version = filters.version ? normalizeVersion(filters.version) : undefined;
    const items = [...document.issues].sort(comparePlannedIssues).filter(issue => {
      const category = issue.categoryId ? categories.get(issue.categoryId) ?? "" : "";
      return (!filters.status || status.get(issue.id)?.localStatus === filters.status)
        && (filters.categoryId === undefined || filters.categoryId === null && issue.categoryId === null || typeof filters.categoryId === "string" && issue.categoryId !== null && subtree!.has(issue.categoryId))
        && (!version || normalizeVersion(issue.version) === version)
        && (!search || [issue.id, issue.title, issue.description, category].some(text => searchKey(text).includes(search)));
    }).map(issue => {
      const state = status.get(issue.id)!;
      // v2 has no locally verified completed state; imported completion is not evidence.
      return { id: issue.id, title: issue.title, version: issue.version, category: issue.categoryId ? categories.get(issue.categoryId) ?? null : null, localStatus: state.localStatus, importedStatus: state.importedStatus, missingCriteria: issue.acceptanceCriteria.length === 0, unverifiedDependencies: issue.dependencyIds.length };
    });
    return boundedPage(items, offset);
  }
  async detail(projectId: string, documentId: string, revision: number, issueId: string): Promise<IssueDetail> {
    const { document, issues } = await this.load(projectId, documentId, revision);
    const issue = document.issues.find(entry => entry.id === issueId), state = issues.find(entry => entry.issueId === issueId);
    if (!issue || !state) throw new IssueStoreError("NOT_FOUND", "이 문서의 이슈를 찾을 수 없습니다.");
    const result: IssueDetail = { id: issue.id, title: issue.title, version: issue.version, category: document.categories.find(category => category.id === issue.categoryId)?.title ?? null, localStatus: state.localStatus, importedStatus: state.importedStatus, missingCriteria: issue.acceptanceCriteria.length === 0, unverifiedDependencies: issue.dependencyIds.length, description: issue.description, criteriaCount: issue.acceptanceCriteria.length, requirementCount: issue.requirementIds.length, dependencyCount: issue.dependencyIds.length };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES) throw new IssueStoreError("LIMIT_EXCEEDED", "이슈 설명이 표시 크기 제한을 초과했습니다.");
    return result;
  }
  async criteria(projectId: string, documentId: string, revision: number, issueId: string, offset: number): Promise<Page<string>> {
    const { document } = await this.load(projectId, documentId, revision);
    const issue = document.issues.find(entry => entry.id === issueId);
    if (!issue) throw new IssueStoreError("NOT_FOUND", "이 문서의 이슈를 찾을 수 없습니다.");
    return boundedPage(issue.acceptanceCriteria, offset);
  }
  async requirements(projectId: string, documentId: string, revision: number, issueId: string, offset: number): Promise<Page<IssueRequirementView>> {
    const { document } = await this.load(projectId, documentId, revision);
    const issue = document.issues.find(entry => entry.id === issueId);
    if (!issue) throw new IssueStoreError("NOT_FOUND", "이 문서의 이슈를 찾을 수 없습니다.");
    const requirements = new Map(document.requirements.map(requirement => [requirement.id, requirement]));
    const sources = new Map(document.sources.map(source => [source.id, source.name]));
    return boundedPage(issue.requirementIds.map(id => {
      const requirement = requirements.get(id)!;
      return { id, text: requirement.text, origin: requirement.origin, sourceName: requirement.sourceId ? sources.get(requirement.sourceId) ?? null : null, locator: requirement.locator ?? null };
    }), offset);
  }
  async dependencies(projectId: string, documentId: string, revision: number, issueId: string, offset: number): Promise<Page<IssueDependencyView>> {
    const { document, issues } = await this.load(projectId, documentId, revision);
    const issue = document.issues.find(entry => entry.id === issueId);
    if (!issue) throw new IssueStoreError("NOT_FOUND", "이 문서의 이슈를 찾을 수 없습니다.");
    const byId = new Map(document.issues.map(entry => [entry.id, entry]));
    const states = new Map(issues.map(entry => [entry.issueId, entry]));
    return boundedPage(issue.dependencyIds.map(id => {
      const dependency = byId.get(id), state = states.get(id);
      if (!dependency || !state) throw new IssueStoreError("STORAGE_FAILED", "선행 이슈의 저장 상태를 확인할 수 없습니다.");
      return { id, title: dependency.title, localStatus: state.localStatus, importedStatus: state.importedStatus };
    }), offset);
  }
}
