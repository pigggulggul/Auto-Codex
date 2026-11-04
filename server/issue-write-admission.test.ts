import { describe, expect, it } from "vitest";
import { IssueWriteAdmission } from "./issue-write-admission.js";

describe("issue export admission", () => {
  it("atomically excludes other reservations and respects existing work", () => {
    const admission = new IssueWriteAdmission();
    expect(admission.tryAcquire(() => true)).toBeNull(); expect(admission.busy).toBe(false);
    const release = admission.tryAcquire(() => false)!;
    expect(admission.busy).toBe(true); expect(admission.tryAcquire(() => false)).toBeNull();
    release(); expect(admission.busy).toBe(false);
    const second = admission.tryAcquire(() => false)!;
    release(); expect(admission.busy).toBe(true); // An old release cannot clear a newer reservation.
    second(); expect(admission.busy).toBe(false);
  });
});
