import { randomUUID } from "node:crypto";
import {titleFromPrompt} from '../shared/conversation-title.js';
import { spawn } from "node:child_process";
import { realpath, stat, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type {
  ActivityEvent,
  ApprovalRequest,
  BridgeSnapshot,
  ClientMessage,
  ModelInfo,
  PetState,
  ReasoningEffort,
  RunSnapshot,
  ServerMessage,
  SkillInfo,
  TaskDefinition,
  TaskNode,
  WorkspaceMode,
  ConversationState,
} from "../shared/protocol.js";
import { mapNotification } from "./activity-mapper.js";
import {
  CodexAppServer,
  type JsonObject,
  type ProtocolNotification,
  type ProtocolServerRequest,
} from "./codex-app-server.js";
import { routeSkill } from "./skill-router.js";
import { pickProjectDirectory } from "./folder-picker.js";
import { readProjectTrust, trustProject, type ProjectTrust } from "./project-trust.js";
import { classifySkill, SKILL_ROLE_LABELS } from "../shared/skill-catalog.js";
import { RuntimeRegistry, type RuntimeContext } from "./runtime-registry.js";
import {
  createRunSnapshot,
  interruptRun,
  selectStartableTaskIds,
  transitionTask,
  updateAgentActivity,
  updateTask,
} from "./orchestration.js";
import { fallbackTaskPlan, parseTaskPlan, TASK_PLAN_OUTPUT_SCHEMA } from "./task-planner.js";
import { parseClientMessage } from "./client-message.js";
import { approvalResponse, type ApprovalProtocol } from "./approval-response.js";
import { parseTokenUsage } from "./token-usage.js";
import { ConversationStore, type ConversationRecord } from "./conversation-store.js";
import { AtelierClient } from "./atelier/client.js";
import {AtelierProposalRuntime} from "./atelier/proposal-runtime.js";
import {AtelierExecutionRuntime} from "./atelier/execution-runtime.js";
import {check as atelierCheck} from "./atelier/errors.js";
import {defaultModel} from '../shared/model-selection.js';

const HOST = "127.0.0.1";
const PORT = Number(process.env.AUTO_CODEX_PORT || 4781);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PARENT = path.dirname(MODULE_DIR);
const ROOT = path.basename(MODULE_PARENT) === "build-server" ? path.resolve(MODULE_DIR, "../..") : MODULE_PARENT;
const DIST = path.join(ROOT, "dist");
const SERVE_UI = process.argv.includes("--serve");
const OPEN_UI = process.argv.includes("--open");
const atelier = new AtelierClient(ROOT, (event) => {
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
});

type RequestId = number | string;

type PendingApproval = {
  requestId: RequestId;
  method: string;
  legacy: boolean;
  approval: ApprovalRequest;
  requestedPermissions?: JsonObject;
};

type SkillsListResponse = {
  data?: Array<{
    cwd?: string;
    skills?: Array<{
      name?: string;
      description?: string;
      shortDescription?: string;
      path?: string;
      scope?: string;
      enabled?: boolean;
    }>;
    errors?: unknown[];
  }>;
};

type ThreadStartResponse = { thread?: { id?: string } };
type TurnStartResponse = { turn?: { id?: string } };

type ModelListResponse = {
  data?: Array<{
    id?: string;
    model?: string;
    displayName?: string;
    hidden?: boolean;
    isDefault?: boolean;
    defaultReasoningEffort?: string;
    supportedReasoningEfforts?: Array<{
      reasoningEffort?: string;
      description?: string;
    }>;
    inputModalities?: string[];
    supportsPersonality?: boolean;
  }>;
};

const appServer = new CodexAppServer();
const sockets = new Set<WebSocket>();
const pendingApprovals = new Map<string, PendingApproval>();
const runtimeRegistry = new RuntimeRegistry();
const taskAssistantText = new Map<string, string>();

let appServerReady = false;
let projectPath: string | null = null;
let workspaceMode: WorkspaceMode = "project";
let researchNetworkAccess = false;
let skills: SkillInfo[] = [];
let models: ModelInfo[] = [];
let threadId: string | null = null;
let turnId: string | null = null;
const completedSoloTurns=new Set<string>();
let assistantText = "";
let projectTrust: ProjectTrust = "untrusted";
let petState: PetState = "connecting";
let startupCliError: string | null = null;
let selectedSkill: SkillInfo | null = null;
let activeRole: NonNullable<BridgeSnapshot["activeRole"]> = "general";
let activeModel: string | null = null;
let activeEffort: ReasoningEffort | null = null;
let lastActivity: ActivityEvent | null = null;
let activities: ActivityEvent[] = [];
let activeRun: RunSnapshot | null = null;
let teamSchedulerBusy = false;

function createConversation(title = "새 대화"): ConversationRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    preview: "",
    messageCount: 0,
    projectPath,
    workspaceMode,
    threadId: null,
    assistantText: "",
    taskOutputs: {},
    activities: [],
    activeRun: null,
    contextSummary: "",
    messages: [],
  };
}

const conversations = new Map<string, ConversationRecord>();
const initialConversation = createConversation();
conversations.set(initialConversation.id, initialConversation);
let activeConversationId = initialConversation.id;
const conversationStore = new ConversationStore(ROOT);
let historyError: string | null = null;
let historyWritable = true;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let renameSave:Promise<void>|null=null;
const loadedThreads = new Set<string>();

function persistConversations(): void {
  if (!historyWritable || saveTimer || renameSave) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveConversations().catch(() => {
      historyError = "대화 기록을 저장하지 못했습니다. 로컬 저장 공간과 권한을 확인하세요.";
      broadcastError(historyError);
    });
  }, 200);
}

function saveConversations(): Promise<void> {
  if(renameSave)return renameSave.catch(()=>{}).then(()=>conversationStore.save({version:1,activeConversationId,conversations:[...conversations.values()]}));
  return conversationStore.save({ version: 1, activeConversationId, conversations: [...conversations.values()] });
}

const ACTIVE_RUN_STATUSES = new Set(["planning", "running", "verifying"]);
const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
]);

function snapshot(connected = true): BridgeSnapshot {
  const summaries = [...conversations.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(({ id, title, createdAt, updatedAt, preview, messageCount, projectPath, workspaceMode }) => ({
      id,
      title,
      createdAt,
      updatedAt,
      preview,
      messageCount,
      projectPath,
      workspaceMode,
    }));
  return {
    connected,
    appServerReady,
    projectPath,
    workspaceMode,
    researchNetworkAccess,
    threadId,
    turnId,
    petState,
    selectedSkill,
    activeRole,
    activeModel,
    activeEffort,
    projectTrust,
    activeRun,
    activeConversationId,
    conversations: summaries,
  };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage): void {
  executionRuntime.observe(message);
  for (const socket of sockets) send(socket, message);
}

function broadcastState(): void {
  persistConversations();
  broadcast({ type: "bridge.state", snapshot: snapshot() });
}

function activeConversation(): ConversationRecord {
  const conversation = conversations.get(activeConversationId);
  if (!conversation) throw new Error("현재 대화를 찾을 수 없습니다.");
  return conversation;
}

function syncActiveConversation(): void {
  const conversation = activeConversation();
  conversation.threadId = threadId;
  conversation.assistantText = assistantText;
  conversation.taskOutputs = Object.fromEntries(taskAssistantText.entries());
  conversation.activities = activities;
  conversation.activeRun = activeRun;
  const reply = conversation.messages.at(-1);
  if (reply?.role === "assistant" && reply.status === "streaming") {
    reply.text = assistantText;
    reply.run = activeRun;
    reply.taskOutputs = { ...conversation.taskOutputs };
  }
  persistConversations();
}

function conversationState(): ConversationState {
  const conversation = activeConversation();
  syncActiveConversation();
  return {
    id: conversation.id,
    messages: conversation.messages,
    assistantText: conversation.assistantText,
    taskOutputs: conversation.taskOutputs,
    activities: conversation.activities,
    activeRun: conversation.activeRun,
  };
}

function broadcastConversationState(): void {
  broadcast({ type: "conversation.state", state: conversationState() });
  broadcastState();
}

function updateConversationPreview(value: string): void {
  const conversation = activeConversation();
  const preview = value.replace(/\s+/g, " ").trim();
  if (preview) conversation.preview = preview.slice(0, 140);
  conversation.updatedAt = new Date().toISOString();
}

function resetActiveConversationRuntime(): void {
  threadId = null;
  turnId = null;
  assistantText = "";
  activities = [];
  lastActivity = null;
  activeRun = null;
  petState = "idle";
  runtimeRegistry.clear();
  taskAssistantText.clear();
}

function restoreWorkspaceConversation(): void {
  const previous = [...conversations.values()].filter((entry) => entry.projectPath === projectPath && entry.workspaceMode === workspaceMode)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const conversation = previous ?? createConversation();
  conversations.set(conversation.id, conversation);
  activeConversationId = conversation.id;
  resetActiveConversationRuntime();
  restoreConversationRuntime(conversation);
}

function startConversationPrompt(prompt: string): void {
  const conversation = activeConversation();
  if (conversation.title === "새 대화"&&conversation.titleSource!=='user') {conversation.title = titleFromPrompt(prompt);conversation.titleSource='prompt';}
  conversation.preview = prompt.replace(/\s+/g, " ").trim().slice(0, 140);
  conversation.messageCount += 1;
  conversation.updatedAt = new Date().toISOString();
  conversation.messages.push(
    { id: randomUUID(), role: "user", text: prompt, timestamp: conversation.updatedAt, status: "completed" },
    { id: randomUUID(), role: "assistant", text: "", timestamp: conversation.updatedAt, status: "streaming" },
  );
}

function completeConversationReply(status: "completed" | "failed" | "interrupted"): void {
  const reply = activeConversation().messages.at(-1);
  if (reply?.role === "assistant" && reply.status === "streaming") {
    reply.text = assistantText;
    reply.status = status;
  }
  persistConversations();
}

function conversationContext(): string {
  if(executionRuntime.busy)return '';
  const history = activeConversation().messages.slice(0, -2);
  return history.map((message) => `${message.role === "user" ? "사용자 요청" : "이전 응답"} (${message.status}):\n${message.text}`).join("\n\n").slice(-16_000)
    || activeConversation().contextSummary;
}

function newConversation(): void {
  if (turnId || runIsActive()) throw new Error("진행 중인 작업을 마친 뒤 새 대화를 만들 수 있습니다.");
  syncActiveConversation();
  const conversation = createConversation();
  conversations.set(conversation.id, conversation);
  activeConversationId = conversation.id;
  resetActiveConversationRuntime();
  broadcastConversationState();
}

function restoreConversationRuntime(conversation: ConversationRecord): void {
  threadId = conversation.threadId;
  turnId = null;
  assistantText = conversation.assistantText;
  activeRun = conversation.activeRun;
  activities = conversation.activities;
  lastActivity = activities[0] ?? null;
  petState = "idle";
  runtimeRegistry.clear();
  taskAssistantText.clear();
  for (const [taskId, text] of Object.entries(conversation.taskOutputs)) taskAssistantText.set(taskId, text);
}

async function validateProject(inputPath: string): Promise<string> {
  const resolved = await realpath(path.resolve(inputPath.trim()));
  if (!(await stat(resolved)).isDirectory()) throw new Error("프로젝트 경로는 폴더여야 합니다.");
  return resolved;
}

async function selectConversation(conversationId: string): Promise<void> {
  if (turnId || runIsActive()) throw new Error("진행 중인 작업을 마친 뒤 대화를 바꿀 수 있습니다.");
  const conversation = conversations.get(conversationId);
  if (!conversation) throw new Error("선택한 대화를 찾을 수 없습니다.");
  if (conversationId === activeConversationId) return;
  let restoredPath: string | null = null;
  let missingProject = false;
  if (conversation.projectPath) {
    try { restoredPath = await validateProject(conversation.projectPath); }
    catch { missingProject = true; }
  }
  syncActiveConversation();
  activeConversationId = conversationId;
  projectPath = restoredPath;
  workspaceMode = conversation.workspaceMode;
  researchNetworkAccess = false;
  projectTrust = restoredPath ? await readProjectTrust(restoredPath) : "untrusted";
  selectedSkill = null;
  activeRole = "general";
  skills = [];
  restoreConversationRuntime(conversation);
  broadcastConversationState();
  if (missingProject) {
    broadcast({ type: "skills.list", skills: [], errors: [] });
    broadcastError("이 대화의 프로젝트 폴더를 찾을 수 없습니다. 기록은 열람할 수 있으며, 작업하려면 폴더를 다시 연결하세요.");
    return;
  }
  await loadSkills(true);
}

function runIsActive(): boolean {
  return activeRun !== null && ACTIVE_RUN_STATUSES.has(activeRun.status);
}

function publishRun(run: RunSnapshot | null): void {
  activeRun = run;
  syncActiveConversation();
  broadcast({ type: "run.state", run });
  broadcastState();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromValue).join("");
  if (!value || typeof value !== "object") return "";
  const object = value as JsonObject;
  if (typeof object.text === "string") return object.text;
  if ("content" in object) return textFromValue(object.content);
  return "";
}

function completedAgentMessageText(params?: JsonObject): string {
  const item = params?.item;
  if (!item || typeof item !== "object") return "";
  const object = item as JsonObject;
  if (object.type !== "agentMessage") return "";
  return textFromValue(object.content ?? object.text ?? object.message);
}

function broadcastError(error: unknown, recoverable = true): void {
  broadcast({ type: "error", message: errorMessage(error), recoverable });
}

function publishActivity(activity: ActivityEvent): void {
  const duplicate =
    lastActivity &&
    lastActivity.source === activity.source &&
    lastActivity.title === activity.title &&
    lastActivity.taskId === activity.taskId &&
    Date.now() - Date.parse(lastActivity.timestamp) < 1_200;
  petState = activity.state;
  if (!duplicate) {
    lastActivity = activity;
    activities = [activity, ...activities].slice(0, 40);
    syncActiveConversation();
    broadcast({ type: "activity.event", event: activity });
  }
  broadcastState();
}

function contextFields(context: RuntimeContext | null): Pick<ActivityEvent, "runId" | "taskId" | "agentId" | "threadId" | "turnId"> {
  if (!context) return {};
  return {
    runId: context.runId,
    taskId: context.taskId,
    agentId: context.agentId,
    threadId: context.threadId,
    turnId: context.turnId ?? undefined,
  };
}

function requestContextFields(params: JsonObject): Pick<ApprovalRequest, "runId" | "taskId" | "agentId" | "threadId" | "turnId"> {
  const context = runtimeRegistry.resolve(params);
  if (context) return contextFields(context);
  return {
    threadId: typeof params.threadId === "string" ? params.threadId : undefined,
    turnId: typeof params.turnId === "string" ? params.turnId : undefined,
  };
}

function localActivity(state: PetState, title: string, detail?: string, context: RuntimeContext | null = null): ActivityEvent {
  return {
    id: randomUUID(),
    state,
    title,
    detail,
    source: "bridge",
    timestamp: new Date().toISOString(),
    ...contextFields(context),
  };
}

async function ensureAppServer(): Promise<void> {
  if (appServerReady) return;
  petState = "connecting";
  broadcastState();
  await appServer.start();
  appServerReady = true;
  petState = "idle";
  broadcastState();
}

function normalizeSkill(raw: NonNullable<NonNullable<SkillsListResponse["data"]>[number]["skills"]>[number]): SkillInfo | null {
  if (!raw.name || !raw.path) return null;
  return {
    name: raw.name,
    description: raw.description || raw.shortDescription || "설명이 없는 스킬",
    shortDescription: raw.shortDescription,
    path: raw.path,
    scope: raw.scope,
    enabled: raw.enabled !== false,
  };
}

function normalizeModel(raw: NonNullable<ModelListResponse["data"]>[number]): ModelInfo | null {
  const model = raw.model?.trim() || raw.id?.trim();
  if (!model) return null;
  const supportedReasoningEfforts = (raw.supportedReasoningEfforts ?? [])
    .filter((entry): entry is { reasoningEffort: ReasoningEffort; description?: string } =>
      typeof entry.reasoningEffort === "string" && REASONING_EFFORTS.has(entry.reasoningEffort as ReasoningEffort))
    .map((entry) => ({ reasoningEffort: entry.reasoningEffort, description: entry.description }));
  const defaultReasoningEffort = typeof raw.defaultReasoningEffort === "string"
    && REASONING_EFFORTS.has(raw.defaultReasoningEffort as ReasoningEffort)
    ? raw.defaultReasoningEffort as ReasoningEffort
    : undefined;
  return {
    id: raw.id?.trim() || model,
    model,
    displayName: raw.displayName?.trim() || model,
    hidden: raw.hidden === true,
    isDefault: raw.isDefault === true,
    defaultReasoningEffort,
    supportedReasoningEfforts,
    inputModalities: Array.isArray(raw.inputModalities) ? raw.inputModalities.filter((value): value is string => typeof value === "string") : ["text", "image"],
    supportsPersonality: raw.supportsPersonality === true,
  };
}

async function loadModels(): Promise<void> {
  await ensureAppServer();
  const response = await appServer.request<ModelListResponse>("model/list", { limit: 50, includeHidden: false });
  models = (response.data ?? [])
    .map(normalizeModel)
    .filter((model): model is ModelInfo => model !== null && !model.hidden);
  broadcast({ type: "models.list", models, errors: [] });
}

function describeSkillError(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const object = value as JsonObject;
    if (typeof object.message === "string") return object.message;
    if (typeof object.path === "string") return `스킬 로드 실패: ${object.path}`;
  }
  return "알 수 없는 스킬 로드 오류";
}

async function loadSkills(forceReload = true): Promise<void> {
  if (!projectPath || workspaceMode === "research") {
    skills = [];
    broadcast({ type: "skills.list", skills, errors: [] });
    return;
  }
  await ensureAppServer();
  const response = await appServer.request<SkillsListResponse>("skills/list", {
    cwds: [projectPath],
    forceReload,
  });
  const entries = response.data ?? [];
  skills = entries.flatMap((entry) => (entry.skills ?? []).map(normalizeSkill).filter((skill): skill is SkillInfo => skill !== null));
  const errors = entries.flatMap((entry) => (entry.errors ?? []).map(describeSkillError));
  broadcast({ type: "skills.list", skills, errors });
}

async function selectProject(inputPath: string): Promise<void> {
  if (turnId || runIsActive()) throw new Error("진행 중인 작업을 중단한 뒤 프로젝트를 바꿔주세요.");
  const resolved = await validateProject(inputPath);
  syncActiveConversation();
  projectPath = resolved;
  workspaceMode = "project";
  projectTrust = await readProjectTrust(resolved);
  restoreWorkspaceConversation();
  selectedSkill = null;
  activeRole = "general";
  skills = [];
  broadcast({ type: "project.selected", path: resolved });
  broadcastConversationState();
  await loadSkills(true);
  publishActivity(localActivity("idle", "프로젝트를 불러왔습니다", path.basename(resolved)));
}

async function setWorkspaceMode(mode: WorkspaceMode): Promise<void> {
  if (turnId || runIsActive()) throw new Error("진행 중인 작업을 중단한 뒤 사용 모드를 바꿔주세요.");
  if (mode === workspaceMode) return;
  syncActiveConversation();
  workspaceMode = mode;
  if (mode === "research") {
    projectPath = null;
    projectTrust = "untrusted";
    researchNetworkAccess = false;
    skills = [];
    restoreWorkspaceConversation();
    await ensureAppServer();
    broadcast({ type: "skills.list", skills, errors: [] });
    broadcastConversationState();
    publishActivity(localActivity("idle", "조사 모드로 전환했습니다", "폴더 연결 없이 웹·시장 정보를 확인할 수 있습니다."));
    return;
  }
  restoreWorkspaceConversation();
  broadcastConversationState();
  broadcast({ type: "skills.list", skills, errors: [] });
  publishActivity(localActivity("idle", "프로젝트 모드로 전환했습니다", "폴더를 연결하면 파일 작업을 사용할 수 있습니다."));
}

function setResearchNetworkAccess(enabled: boolean): void {
  if (workspaceMode !== "research") throw new Error("웹 접근 설정은 조사 모드에서만 사용할 수 있습니다.");
  researchNetworkAccess = enabled;
  broadcastState();
}

async function trustCurrentProject(): Promise<void> {
  if (!projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
  if (turnId || runIsActive()) throw new Error("진행 중인 작업을 중단한 뒤 프로젝트를 신뢰하세요.");
  await trustProject(projectPath);
  projectTrust = "trusted";
  syncActiveConversation();
  selectedSkill = null;
  activeRole = "general";
  appServerReady = false;
  petState = "connecting";
  broadcast({ type: "project.trust", path: projectPath, status: projectTrust });
  broadcastState();
  appServer.stop();
  await ensureAppServer();
  await loadModels();
}

async function pickAndSelectProject(socket: WebSocket): Promise<void> {
  if (turnId || runIsActive()) throw new Error("진행 중인 작업을 중단한 뒤 프로젝트를 바꿔주세요.");
  send(socket, { type: "project.picker", status: "opened" });
  const selectedPath = await pickProjectDirectory();
  if (!selectedPath) {
    send(socket, { type: "project.picker", status: "cancelled" });
    return;
  }
  await selectProject(selectedPath);
}

async function ensureThread(): Promise<string> {
  if (threadId && loadedThreads.has(threadId)) return threadId;
  if (workspaceMode === "project" && !projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
  const params: JsonObject = {
    approvalPolicy: "on-request",
    sandbox: workspaceMode === "research" ? "read-only" : "workspace-write",
    experimentalRawEvents: false,
    ephemeral: false,
  };
  if (projectPath) params.cwd = projectPath;
  if (threadId) {
    params.threadId = threadId;
    params.excludeTurns = true;
  }
  // Resume failure leaves the saved thread intact; never silently start over.
  const response = await appServer.request<ThreadStartResponse>(threadId ? "thread/resume" : "thread/start", params);
  const id = response.thread?.id;
  if (!id) throw new Error("Codex가 작업 스레드 ID를 반환하지 않았습니다.");
  if (threadId && id !== threadId) throw new Error("저장한 대화와 재개된 스레드가 일치하지 않습니다.");
  threadId = id;
  loadedThreads.add(id);
  syncActiveConversation();
  broadcastState();
  return id;
}

function coordinatorPrompt(prompt: string): string {
  const lines = [
    "당신은 여러 전문 에이전트의 Coordinator입니다.",
    "사용자 요청을 최대 5개의 구체적인 업무 단위로 나누고, 각 업무의 역할과 의존성을 정하세요.",
    "서로 독립적인 조사·분석은 의존성을 두지 않아 병렬 실행할 수 있게 하세요.",
    "같은 작업공간을 변경하는 구현·디자인·통합·검증 작업은 access를 write로 지정하세요.",
    "최종 검증과 종합 보고 단계는 Bridge가 안전 규칙에 따라 자동으로 추가합니다.",
    "코드를 직접 수정하지 말고 JSON 계획만 반환하세요.",
    "",
    `사용자 요청: ${prompt}`,
  ];
  if (workspaceMode === "research") {
    lines.splice(4, 0, "현재는 폴더 없는 조사 모드입니다. 파일을 읽거나 수정하는 작업은 계획에 넣지 말고 웹·시장 정보 조사만 하세요.");
  }
  const previous = conversationContext();
  if (previous) lines.push("", "이 대화의 이전 결과 참고:", previous.slice(0, 8_000));
  return lines.join("\n");
}

function assignTaskSkills(definitions: TaskDefinition[]): TaskDefinition[] {
  let preferredAssigned = false;
  return definitions.map((task) => {
    if (task.kind === "coordinate" || task.kind === "report" || task.kind === "verification") return task;
    if (task.skillPath) return task;
    if (
      selectedSkill &&
      !preferredAssigned &&
      (task.agentRole === activeRole || (task.access === "write" && activeRole !== "researcher"))
    ) {
      preferredAssigned = true;
      return { ...task, skillPath: selectedSkill.path };
    }
    const routed = routeSkill(`${task.title}\n${task.description}`, skills);
    return routed.skill && (task.agentRole === routed.role || task.agentRole === "general")
      ? { ...task, skillPath: routed.skill.path }
      : task;
  });
}

function dependencyContext(run: RunSnapshot, task: TaskNode): string {
  const sources = task.kind === "report"
    ? run.tasks.filter((candidate) => candidate.id !== task.id && candidate.id !== "plan")
    : task.dependsOn.map((id) => run.tasks.find((candidate) => candidate.id === id)).filter((value): value is TaskNode => Boolean(value));
  if (sources.length === 0) return "선행 작업 없음";
  return sources.map((source) => {
    const result = taskAssistantText.get(source.id) ?? source.resultSummary ?? source.error ?? "결과 메시지 없음";
    return `[${source.title}] 상태=${source.status}\n${result.slice(0, 4_000)}`;
  }).join("\n\n");
}

function taskPrompt(run: RunSnapshot, task: TaskNode): string {
  if (task.id === "plan") return coordinatorPrompt(run.prompt);
  const accessRule = workspaceMode === "research"
    ? "이 작업은 폴더 없는 조사 모드의 읽기 전용 웹 조사입니다. 파일을 읽거나 수정하지 말고, 확인한 자료와 출처를 정리하세요."
    : task.access === "read"
    ? "이 작업은 읽기 전용입니다. 파일을 수정하지 마세요."
    : "이 작업은 작업공간 쓰기가 허용됩니다. 배정된 범위만 수정하고 관련 없는 변경은 건드리지 마세요.";
  const reportRule = task.kind === "report"
    ? "성공한 작업뿐 아니라 실패·차단·중단된 작업과 검증 결과도 빠짐없이 포함해 한국어로 최종 보고하세요."
    : "배정된 업무만 수행하고, 완료 결과와 확인 방법을 간결하게 남기세요.";
  const lines = [
    `당신의 역할: ${task.agentRole}`,
    `배정 업무: ${task.title}`,
    task.description,
    "",
    accessRule,
    reportRule,
    "",
    `전체 사용자 요청: ${run.prompt}`,
    "",
    "선행 작업 결과:",
    dependencyContext(run, task),
  ];
  const previous = conversationContext();
  if (previous && task.id !== "report") lines.push("", "이 대화의 이전 결과 참고:", previous.slice(0, 8_000));
  return lines.join("\n");
}

function taskInput(task: TaskNode, text: string): JsonObject[] {
  const input: JsonObject[] = [{ type: "text", text, text_elements: [] }];
  const skill = task.skillPath ? skills.find((candidate) => candidate.path === task.skillPath && candidate.enabled) : null;
  if (skill) {
    input[0] = { type: "text", text: `$${skill.name}\n\n${text}`, text_elements: [] };
    input.push({ type: "skill", name: skill.name, path: skill.path });
  }
  return input;
}

function taskSandboxPolicy(task: TaskNode): JsonObject {
  if (workspaceMode === "research" || task.access === "read") {
    return { type: "readOnly", networkAccess: workspaceMode === "research" && researchNetworkAccess };
  }
  return {
    type: "workspaceWrite",
    writableRoots: projectPath ? [projectPath] : [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function finalizeTeamRunIfDone(): void {
  if (!activeRun || !activeRun.tasks.every((task) => ["completed", "failed", "blocked", "interrupted"].includes(task.status))) return;
  const report = activeRun.tasks.find((task) => task.kind === "report");
  const reportText = report ? taskAssistantText.get(report.id) : undefined;
  const fallbackSummary = activeRun.tasks
    .filter((task) => task.id !== "plan")
    .map((task) => `${task.status === "completed" ? "✓" : "!"} ${task.title}: ${task.status}${task.error ? ` (${task.error})` : ""}`)
    .join("\n");
  const summary = reportText?.trim() || fallbackSummary;
  activeRun = { ...activeRun, summary };
  assistantText = summary;
  const conversation = activeConversation();
  conversation.contextSummary = summary.slice(0, 10_000);
  conversation.messageCount += 1;
  updateConversationPreview(summary);
  syncActiveConversation();
  completeConversationReply(activeRun.status === "completed" ? "completed" : activeRun.status === "interrupted" ? "interrupted" : "failed");
  broadcast({ type: "assistant.text", text: assistantText });
  petState = activeRun.status === "completed" ? "success" : activeRun.status === "interrupted" ? "idle" : "error";
  publishRun(activeRun);
  runtimeRegistry.removeRun(activeRun.id);
}

function expandedRunFromPlanner(current: RunSnapshot, planner: TaskNode, text: string, failure?: string): RunSnapshot {
  let definitions: TaskDefinition[];
  let fallbackReason = failure;
  if (!fallbackReason) {
    try {
      definitions = parseTaskPlan(text);
    } catch (error) {
      fallbackReason = errorMessage(error);
      definitions = fallbackTaskPlan(current.prompt, activeRole, selectedSkill?.path);
    }
  } else {
    definitions = fallbackTaskPlan(current.prompt, activeRole, selectedSkill?.path);
  }
  if (workspaceMode === "research") {
    definitions = definitions.map((definition) => ({ ...definition, access: "read" }));
  }
  definitions = assignTaskSkills(definitions!);
  let expanded = createRunSnapshot({
    id: current.id,
    now: current.createdAt,
    prompt: current.prompt,
    mode: current.mode,
    tasks: definitions,
  });
  expanded = transitionTask(expanded, "plan", "running", {
    threadId: planner.threadId,
    turnId: planner.turnId,
    startedAt: planner.startedAt,
    attempt: Math.max(planner.attempt, 1),
  });
  expanded = transitionTask(expanded, "plan", "completed", {
    resultSummary: fallbackReason
      ? `Coordinator 계획을 사용할 수 없어 안전한 기본 계획을 적용했습니다: ${fallbackReason}`
      : "Coordinator 계획을 검증하고 안전 규칙을 적용했습니다.",
  });
  if (fallbackReason) {
    publishActivity(localActivity("thinking", "안전한 기본 작업 계획을 적용했습니다", fallbackReason));
  }
  return expanded;
}

async function launchTeamTask(runId: string, taskId: string): Promise<void> {
  if (!activeRun || activeRun.id !== runId) return;
  let task = activeRun.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.status !== "running") return;
  let turnDispatched=false;
  try {
    if (projectPath) {const resolved=await validateProject(projectPath);if(executionRuntime.busy&&resolved!==projectPath)throw new Error('Generation workspace target changed');}
    const threadParams: JsonObject = {
      approvalPolicy: "on-request",
      sandbox: workspaceMode === "research" || task.access === "read" ? "read-only" : "workspace-write",
      experimentalRawEvents: false,
      ephemeral: true,
    };
    if (projectPath) threadParams.cwd = projectPath;
    const threadResponse = await appServer.request<ThreadStartResponse>("thread/start", threadParams);
    const taskThreadId = threadResponse.thread?.id;
    if (!taskThreadId) throw new Error("Codex가 에이전트 스레드 ID를 반환하지 않았습니다.");
    if (!activeRun || activeRun.id !== runId || !['running','waitingApproval'].includes(activeRun.tasks.find(t=>t.id===taskId)?.status||'')) return;
    runtimeRegistry.bindThread({ runId, taskId, agentId: task.agentId, threadId: taskThreadId });
    activeRun = updateTask(activeRun, taskId, { threadId: taskThreadId });
    publishRun(activeRun);
    task = activeRun.tasks.find((candidate) => candidate.id === taskId)!;
    if(executionRuntime.busy&&projectPath)atelierCheck(await validateProject(projectPath)===projectPath,'제작 workspace가 변경되었습니다.','WORKSPACE_INVALID');

    turnDispatched=true;
    const response = await appServer.request<TurnStartResponse>("turn/start", {
      threadId: taskThreadId,
      input: taskInput(task, taskPrompt(activeRun, task)),
      sandboxPolicy: taskSandboxPolicy(task),
      ...(activeModel ? { model: activeModel } : {}),
      ...(activeEffort ? { effort: activeEffort } : {}),
      ...(task.id === "plan" ? { outputSchema: TASK_PLAN_OUTPUT_SCHEMA } : {}),
    });
    const taskTurnId = response.turn?.id;
    if (!taskTurnId) throw new Error("Codex가 에이전트 작업 ID를 반환하지 않았습니다.");
    if(!activeRun||activeRun.id!==runId||activeRun.tasks.find(t=>t.id===taskId)?.status==='interrupted'){
      await appServer.request('turn/interrupt',{threadId:taskThreadId,turnId:taskTurnId});return;
    }
    const context = runtimeRegistry.bindTurn(taskThreadId, taskTurnId);
    if (!activeRun || activeRun.id !== runId) return;
    activeRun = updateTask(activeRun, taskId, { turnId: taskTurnId });
    broadcast({ type: "turn.state", turnId: taskTurnId, status: "inProgress", ...contextFields(context) });
    publishRun(activeRun);
  } catch (error) {
    if(executionRuntime.busy&&turnDispatched){await appServer.stopAndWait();return;}
    if (!activeRun || activeRun.id !== runId) return;
    const current = activeRun.tasks.find((candidate) => candidate.id === taskId);
    if (current && (current.status === "running" || current.status === "waitingApproval")) {
      let next = activeRun;
      if (current.status === "waitingApproval") next = transitionTask(next, taskId, "running");
      activeRun = transitionTask(next, taskId, "failed", { error: errorMessage(error) });
      publishActivity(localActivity("error", `${current.title} 시작 실패`, errorMessage(error), runtimeRegistry.resolve({ threadId: current.threadId })));
      publishRun(activeRun);
    }
  }
}

async function dispatchTeamTasks(): Promise<void> {
  if (teamSchedulerBusy || !activeRun || !runIsActive()) return;
  teamSchedulerBusy = true;
  const runId = activeRun.id;
  try {
    const startable = selectStartableTaskIds(activeRun, 3);
    for (const taskId of startable) activeRun = transitionTask(activeRun, taskId, "running");
    if (startable.length > 0) {
      publishRun(activeRun);
      await Promise.all(startable.map((taskId) => launchTeamTask(runId, taskId)));
    }
  } finally {
    teamSchedulerBusy = false;
    finalizeTeamRunIfDone();
    if (activeRun?.id === runId && selectStartableTaskIds(activeRun, 3).length > 0) void dispatchTeamTasks();
  }
}

function handleTeamTurnCompleted(context: RuntimeContext, status: string, error?: string): void {
  if (!activeRun || activeRun.id !== context.runId) return;
  const task = activeRun.tasks.find((candidate) => candidate.id === context.taskId);
  if (!task || ["completed", "failed", "blocked", "interrupted"].includes(task.status)) return;
  const result = taskAssistantText.get(task.id) ?? "";

  if (task.id === "plan") {
    activeRun = expandedRunFromPlanner(activeRun, task, result, status === "completed" ? undefined : error || status);
  } else {
    let currentRun = activeRun;
    if (task.status === "waitingApproval") currentRun = transitionTask(currentRun, task.id, "running");
    if (status === "completed") {
      activeRun = transitionTask(currentRun, task.id, "completed", { resultSummary: result.slice(0, 4_000) || "작업 완료" });
    } else if (status === "interrupted") {
      activeRun = transitionTask(currentRun, task.id, "interrupted", { error: error || "작업이 중단되었습니다." });
    } else {
      activeRun = transitionTask(currentRun, task.id, "failed", { error: error || "Codex 작업이 실패했습니다." });
    }
  }
  publishRun(activeRun);
  finalizeTeamRunIfDone();
  void dispatchTeamTasks();
}

async function startTeamRun(prompt: string): Promise<void> {
  const planTask: TaskDefinition = {
    id: "plan",
    title: "요청 분석 및 역할 배정",
    description: "사용자 요청을 독립적인 작업으로 나누고 역할, 의존성, 안전한 실행 순서를 결정합니다.",
    kind: "coordinate",
    access: "read",
    agentRole: "coordinator",
    dependsOn: [],
    order: 0,
  };
  runtimeRegistry.clear();
  taskAssistantText.clear();
  assistantText = "";
  activeRun = createRunSnapshot({ prompt, mode: "team", tasks: [planTask] });
  publishRun(activeRun);
  await dispatchTeamTasks();
}

async function startTurn(message: Extract<ClientMessage, { type: "turn.start" }>, designExecution=false): Promise<void> {
  if(executionRuntime.busy&&!designExecution)throw new Error('Atelier generation is active; finish or interrupt it first.');
  if (proposalRuntime.busy) throw new Error("Atelier proposal is active; finish or interrupt it first.");
  if (workspaceMode === "project" && !projectPath) throw new Error("프로젝트 모드에서는 먼저 프로젝트 폴더를 선택하세요.");
  if (turnId || runIsActive()) throw new Error("이미 작업이 진행 중입니다.");
  const prompt = message.prompt.trim();
  if (!prompt) throw new Error("Codex에 전달할 업무를 입력하세요.");
  if (projectPath) await validateProject(projectPath);
  await ensureAppServer();
  if (message.model && models.length > 0 && !models.some((candidate) => candidate.model === message.model)) {
    throw new Error("선택한 모델을 현재 Codex App Server에서 사용할 수 없습니다.");
  }
  const selectedModelInfo = message.model
    ? models.find((candidate) => candidate.model === message.model)
    : defaultModel(models);
  if (
    message.effort
    && selectedModelInfo
    && !selectedModelInfo.supportedReasoningEfforts.some((candidate) => candidate.reasoningEffort === message.effort)
  ) {
    throw new Error("선택한 모델이 이 추론 강도를 지원하지 않습니다.");
  }
  activeModel = message.model ?? selectedModelInfo?.model ?? null;
  activeEffort = message.effort ?? selectedModelInfo?.defaultReasoningEffort ?? null;
  startConversationPrompt(prompt);
  assistantText = "";
  if ((message.executionMode ?? "team") !== "team") {
    activeRun = null;
    taskAssistantText.clear();
    syncActiveConversation();
    broadcast({ type: "run.state", run: null });
  }
  broadcast({ type: "assistant.text", text: assistantText });
  syncActiveConversation();
  broadcastConversationState();

  let rationale: string;
  if (message.skillMode === "manual") {
    selectedSkill = skills.find((skill) => skill.path === message.skillPath && skill.enabled) ?? null;
    if (message.skillPath && !selectedSkill) throw new Error("선택한 스킬을 현재 프로젝트에서 찾을 수 없습니다.");
    activeRole = selectedSkill ? classifySkill(selectedSkill) : "general";
    rationale = selectedSkill ? "사용자가 직접 선택한 스킬입니다." : "사용자가 기본 에이전트를 선택했습니다.";
  } else {
    const routed = routeSkill(prompt, skills);
    selectedSkill = routed.skill;
    activeRole = routed.role;
    rationale = routed.rationale;
  }
  broadcast({ type: "skill.selected", skill: selectedSkill, mode: message.skillMode, role: activeRole, rationale });
  publishActivity(
    localActivity(
      "thinking",
      selectedSkill ? `${selectedSkill.name} 스킬을 준비합니다` : `${SKILL_ROLE_LABELS[activeRole]} 역할로 준비합니다`,
      rationale,
    ),
  );

  if(designExecution)await executionRuntime.beforeDispatch(activeConversation().messages.slice(-2).map(m=>m.id));
  if ((message.executionMode ?? "team") === "team") {
    await startTeamRun(prompt);
    return;
  }

  const activeThreadId = await ensureThread();
  if(designExecution)await executionRuntime.soloThread(activeThreadId);
  const previous = conversationContext();
  const contextualPrompt = previous
    ? `이전 대화의 마지막 결과를 참고하세요:\n${previous.slice(0, 8_000)}\n\n새 요청:\n${prompt}`
    : prompt;
  const text = selectedSkill ? `$${selectedSkill.name}\n\n${contextualPrompt}` : contextualPrompt;
  const input: Array<JsonObject> = [{ type: "text", text, text_elements: [] }];
  if (selectedSkill) input.push({ type: "skill", name: selectedSkill.name, path: selectedSkill.path });
  if(designExecution&&projectPath)atelierCheck(await validateProject(projectPath)===projectPath,'제작 workspace가 변경되었습니다.','WORKSPACE_INVALID');

  const sandboxPolicy: JsonObject = workspaceMode === "research"
    ? { type: "readOnly", networkAccess: researchNetworkAccess }
    : {
      type: "workspaceWrite",
      writableRoots: [projectPath],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  const response = await appServer.request<TurnStartResponse>("turn/start", {
    threadId: activeThreadId,
    input,
    sandboxPolicy,
    ...(activeModel ? { model: activeModel } : {}),
    ...(activeEffort ? { effort: activeEffort } : {}),
  });
  const id = response.turn?.id;
  if (!id) throw new Error("Codex가 작업 ID를 반환하지 않았습니다.");
  if(completedSoloTurns.has(id))return;
  turnId = id;
  if(designExecution){for(const event of await executionRuntime.soloTurn(id))handleRuntimeNotification(event);if(completedSoloTurns.has(id))return;}
  syncActiveConversation();
  broadcast({ type: "turn.state", turnId, status: "inProgress" });
  broadcastState();
}

async function interruptTurn(): Promise<void> {
  if(executionRuntime.busy){await executionRuntime.interrupt();return;}
  await interruptExistingTurn();
}
async function interruptExistingTurn(): Promise<void> {
  if(proposalRuntime.busy){await proposalRuntime.interrupt();return;}
  if (activeRun && runIsActive()) {
    cancelPendingApprovals((pending) => pending.approval.runId === activeRun?.id);
    const activeTasks = activeRun.tasks.filter((task) =>
      (task.status === "running" || task.status === "waitingApproval") && task.threadId && task.turnId,
    );
    await Promise.allSettled(activeTasks.map((task) => appServer.request("turn/interrupt", {
      threadId: task.threadId,
      turnId: task.turnId,
    })));
    activeRun = interruptRun(activeRun);
    publishRun(activeRun);
    finalizeTeamRunIfDone();
    return;
  }
  if (!threadId || !turnId) throw new Error("중단할 작업이 없습니다.");
  cancelPendingApprovals((pending) => pending.approval.threadId === threadId && pending.approval.turnId === turnId);
  await appServer.request("turn/interrupt", { threadId, turnId });
}

function approvalFromRequest(request: ProtocolServerRequest): PendingApproval | null {
  const params = request.params ?? {};
  const approvalId = randomUUID();
  const context = requestContextFields(params);
  if (request.method === "item/commandExecution/requestApproval") {
    return {
      requestId: request.id,
      method: request.method,
      legacy: false,
      approval: {
        approvalId,
        kind: "command",
        title: "명령 실행 승인",
        reason: typeof params.reason === "string" ? params.reason : undefined,
        command: typeof params.command === "string" ? params.command : undefined,
        cwd: typeof params.cwd === "string" ? params.cwd : undefined,
        ...context,
      },
    };
  }
  if (request.method === "item/fileChange/requestApproval") {
    return {
      requestId: request.id,
      method: request.method,
      legacy: false,
      approval: {
        approvalId,
        kind: "file",
        title: "파일 변경 승인",
        reason: typeof params.reason === "string" ? params.reason : undefined,
        grantRoot: typeof params.grantRoot === "string" ? params.grantRoot : undefined,
        ...context,
      },
    };
  }
  if (request.method === "item/permissions/requestApproval") {
    const requestedPermissions = params.permissions && typeof params.permissions === "object"
      ? params.permissions as JsonObject
      : {};
    const network = requestedPermissions.network && typeof requestedPermissions.network === "object"
      ? requestedPermissions.network as JsonObject
      : undefined;
    const fileSystem = requestedPermissions.fileSystem && typeof requestedPermissions.fileSystem === "object"
      ? requestedPermissions.fileSystem as JsonObject
      : undefined;
    const stringArray = (value: unknown): string[] => Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      requestId: request.id,
      method: request.method,
      legacy: false,
      requestedPermissions,
      approval: {
        approvalId,
        kind: "permission",
        title: "추가 권한 승인",
        reason: typeof params.reason === "string" ? params.reason : undefined,
        cwd: typeof params.cwd === "string" ? params.cwd : undefined,
        requestedPermissions: {
          network: network?.enabled === true,
          readPaths: stringArray(fileSystem?.read),
          writePaths: stringArray(fileSystem?.write),
        },
        ...context,
      },
    };
  }
  if (request.method === "execCommandApproval") {
    const command = Array.isArray(params.command) ? params.command.join(" ") : undefined;
    return {
      requestId: request.id,
      method: request.method,
      legacy: true,
      approval: {
        approvalId,
        kind: "command",
        title: "명령 실행 승인",
        reason: typeof params.reason === "string" ? params.reason : undefined,
        command,
        cwd: typeof params.cwd === "string" ? params.cwd : undefined,
        ...context,
      },
    };
  }
  if (request.method === "applyPatchApproval") {
    return {
      requestId: request.id,
      method: request.method,
      legacy: true,
      approval: {
        approvalId,
        kind: "file",
        title: "파일 변경 승인",
        reason: typeof params.reason === "string" ? params.reason : undefined,
        grantRoot: typeof params.grantRoot === "string" ? params.grantRoot : undefined,
        ...context,
      },
    };
  }
  return null;
}

function handleServerRequest(request: ProtocolServerRequest): void {
  if(proposalRuntime.serverRequest(request))return;
  if(executionRuntime.busy&&!executionRuntime.accepts(request.params?.threadId,request.params?.turnId)){appServer.respondError(request.id,-32003,'Request does not belong to active generation.');return;}
  const pending = approvalFromRequest(request);
  if (!pending) {
    appServer.respondError(request.id, -32601, `Unsupported server request: ${request.method}`);
    broadcastError(`현재 UI에서 지원하지 않는 Codex 요청입니다: ${request.method}`);
    return;
  }
  pendingApprovals.set(pending.approval.approvalId, pending);
  if (activeRun && pending.approval.runId === activeRun.id && pending.approval.taskId) {
    const task = activeRun.tasks.find((candidate) => candidate.id === pending.approval.taskId);
    if (task?.status === "running") {
      activeRun = transitionTask(activeRun, task.id, "waitingApproval");
      publishRun(activeRun);
    }
  }
  petState = "waitingApproval";
  broadcast({ type: "approval.request", approval: pending.approval });
  publishActivity(localActivity(
    "waitingApproval",
    pending.approval.title,
    pending.approval.reason,
    runtimeRegistry.resolve(request.params),
  ));
}

function resolveApproval(message: Extract<ClientMessage, { type: "approval.resolve" }>): void {
  const pending = pendingApprovals.get(message.approvalId);
  if (!pending) throw new Error("만료되었거나 존재하지 않는 승인 요청입니다.");
  const protocol: ApprovalProtocol = pending.method === "item/permissions/requestApproval"
    ? "permission"
    : pending.legacy ? "legacy" : "modern";
  appServer.respond(pending.requestId, approvalResponse(protocol, message.decision, pending.requestedPermissions));
  pendingApprovals.delete(message.approvalId);
  if (activeRun && pending.approval.runId === activeRun.id && pending.approval.taskId) {
    const task = activeRun.tasks.find((candidate) => candidate.id === pending.approval.taskId);
    if (task?.status === "waitingApproval") {
      activeRun = transitionTask(activeRun, task.id, "running");
      publishRun(activeRun);
    }
  }
  petState = turnId || runIsActive() ? "thinking" : "idle";
  broadcast({ type: "approval.resolved", approvalId: message.approvalId });
  publishActivity(
    localActivity(
      petState,
      message.decision === "accept" || message.decision === "acceptForSession" ? "요청을 승인했습니다" : "요청을 거절했습니다",
      undefined,
      pending.approval.threadId ? runtimeRegistry.resolve({
        threadId: pending.approval.threadId,
        turnId: pending.approval.turnId,
      }) : null,
    ),
  );
}

function cancelPendingApprovals(predicate: (pending: PendingApproval) => boolean): void {
  for (const [approvalId, pending] of pendingApprovals) {
    if (!predicate(pending)) continue;
    const protocol: ApprovalProtocol = pending.method === "item/permissions/requestApproval"
      ? "permission"
      : pending.legacy ? "legacy" : "modern";
    if (appServer.ready) {
      try {
        appServer.respond(pending.requestId, approvalResponse(protocol, "cancel", pending.requestedPermissions));
      } catch {
        // The App Server may already be exiting; local state still must be cleared.
      }
    }
    pendingApprovals.delete(approvalId);
    broadcast({ type: "approval.resolved", approvalId });
  }
}

async function handleClientMessage(socket: WebSocket, raw: string): Promise<void> {
  const message = parseClientMessage(raw);
  if(executionRuntime.busy&&!['turn.interrupt','approval.resolve','models.refresh'].includes(message.type))throw new Error('Atelier generation is active; finish or interrupt it first.');
  switch (message.type) {
    case "workspace.mode":
      await setWorkspaceMode(message.mode);
      break;
    case "workspace.network":
      setResearchNetworkAccess(message.enabled);
      break;
    case "project.pick":
      await pickAndSelectProject(socket);
      break;
    case "project.select":
      await selectProject(message.path);
      break;
    case "project.trust":
      await trustCurrentProject();
      break;
    case "conversation.new":
      newConversation();
      break;
    case "conversation.select":
      await selectConversation(message.conversationId);
      break;
    case 'conversation.rename':{
      try{
        if(turnId||runIsActive()||proposalRuntime.busy)throw new Error('진행 중인 작업을 마친 뒤 이름을 저장하세요.');
        if(!historyWritable||historyError)throw new Error('대화 기록 저장을 복구한 뒤 이름을 저장하세요.');
        const record=conversations.get(message.conversationId);if(!record)throw new Error('대화를 찾을 수 없습니다.');
        if(record.title!==message.expectedTitle)throw new Error('다른 창에서 이름이 변경됐습니다. 최신 이름을 확인하고 다시 저장하세요.');
        // Keep the published title unchanged until its serialized disk write commits.
        if(saveTimer){clearTimeout(saveTimer);saveTimer=undefined;}
        const patch={title:message.title,titleSource:'user' as const,updatedAt:new Date().toISOString()};
        renameSave=conversationStore.save({version:1,activeConversationId,conversations:[...conversations.values()].map(r=>r===record?{...r,...patch}:r)}).then(()=>{Object.assign(record,patch);});
        try{await renameSave;}catch{throw new Error('대화 이름을 저장하지 못했습니다. 입력을 보존하고 저장 공간·권한을 확인하세요.');}finally{renameSave=null;persistConversations();}
        broadcastState();send(socket,{type:'conversation.rename.result',clientRequestId:message.clientRequestId,ok:true,title:record.title});
      }catch(error){send(socket,{type:'conversation.rename.result',clientRequestId:message.clientRequestId,ok:false,error:errorMessage(error)});}
      break;
    }
    case "skills.refresh":
      await loadSkills(true);
      break;
    case "models.refresh":
      await loadModels();
      break;
    case "turn.start":
      await startTurn(message);
      break;
    case "turn.interrupt":
      await interruptTurn();
      break;
    case "approval.resolve":
      resolveApproval(message);
      break;
  }
}

appServer.on("ready", () => {
  appServerReady = true;
  petState = turnId ? petState : "idle";
  broadcastState();
});

appServer.on("exit", (error: Error) => {
  appServerReady = false;
  proposalRuntime.exited();
  executionRuntime.exited();
  petState = "error";
  // Persistent Solo threads must be resumed in the next child process.
  loadedThreads.clear();
  turnId = null;
  runtimeRegistry.clear();
  syncActiveConversation();
  cancelPendingApprovals(() => true);
  if (activeRun && runIsActive()) {
    activeRun = interruptRun(activeRun);
    publishRun(activeRun);
    finalizeTeamRunIfDone();
  }
  completeConversationReply("interrupted");
  broadcastError(error, false);
  broadcastState();
});

appServer.on("diagnostic", (message: string) => {
  if (message) console.error(`[codex] ${message}`);
});

appServer.on("request", (request: ProtocolServerRequest) => handleServerRequest(request));

function handleRuntimeNotification(notification: ProtocolNotification): void {
  if(proposalRuntime.notification(notification))return;
  if(executionRuntime.bufferNotification(notification))return;
  if (notification.method === "item/reasoning/textDelta") return;
  broadcast({ type: "protocol.event", method: notification.method });
  const params = notification.params;
  const context = runtimeRegistry.resolve(params);
  const eventTurn = typeof params?.turnId==='string'?params.turnId:(params?.turn as JsonObject|undefined)?.id;
  if(context){const task=activeRun?.id===context.runId?activeRun.tasks.find(t=>t.id===context.taskId):undefined;if(!task||['completed','failed','blocked','interrupted'].includes(task.status))return;}
  if(!context&&typeof eventTurn==='string'&&completedSoloTurns.has(eventTurn))return;
  if(executionRuntime.busy&&!executionRuntime.accepts(params?.threadId,eventTurn))return;
  // Unowned late Team/Solo events must never become the current conversation's response.
  if(!context&&typeof params?.threadId==='string'&&params.threadId!==threadId)return;
  if(!context&&turnId&&typeof eventTurn==='string'&&eventTurn!==turnId)return;
  executionRuntime.evidence(notification,context?.taskId);
  const usage = parseTokenUsage(notification, context?.turnId ?? turnId);
  if (usage) broadcast({ type: "token.usage", usage });
  if (notification.method === "item/agentMessage/delta") {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    if (delta) {
      if (context) {
        const text = `${taskAssistantText.get(context.taskId) ?? ""}${delta}`;
        taskAssistantText.set(context.taskId, text);
        syncActiveConversation();
        broadcast({ type: "assistant.text", text, ...contextFields(context) });
      } else {
        assistantText += delta;
        syncActiveConversation();
        broadcast({ type: "assistant.text", text: assistantText });
      }
    }
  }
  if (notification.method === "item/completed" && (context ? !taskAssistantText.get(context.taskId) : !assistantText)) {
    const completedText = completedAgentMessageText(params);
    if (completedText) {
      if (context) {
        taskAssistantText.set(context.taskId, completedText);
        syncActiveConversation();
        broadcast({ type: "assistant.text", text: completedText, ...contextFields(context) });
      } else {
        assistantText = completedText;
        syncActiveConversation();
        broadcast({ type: "assistant.text", text: assistantText });
      }
    }
  }
  if (notification.method === "turn/started") {
    const turn = params?.turn as JsonObject | undefined;
    const startedId = typeof turn?.id === "string" ? turn.id : null;
    const notificationThreadId = typeof params?.threadId === "string" ? params.threadId : null;
    let startedContext = context;
    if (startedId && notificationThreadId && context) {
      startedContext = runtimeRegistry.bindTurn(notificationThreadId, startedId);
    }
    if (!startedContext && startedId) turnId = startedId;
    broadcast({
      type: "turn.state",
      turnId: startedId ?? turnId,
      status: "inProgress",
      ...contextFields(startedContext),
    });
  }
  if (notification.method === "turn/completed") {
    const turn = params?.turn as JsonObject | undefined;
    const completedId = typeof turn?.id === "string" ? turn.id : (context?.turnId ?? turnId);
    const status = typeof turn?.status === "string" ? turn.status : "completed";
    const turnError = turn?.error && typeof turn.error === "object" ? turn.error as JsonObject : undefined;
    const turnErrorMessage = typeof turnError?.message === "string" ? turnError.message : undefined;
    broadcast({ type: "turn.state", turnId: completedId, status, ...contextFields(context) });
    if (context) handleTeamTurnCompleted(context, status, turnErrorMessage);
    if (completedId && context) runtimeRegistry.completeTurn(completedId);
    else {
      if(completedId){completedSoloTurns.add(completedId);if(completedSoloTurns.size>4096)completedSoloTurns.delete(completedSoloTurns.values().next().value!);}
      turnId = null;
      syncActiveConversation();
      completeConversationReply(status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed");
      if (status === "completed" && assistantText.trim()) {
        const conversation = activeConversation();
        conversation.contextSummary = assistantText.slice(0, 10_000);
        conversation.messageCount += 1;
        updateConversationPreview(assistantText);
      }
      syncActiveConversation();
      broadcastState();
    }
  }
  const activity = mapNotification(notification);
  if (activity) {
    if (context && activeRun?.id === context.runId) {
      activeRun = updateAgentActivity(activeRun, context.agentId, activity.state);
      publishRun(activeRun);
    }
    publishActivity({ ...activity, ...contextFields(context) });
  }
}
appServer.on('notification',handleRuntimeNotification);

function isAllowedOrigin(request: IncomingMessage): boolean {
  if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(request.headers.host ?? "")) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return parsed.protocol === "http:" && origin === parsed.origin && localHost && (parsed.port === "4780" || parsed.port === String(PORT));
  } catch {
    return false;
  }
}

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".woff2": return "font/woff2";
    case ".woff": return "font/woff";
    case ".txt":
    case ".md": return "text/plain; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}

async function staticBody(filePath:string){
  const equal=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  const base=await realpath(DIST),actual=await realpath(filePath),relative=path.relative(base,actual);
  const denied=()=>Object.assign(new Error('정적 파일의 실제 경로가 허용 범위를 벗어났습니다.'),{code:'EACCES'});
  if(!equal(base,DIST)||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw denied();
  const body=await readFile(actual);
  if(!equal(await realpath(DIST),base)||!equal(await realpath(filePath),actual))throw denied();
  return body;
}
async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, appServerReady }));
    return;
  }
  if (!SERVE_UI) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Auto Codex bridge is running. Start the Vite UI on port 4780.");
    return;
  }
  const pathname = decodeURIComponent(new URL(request.url || "/", `http://${HOST}`).pathname);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(DIST, requested);
  if (!filePath.startsWith(`${DIST}${path.sep}`) && filePath !== DIST) {
    response.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    const body = await staticBody(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch(error) {
    if((error as NodeJS.ErrnoException).code==='EACCES'){response.writeHead(403).end();return;}
    try {
      const body = await staticBody(path.join(DIST, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  }
}

const httpServer = createServer((request, response) => {
  void serveStatic(request, response).catch((error) => {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(errorMessage(error));
  });
});

const wsServer = new WebSocketServer({ noServer: true });
let clientQueue: Promise<void> = Promise.resolve();
let queuedTurnStarts = 0;
let queuedClientOperations = 0;
let interruptQueuedStarts = false;
const proposalRuntime=new AtelierProposalRuntime(appServer,atelier,{
  cwd:()=>validateProject(ROOT),ensure:ensureAppServer,models:()=>models,
  busy:()=>queuedTurnStarts>0||executionRuntime.busy||!!turnId||runIsActive()||pendingApprovals.size>0,
  emit:event=>{for(const socket of sockets)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(event));}
});
const executionRuntime=new AtelierExecutionRuntime(atelier,{
  busy:()=>queuedClientOperations>0||proposalRuntime.busy||!!turnId||runIsActive()||pendingApprovals.size>0,
  context:async b=>{
    atelierCheck(workspaceMode==='project'&&projectPath,'제작에는 선택한 실제 프로젝트 폴더가 필요합니다.','WORKSPACE_INVALID');
    const workspacePath=await validateProject(projectPath);
    atelierCheck(workspacePath===projectPath,'프로젝트 실제 대상이 변경되었습니다.','WORKSPACE_INVALID');
    atelierCheck(await readProjectTrust(workspacePath)==='trusted','기존 프로젝트 신뢰 설정에서 이 폴더를 명시적으로 신뢰하세요.','WORKSPACE_INVALID');
    atelierCheck(historyWritable&&!historyError,'대화 기록 저장을 복구한 뒤 제작하세요.','STORAGE_UNAVAILABLE');
    if(!b.snapshotId)return {workspacePath,conversationId:activeConversationId,model:''};
    await ensureAppServer();await loadModels();await loadSkills(true);
    const model=b.model?models.find(m=>m.model===b.model):defaultModel(models);
    atelierCheck(model&&model.inputModalities.includes('text'),'제작 모델을 현재 App Server에서 확인할 수 없습니다.','CAPABILITY_UNAVAILABLE');
    atelierCheck(!b.effort||model.supportedReasoningEfforts.some(e=>e.reasoningEffort===b.effort),'지원하지 않는 추론 강도입니다.','CAPABILITY_UNAVAILABLE');
    const skill=b.skillMode==='manual'&&b.skillPath?skills.find(s=>s.enabled&&s.path===b.skillPath):null;
    atelierCheck(!b.skillPath||(b.skillMode==='manual'&&skill),'현재 프로젝트에서 활성화된 스킬만 선택하세요.','CAPABILITY_UNAVAILABLE');
    return {workspacePath,conversationId:activeConversationId,model:model.model,skills,...(b.effort?{effort:b.effort as ReasoningEffort}:model.defaultReasoningEffort?{effort:model.defaultReasoningEffort}:{}),...(skill?{skillPath:skill.path}:{})};
  },
  start:message=>startTurn(message,true),interrupt:interruptExistingTurn,stop:()=>appServer.stopAndWait(),
  flush:async()=>{syncActiveConversation();if(!historyWritable)throw new Error('History is read only');await saveConversations();},
  emit:event=>{for(const socket of sockets)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(event));}
});
httpServer.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws" || !isAllowedOrigin(request)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wsServer.handleUpgrade(request, socket, head, (webSocket) => wsServer.emit("connection", webSocket, request));
});

wsServer.on("connection", (socket) => {
  if (sockets.size >= 32) { socket.close(1013, "Local connection limit"); return; }
  const atelierOwner = randomUUID();
  let atelierDownloadPaused = false;
  let priorityTokens = 10;
  let priorityAt = Date.now();
  sockets.add(socket);
  send(socket, { type: "bridge.state", snapshot: snapshot(true) });
  send(socket, { type: "conversation.state", state: conversationState() });
  if (historyError) send(socket, { type: "error", message: historyError, recoverable: true });
  if (!appServerReady && startupCliError) send(socket, {type:"error",message:startupCliError,recoverable:true});
  send(socket, { type: "assistant.text", text: assistantText });
  for (const [taskId, text] of taskAssistantText) {
    const context = activeRun?.tasks.find((task) => task.id === taskId);
    if (!context) continue;
    send(socket, {
      type: "assistant.text",
      text,
      runId: activeRun?.id,
      taskId,
      agentId: context.agentId,
    });
  }
  send(socket, { type: "skills.list", skills, errors: [] });
  send(socket, { type: "models.list", models, errors: [] });
  for (const pending of pendingApprovals.values()) send(socket, { type: "approval.request", approval: pending.approval });
  socket.on("message", (data) => {
    const raw = data.toString();
    let type = "";
    try { const input: unknown = JSON.parse(raw); if (input && typeof input === "object" && "type" in input && typeof input.type === "string") type = input.type; } catch { /* Existing parser reports malformed legacy input. */ }
    if (type.startsWith("atelier.")) {
      if(type==='atelier.generation.interrupt'){
        priorityTokens=Math.min(10,priorityTokens+(Date.now()-priorityAt)/100);priorityAt=Date.now();
        if(priorityTokens<1){socket.send(JSON.stringify({type:'atelier.response',v:1,clientRequestId:String((JSON.parse(raw) as {clientRequestId?:unknown}).clientRequestId||'').slice(0,64),ok:false,error:{code:'LIMIT_EXCEEDED',message:'중단 요청 속도 한도입니다.',retryable:true}}));return;}priorityTokens--;
        void executionRuntime.request(raw).then(reply=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(reply));});return;
      }
      if(type==='atelier.project.delete'){
        const request=JSON.parse(raw) as {clientRequestId?:unknown;payload?:{designProjectId?:unknown}};
        if(proposalRuntime.ownsProject(request.payload?.designProjectId)){
          socket.send(JSON.stringify({type:'atelier.response',v:1,clientRequestId:typeof request.clientRequestId==='string'?request.clientRequestId.slice(0,64):'',ok:false,error:{code:'BUSY',message:'실제 설계 제안이 종료된 뒤 프로젝트를 삭제하세요.',retryable:true}}));return;
        }
      }
      // Separate worker/queue: file I/O and large backup parsing cannot block pending approvals.
      if (socket.bufferedAmount > 1024 * 1024) atelierDownloadPaused = true;
      if (atelierDownloadPaused && socket.bufferedAmount <= 256 * 1024) atelierDownloadPaused = false;
      if (atelierDownloadPaused && type === "atelier.transfer.read") {
        let clientRequestId = ""; try { clientRequestId = String(JSON.parse(raw).clientRequestId ?? "").slice(0,64); } catch { /* Invalid request. */ }
        socket.send(JSON.stringify({ type:"atelier.response", v:1, clientRequestId, ok:false, error:{code:"BUSY",message:"다운로드 수신을 완료한 뒤 다음 chunk를 요청하세요.",retryable:true} }));
        return;
      }
      void atelier.handle(atelierOwner, raw,()=>type.startsWith('atelier.ai.')?proposalRuntime.request(raw):executionRuntime.request(raw)).then((reply) => { if(reply.ok&&reply.result.kind==='capabilities')Object.assign(reply.result,{execution:appServerReady,ai:appServerReady,aiPurposes:['blueprint','brief','flow','concept','style'],imageInput:false,proposalPolicy:{sandbox:'readOnly',networkAccess:false},executionPolicy:{sandbox:'workspaceWrite',networkAccess:false}}); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(reply)); });
      return;
    }
    if (type === "approval.resolve" || type === "turn.interrupt") {
      priorityTokens = Math.min(10, priorityTokens + (Date.now() - priorityAt) / 100);
      priorityAt = Date.now();
      if (priorityTokens < 1) { send(socket, {type:"error",message:"승인·중단 요청 속도 한도입니다. 잠시 후 다시 시도하세요.",recoverable:true}); return; }
      priorityTokens--;
      if (type === "turn.interrupt" && queuedTurnStarts > 0) interruptQueuedStarts = true;
      // These controls bypass both the design worker and long existing runtime requests.
      void handleClientMessage(socket, raw).catch((error) => send(socket, {type:"error",message:errorMessage(error),recoverable:true}));
      return;
    }
    if (type === "turn.start") queuedTurnStarts++;
    queuedClientOperations++;
    clientQueue = clientQueue.then(async () => {
      try { await handleClientMessage(socket, raw); }
      finally {
        queuedClientOperations--;
        if (type === "turn.start") {
          queuedTurnStarts--;
          // Preserve stop-during-start semantics while the App Server has not returned a turn ID yet.
          const interruptAfterStart = interruptQueuedStarts;
          if (!queuedTurnStarts) interruptQueuedStarts = false;
          if (interruptAfterStart) await interruptTurn();
        }
      }
    }).catch((error) => {
      if (!executionRuntime.busy && !turnId && !runIsActive()) completeConversationReply("failed");
      send(socket, { type: "error", message: errorMessage(error), recoverable: true });
      broadcastConversationState();
    });
  });
  socket.on("close", () => { sockets.delete(socket); void atelier.disconnect(atelierOwner).catch(() => {}); });
  socket.on("error", () => sockets.delete(socket));
});

try {
  const archive = await conversationStore.load();
  if (archive) {
    conversations.clear();
    for (const conversation of archive.conversations) conversations.set(conversation.id, conversation);
    activeConversationId = archive.activeConversationId;
    const restored = activeConversation();
    projectPath = restored.projectPath;
    workspaceMode = restored.workspaceMode;
    restoreConversationRuntime(restored);
    if (projectPath) {
      try {
        await validateProject(projectPath);
        projectTrust = await readProjectTrust(projectPath);
      } catch {
        projectPath = null;
        historyError = "이전 프로젝트 폴더를 찾을 수 없습니다. 폴더를 다시 연결하세요. 저장된 기록은 유지됩니다.";
      }
    }
  }
} catch {
  historyWritable = false;
  historyError = "대화 기록을 읽지 못했습니다. 기존 .local-data/history.json은 덮어쓰지 않습니다. 파일과 저장 권한을 확인하세요.";
}

httpServer.listen(PORT, HOST, () => {
  const appUrl = `http://${HOST}:${PORT}`;
  console.log(`Auto Codex bridge: ${appUrl}`);
  if (OPEN_UI) {
    const opener = process.platform === "win32"
      ? spawn("explorer.exe", [appUrl], { detached: true, stdio: "ignore", windowsHide: true })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [appUrl], { detached: true, stdio: "ignore" });
    opener.unref();
  }
  void (async () => {
    try {
      await ensureAppServer();
      startupCliError = null;
    } catch (error) {
      appServerReady = false;
      startupCliError = "Codex CLI에 연결하지 못했습니다. CLI 설치·로그인을 확인하세요. Atelier 설계 저장소는 별도로 사용할 수 있습니다.";
      petState = "error";
      broadcastError(error, false);
      broadcastState();
      return;
    }
    try {
      await loadModels();
      await loadSkills(true);
    } catch (error) {
      broadcast({ type: "models.list", models: [], errors: [errorMessage(error)] });
    }
  })();
});

async function shutdown(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  syncActiveConversation();
  if (saveTimer) clearTimeout(saveTimer);
  if (historyWritable) {
    try { await saveConversations(); } catch { console.error("대화 기록을 저장하지 못했습니다."); }
  }
  for (const socket of sockets) socket.close(1001, "Server shutting down");
  appServer.stop();
  await atelier.close().catch(() => {});
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
