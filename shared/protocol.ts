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

export type AgentRole = "coordinator" | SkillRole;

export type ExecutionMode = "solo" | "team";

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export type ModelInfo = {
  id: string;
  model: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort;
    description?: string;
  }>;
  inputModalities: string[];
  supportsPersonality: boolean;
};

export type RunStatus =
  | "planning"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "interrupted";

export type TaskStatus =
  | "queued"
  | "ready"
  | "running"
  | "waitingApproval"
  | "completed"
  | "failed"
  | "blocked"
  | "interrupted";

export type AgentStatus = "idle" | "ready" | "working" | "waitingApproval" | "completed" | "error";

export type TaskAccess = "read" | "write";

export type TaskKind =
  | "coordinate"
  | "research"
  | "design"
  | "implementation"
  | "verification"
  | "integration"
  | "report";

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
  runId?: string;
  taskId?: string;
  agentId?: string;
  threadId?: string;
  turnId?: string;
};

export type TokenUsageEntry = {
  turnId: string;
  totalTokens: number;
  timestamp: string;
};

export type TokenUsageSummary = {
  today: number;
  week: number;
  lastTurn: number;
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
  runId?: string;
  taskId?: string;
  agentId?: string;
  threadId?: string;
  turnId?: string;
  requestedPermissions?: {
    network: boolean;
    readPaths: string[];
    writePaths: string[];
  };
};

export type TaskDefinition = {
  id: string;
  title: string;
  description: string;
  kind: TaskKind;
  access: TaskAccess;
  agentRole: AgentRole;
  dependsOn: string[];
  order: number;
  skillPath?: string;
  runAfterFailure?: boolean;
};

export type TaskNode = TaskDefinition & {
  agentId: string;
  status: TaskStatus;
  attempt: number;
  threadId: string | null;
  turnId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary?: string;
  error?: string;
};

export type AgentSnapshot = {
  id: string;
  role: AgentRole;
  name: string;
  status: AgentStatus;
  activity: PetState;
  taskIds: string[];
  currentTaskId: string | null;
  threadId: string | null;
  turnId: string | null;
};

export type RunSnapshot = {
  id: string;
  prompt: string;
  mode: ExecutionMode;
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
  tasks: TaskNode[];
  agents: AgentSnapshot[];
  summary?: string;
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
  activeModel: string | null;
  activeEffort: ReasoningEffort | null;
  projectTrust: "trusted" | "untrusted";
  activeRun: RunSnapshot | null;
};

export type ClientMessage =
  | { type: "project.select"; path: string }
  | { type: "project.pick" }
  | { type: "project.trust" }
  | { type: "skills.refresh" }
  | { type: "models.refresh" }
  | {
      type: "turn.start";
      prompt: string;
      skillMode: "auto" | "manual";
      skillPath?: string;
      executionMode?: ExecutionMode;
      model?: string;
      effort?: ReasoningEffort;
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
  | { type: "models.list"; models: ModelInfo[]; errors: string[] }
  | {
      type: "skill.selected";
      skill: SkillInfo | null;
      mode: "auto" | "manual";
      role: SkillRole;
      rationale: string;
    }
  | {
      type: "turn.state";
      turnId: string | null;
      status: string;
      runId?: string;
      taskId?: string;
      agentId?: string;
      threadId?: string;
    }
  | { type: "run.state"; run: RunSnapshot | null }
  | {
      type: "assistant.text";
      text: string;
      runId?: string;
      taskId?: string;
      agentId?: string;
      threadId?: string;
      turnId?: string;
    }
  | { type: "activity.event"; event: ActivityEvent }
  | { type: "token.usage"; usage: TokenUsageEntry }
  | { type: "approval.request"; approval: ApprovalRequest }
  | { type: "approval.resolved"; approvalId: string }
  | { type: "protocol.event"; method: string }
  | { type: "error"; message: string; recoverable: boolean };
