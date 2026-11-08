import { describe, expect, it } from "vitest";
import { AnalysisApprovalOwners } from "./analysis-approval-owners.js";

describe("analysis approval ownership", () => {
  it("binds each pending request to its live owner and thread", () => {
    const owners = new AnalysisApprovalOwners(), first = new AbortController(), other = new AbortController();
    expect(owners.add("request", first.signal, "thread")).toBe(true);
    expect(owners.add("request", other.signal, "other")).toBe(false);
    expect(owners.owns("request", first.signal)).toBe(true);
    expect(owners.owns("request", other.signal)).toBe(false);
    expect(owners.belongsTo("request", first.signal, "thread")).toBe(true);
    expect(owners.belongsTo("request", first.signal, "other")).toBe(false);
    first.abort(); expect(owners.owns("request", first.signal)).toBe(false);
    expect(owners.belongsTo("request", first.signal, "thread")).toBe(true);
    owners.remove("request"); expect(owners.has("request")).toBe(false);
    expect(owners.add("late", first.signal, "thread")).toBe(false);
  });
  it("bounds retained approvals and accepts another after removal", () => {
    const owners = new AnalysisApprovalOwners(), owner = new AbortController();
    for (let i = 0; i < 128; i++) expect(owners.add(`request-${i}`, owner.signal, "thread")).toBe(true);
    expect(owners.add("overflow", owner.signal, "thread")).toBe(false);
    owners.remove("request-0"); expect(owners.add("replacement", owner.signal, "thread")).toBe(true);
  });
});
