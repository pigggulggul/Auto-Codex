import { describe, expect, it } from "vitest";
import { comparePlannedIssues, compareVersions, MAX_VERSION_LENGTH, normalizeVersion, validateIssuePlan, type PlannedIssue } from "./planning.js";

const issue = (id: string, version = "1.0.0", dependencyIds: string[] = [], order = 0): PlannedIssue => ({ id, version, dependencyIds, order });

describe("issue plan rules", () => {
  it("compares and normalizes arbitrary precision decimal components", () => {
    expect(normalizeVersion("0001.00.003")).toBe("1.0.3");
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("9.99.99", "10.0.0")).toBeLessThan(0);
    expect(compareVersions("900719925474099312345.0.0", "900719925474099312346.0.0")).toBeLessThan(0);
    expect(compareVersions("01.2.0", "1.02.00")).toBe(0);
    expect(() => normalizeVersion("1.-2.3")).toThrow();
    expect(() => normalizeVersion("1".repeat(MAX_VERSION_LENGTH + 1))).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
  it("uses numeric version then order and stable ID", () => {
    expect([issue("b", "1.10.0"), issue("c", "1.2.0"), issue("a", "01.02.0")].sort(comparePlannedIssues).map(i => i.id)).toEqual(["a", "c", "b"]);
  });
  it("detects missing, duplicate, higher-version and cyclic dependencies", () => {
    const findings = validateIssuePlan([issue("a", "1.0.0", ["b", "missing", "b"]), issue("b", "2.0.0", ["a"])]);
    expect(findings.map(f => f.code)).toEqual(expect.arrayContaining(["MISSING_DEPENDENCY", "DUPLICATE_DEPENDENCY", "HIGHER_VERSION_DEPENDENCY", "CYCLE"]));
    expect(validateIssuePlan([issue("self", "1.0.0", ["self"])])).toContainEqual({ code: "CYCLE", issueId: "self" });
  });
  it("rejects ambiguous IDs and accepts a valid dependency chain", () => {
    expect(validateIssuePlan([issue("a"), issue("a")])).toContainEqual({ code: "DUPLICATE_ID", issueId: "a" });
    expect(validateIssuePlan([issue("a"), issue("b", "1.1.0", ["a"])])).toEqual([]);
  });
});
