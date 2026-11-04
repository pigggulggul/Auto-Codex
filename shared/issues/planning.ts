/** Resource limit for a single serialized version, not a product version ceiling. */
export const MAX_VERSION_LENGTH = 1024;

export class IssuePlanError extends Error {
  constructor(readonly code: "INVALID_VERSION" | "LIMIT_EXCEEDED", message: string) { super(message); }
}

export function normalizeVersion(input: string): string {
  if (input.length > MAX_VERSION_LENGTH) throw new IssuePlanError("LIMIT_EXCEEDED", "개발 버전 입력이 길이 제한을 초과했습니다.");
  if (!/^\d+\.\d+\.\d+$/.test(input)) throw new IssuePlanError("INVALID_VERSION", "개발 버전은 세 개의 음이 아닌 정수여야 합니다.");
  return input.split(".").map(part => part.replace(/^0+(?=\d)/, "")).join(".");
}

/** Compare decimal strings without number or BigInt precision/resource assumptions. */
export function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left).split("."), b = normalizeVersion(right).split(".");
  for (let index = 0; index < 3; index++) {
    if (a[index].length !== b[index].length) return a[index].length < b[index].length ? -1 : 1;
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export type PlannedIssue = { id: string; version: string; order: number; dependencyIds: readonly string[] };
export type PlanFinding = { code: "DUPLICATE_ID" | "INVALID_VERSION" | "LIMIT_EXCEEDED" | "INVALID_ORDER" | "MISSING_DEPENDENCY" | "DUPLICATE_DEPENDENCY" | "CYCLE" | "HIGHER_VERSION_DEPENDENCY"; issueId: string; dependencyId?: string };

/** Structural findings block execution; callers must not treat a partial result as a valid plan. */
export function validateIssuePlan(issues: readonly PlannedIssue[]): PlanFinding[] {
  const findings: PlanFinding[] = [], byId = new Map<string, PlannedIssue>();
  const validVersions = new Set<string>();
  for (const issue of issues) {
    if (byId.has(issue.id)) findings.push({ code: "DUPLICATE_ID", issueId: issue.id });
    else byId.set(issue.id, issue);
    try { normalizeVersion(issue.version); validVersions.add(issue.id); }
    catch (error) { findings.push({ code: error instanceof IssuePlanError ? error.code : "INVALID_VERSION", issueId: issue.id }); }
    if (!Number.isSafeInteger(issue.order) || issue.order < 0) findings.push({ code: "INVALID_ORDER", issueId: issue.id });
  }
  // Duplicate IDs make graph identity ambiguous: report the conflict without asserting graph validity.
  if (byId.size !== issues.length) return findings;
  const inDegree = new Map<string, number>(), dependants = new Map<string, string[]>();
  for (const issue of issues) { inDegree.set(issue.id, 0); dependants.set(issue.id, []); }
  for (const issue of issues) {
    const seen = new Set<string>();
    for (const dependencyId of issue.dependencyIds) {
      if (seen.has(dependencyId)) { findings.push({ code: "DUPLICATE_DEPENDENCY", issueId: issue.id, dependencyId }); continue; }
      seen.add(dependencyId);
      const dependency = byId.get(dependencyId);
      if (!dependency) { findings.push({ code: "MISSING_DEPENDENCY", issueId: issue.id, dependencyId }); continue; }
      inDegree.set(issue.id, inDegree.get(issue.id)! + 1);
      dependants.get(dependencyId)!.push(issue.id);
      if (validVersions.has(issue.id) && validVersions.has(dependencyId) && compareVersions(dependency.version, issue.version) > 0) findings.push({ code: "HIGHER_VERSION_DEPENDENCY", issueId: issue.id, dependencyId });
    }
  }
  const queue = issues.filter(issue => inDegree.get(issue.id) === 0).map(issue => issue.id);
  for (let index = 0; index < queue.length; index++) for (const id of dependants.get(queue[index])!) {
    const remaining = inDegree.get(id)! - 1; inDegree.set(id, remaining); if (remaining === 0) queue.push(id);
  }
  // Follow remaining edges until one repeats; downstream blocked nodes are not cycle members.
  if (queue.length !== issues.length) {
    let id = issues.find(issue => inDegree.get(issue.id)! > 0)!.id;
    const visited = new Set<string>();
    while (!visited.has(id)) {
      visited.add(id);
      id = byId.get(id)!.dependencyIds.find(dependencyId => (inDegree.get(dependencyId) ?? 0) > 0)!;
    }
    findings.push({ code: "CYCLE", issueId: id });
  }
  return findings;
}

export function comparePlannedIssues(a: PlannedIssue, b: PlannedIssue): number {
  const version = compareVersions(a.version, b.version);
  if (version) return version;
  if (!Number.isSafeInteger(a.order) || a.order < 0 || !Number.isSafeInteger(b.order) || b.order < 0) throw new Error("INVALID_ORDER");
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
