import { describe, expect, it } from "vitest";
import { approvalResponse } from "./approval-response.js";

describe("approvalResponse", () => {
  it("grants exactly the App Server permission request", () => {
    const requested = { network: { enabled: true }, fileSystem: { write: ["C:/project"] } };
    expect(approvalResponse("permission", "acceptForSession", requested)).toEqual({
      permissions: requested,
      scope: "session",
    });
  });

  it("returns no permissions when a permission request is declined", () => {
    expect(approvalResponse("permission", "decline", { network: { enabled: true } })).toEqual({
      permissions: {},
      scope: "turn",
    });
  });

  it("maps legacy decisions without changing modern decisions", () => {
    expect(approvalResponse("legacy", "cancel")).toEqual({ decision: "abort" });
    expect(approvalResponse("modern", "decline")).toEqual({ decision: "decline" });
  });
});
