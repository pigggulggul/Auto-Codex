export type PetState =
  | "idle"
  | "connecting"
  | "thinking"
  | "reading"
  | "editing"
  | "running"
  | "waitingApproval"
  | "success"
  | "error";

export type SkillRole =
  | "general"
  | "builder"
  | "researcher"
  | "documenter"
  | "visual"
  | "qa"
  | "integrator";

export type SkillInfo = {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  scope?: string;
  enabled: boolean;
};

export type ActivityEvent = {
  id: string;
  state: PetState;
  title: string;
  detail?: string;
  source: string;
  timestamp: string;
};

export type ApprovalKind = "command" | "file" | "permission";

export type ApprovalRequest = {
  approvalId: string;
  kind: ApprovalKind;
  title: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
};

export type BridgeSnapshot = {
  connected: boolean;
  appServerReady: boolean;
  projectPath: string | null;
  threadId: string | null;
  turnId: string | null;
  petState: PetState;
  selectedSkill: SkillInfo | null;
  activeRole: SkillRole;
  projectTrust: "trusted" | "untrusted";
};

export type ClientMessage =
  | { type: "project.select"; path: string }
  | { type: "project.pick" }
  | { type: "project.trust" }
  | { type: "skills.refresh" }
  | {
      type: "turn.start";
      prompt: string;
      skillMode: "auto" | "manual";
      skillPath?: string;
    }
  | { type: "turn.interrupt" }
  | {
      type: "approval.resolve";
      approvalId: string;
      decision: "accept" | "acceptForSession" | "decline" | "cancel";
    };

export type ServerMessage =
  | { type: "bridge.state"; snapshot: BridgeSnapshot }
  | { type: "project.picker"; status: "opened" | "cancelled" }
  | { type: "project.selected"; path: string }
  | { type: "project.trust"; path: string; status: "trusted" | "untrusted" }
  | { type: "skills.list"; skills: SkillInfo[]; errors: string[] }
  | {
      type: "skill.selected";
      skill: SkillInfo | null;
      mode: "auto" | "manual";
      role: SkillRole;
      rationale: string;
    }
  | { type: "turn.state"; turnId: string | null; status: string }
  | { type: "assistant.text"; text: string }
  | { type: "activity.event"; event: ActivityEvent }
  | { type: "approval.request"; approval: ApprovalRequest }
  | { type: "approval.resolved"; approvalId: string }
  | { type: "protocol.event"; method: string }
  | { type: "error"; message: string; recoverable: boolean };
