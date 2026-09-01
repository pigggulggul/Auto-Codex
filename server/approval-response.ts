import type { ClientMessage } from "../shared/protocol.js";
import type { JsonObject } from "./codex-app-server.js";

export type ApprovalDecision = Extract<ClientMessage, { type: "approval.resolve" }>["decision"];
export type ApprovalProtocol = "modern" | "legacy" | "permission";

export function approvalResponse(
  protocol: ApprovalProtocol,
  decision: ApprovalDecision,
  requestedPermissions: JsonObject = {},
): JsonObject {
  if (protocol === "permission") {
    const accepted = decision === "accept" || decision === "acceptForSession";
    return {
      permissions: accepted ? requestedPermissions : {},
      scope: decision === "acceptForSession" ? "session" : "turn",
    };
  }
  if (protocol === "legacy") {
    const legacyDecision: Record<ApprovalDecision, string> = {
      accept: "approved",
      acceptForSession: "approved_for_session",
      decline: "denied",
      cancel: "abort",
    };
    return { decision: legacyDecision[decision] };
  }
  return { decision };
}
