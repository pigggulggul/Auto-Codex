import { randomUUID } from "node:crypto";
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
  PetState,
  RunSnapshot,
  ServerMessage,
  SkillInfo,
  TaskDefinition,
  TaskNode,
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

const HOST = "127.0.0.1";
const PORT = Number(process.env.AUTO_CODEX_PORT || 4781);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PARENT = path.dirname(MODULE_DIR);
const ROOT = path.basename(MODULE_PARENT) === "build-server" ? path.resolve(MODULE_DIR, "../..") : MODULE_PARENT;
const DIST = path.join(ROOT, "dist");
const SERVE_UI = process.argv.includes("--serve");
const OPEN_UI = process.argv.includes("--open");

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

const appServer = new CodexAppServer();
const sockets = new Set<WebSocket>();
const pendingApprovals = new Map<string, PendingApproval>();
const runtimeRegistry = new RuntimeRegistry();
const taskAssistantText = new Map<string, string>();

let appServerReady = false;
let projectPath: string | null = null;
let skills: SkillInfo[] = [];
let threadId: string | null = null;
let turnId: string | null = null;
let assistantText = "";
let projectTrust: ProjectTrust = "untrusted";
let petState: PetState = "connecting";
let selectedSkill: SkillInfo | null = null;
let activeRole: NonNullable<BridgeSnapshot["activeRole"]> = "general";
let lastActivity: ActivityEvent | null = null;
let activeRun: RunSnapshot | null = null;
let teamSchedulerBusy = false;

const ACTIVE_RUN_STATUSES = new Set(["planning", "running", "verifying"]);

function snapshot(connected = true): BridgeSnapshot {
  return {
    connected,
    appServerReady,
    projectPath,
    threadId,
    turnId,
    petState,
    selectedSkill,
    activeRole,
    projectTrust,
    activeRun,
  };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage): void {
  for (const socket of sockets) send(socket, message);
}

function broadcastState(): void {
  broadcast({ type: "bridge.state", snapshot: snapshot() });
}

function runIsActive(): boolean {
  return activeRun !== null && ACTIVE_RUN_STATUSES.has(activeRun.status);
}

function publishRun(run: RunSnapshot | null): void {
  activeRun = run;
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
  if (!projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
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
  const candidate = path.resolve(inputPath.trim());
  const resolved = await realpath(candidate);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error("프로젝트 경로는 폴더여야 합니다.");
  projectPath = resolved;
  projectTrust = await readProjectTrust(resolved);
  threadId = null;
  selectedSkill = null;
  activeRole = "general";
  skills = [];
  activeRun = null;
  runtimeRegistry.clear();
  taskAssistantText.clear();
  broadcast({ type: "project.selected", path: resolved });
  broadcastState();
  await loadSkills(true);
  publishActivity(localActivity("idle", "프로젝트를 불러왔습니다", path.basename(resolved)));
}

async function trustCurrentProject(): Promise<void> {
  if (!projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
  if (turnId || runIsActive()) throw new Error("진행 중인 작업을 중단한 뒤 프로젝트를 신뢰하세요.");
  await trustProject(projectPath);
  projectTrust = "trusted";
  threadId = null;
  turnId = null;
  selectedSkill = null;
  activeRole = "general";
  activeRun = null;
  runtimeRegistry.clear();
  taskAssistantText.clear();
  appServerReady = false;
  petState = "connecting";
  broadcast({ type: "project.trust", path: projectPath, status: projectTrust });
  broadcastState();
  appServer.stop();
  await ensureAppServer();
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
  if (!projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
  if (threadId) return threadId;
  const response = await appServer.request<ThreadStartResponse>("thread/start", {
    cwd: projectPath,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    experimentalRawEvents: false,
  });
  const id = response.thread?.id;
  if (!id) throw new Error("Codex가 작업 스레드 ID를 반환하지 않았습니다.");
  threadId = id;
  broadcastState();
  return id;
}

function coordinatorPrompt(prompt: string): string {
  return [
    "당신은 여러 전문 에이전트의 Coordinator입니다.",
    "사용자 요청을 최대 5개의 구체적인 업무 단위로 나누고, 각 업무의 역할과 의존성을 정하세요.",
    "서로 독립적인 조사·분석은 의존성을 두지 않아 병렬 실행할 수 있게 하세요.",
    "같은 작업공간을 변경하는 구현·디자인·통합·검증 작업은 access를 write로 지정하세요.",
    "최종 검증과 종합 보고 단계는 Bridge가 안전 규칙에 따라 자동으로 추가합니다.",
    "코드를 직접 수정하지 말고 JSON 계획만 반환하세요.",
    "",
    `사용자 요청: ${prompt}`,
  ].join("\n");
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
  const accessRule = task.access === "read"
    ? "이 작업은 읽기 전용입니다. 파일을 수정하지 마세요."
    : "이 작업은 작업공간 쓰기가 허용됩니다. 배정된 범위만 수정하고 관련 없는 변경은 건드리지 마세요.";
  const reportRule = task.kind === "report"
    ? "성공한 작업뿐 아니라 실패·차단·중단된 작업과 검증 결과도 빠짐없이 포함해 한국어로 최종 보고하세요."
    : "배정된 업무만 수행하고, 완료 결과와 확인 방법을 간결하게 남기세요.";
  return [
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
  ].join("\n");
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
  if (task.access === "read") return { type: "readOnly", networkAccess: false };
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
  if (!activeRun || activeRun.id !== runId || !projectPath) return;
  let task = activeRun.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.status !== "running") return;
  try {
    const threadResponse = await appServer.request<ThreadStartResponse>("thread/start", {
      cwd: projectPath,
      approvalPolicy: "on-request",
      sandbox: task.access === "read" ? "read-only" : "workspace-write",
      experimentalRawEvents: false,
      ephemeral: true,
    });
    const taskThreadId = threadResponse.thread?.id;
    if (!taskThreadId) throw new Error("Codex가 에이전트 스레드 ID를 반환하지 않았습니다.");
    runtimeRegistry.bindThread({ runId, taskId, agentId: task.agentId, threadId: taskThreadId });
    if (!activeRun || activeRun.id !== runId) return;
    activeRun = updateTask(activeRun, taskId, { threadId: taskThreadId });
    publishRun(activeRun);
    task = activeRun.tasks.find((candidate) => candidate.id === taskId)!;

    const response = await appServer.request<TurnStartResponse>("turn/start", {
      threadId: taskThreadId,
      input: taskInput(task, taskPrompt(activeRun, task)),
      sandboxPolicy: taskSandboxPolicy(task),
      ...(task.id === "plan" ? { outputSchema: TASK_PLAN_OUTPUT_SCHEMA } : {}),
    });
    const taskTurnId = response.turn?.id;
    if (!taskTurnId) throw new Error("Codex가 에이전트 작업 ID를 반환하지 않았습니다.");
    const context = runtimeRegistry.bindTurn(taskThreadId, taskTurnId);
    if (!activeRun || activeRun.id !== runId) return;
    activeRun = updateTask(activeRun, taskId, { turnId: taskTurnId });
    broadcast({ type: "turn.state", turnId: taskTurnId, status: "inProgress", ...contextFields(context) });
    publishRun(activeRun);
  } catch (error) {
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

async function startTurn(message: Extract<ClientMessage, { type: "turn.start" }>): Promise<void> {
  if (!projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
  if (turnId || runIsActive()) throw new Error("이미 작업이 진행 중입니다.");
  const prompt = message.prompt.trim();
  if (!prompt) throw new Error("Codex에 전달할 업무를 입력하세요.");
  await ensureAppServer();
  assistantText = "";
  broadcast({ type: "assistant.text", text: assistantText });

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

  if ((message.executionMode ?? "team") === "team") {
    await startTeamRun(prompt);
    return;
  }

  const activeThreadId = await ensureThread();
  const text = selectedSkill ? `$${selectedSkill.name}\n\n${prompt}` : prompt;
  const input: Array<JsonObject> = [{ type: "text", text, text_elements: [] }];
  if (selectedSkill) input.push({ type: "skill", name: selectedSkill.name, path: selectedSkill.path });

  const response = await appServer.request<TurnStartResponse>("turn/start", {
    threadId: activeThreadId,
    input,
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [projectPath],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  });
  const id = response.turn?.id;
  if (!id) throw new Error("Codex가 작업 ID를 반환하지 않았습니다.");
  turnId = id;
  broadcast({ type: "turn.state", turnId, status: "inProgress" });
  broadcastState();
}

async function interruptTurn(): Promise<void> {
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
  switch (message.type) {
    case "project.pick":
      await pickAndSelectProject(socket);
      break;
    case "project.select":
      await selectProject(message.path);
      break;
    case "project.trust":
      await trustCurrentProject();
      break;
    case "skills.refresh":
      await loadSkills(true);
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
  petState = "error";
  cancelPendingApprovals(() => true);
  if (activeRun && runIsActive()) {
    activeRun = interruptRun(activeRun);
    publishRun(activeRun);
    finalizeTeamRunIfDone();
  }
  broadcastError(error, false);
  broadcastState();
});

appServer.on("diagnostic", (message: string) => {
  if (message) console.error(`[codex] ${message}`);
});

appServer.on("request", (request: ProtocolServerRequest) => handleServerRequest(request));

appServer.on("notification", (notification: ProtocolNotification) => {
  if (notification.method === "item/reasoning/textDelta") return;
  broadcast({ type: "protocol.event", method: notification.method });
  const params = notification.params;
  const context = runtimeRegistry.resolve(params);
  if (notification.method === "item/agentMessage/delta") {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    if (delta) {
      if (context) {
        const text = `${taskAssistantText.get(context.taskId) ?? ""}${delta}`;
        taskAssistantText.set(context.taskId, text);
        broadcast({ type: "assistant.text", text, ...contextFields(context) });
      } else {
        assistantText += delta;
        broadcast({ type: "assistant.text", text: assistantText });
      }
    }
  }
  if (notification.method === "item/completed" && (context ? !taskAssistantText.get(context.taskId) : !assistantText)) {
    const completedText = completedAgentMessageText(params);
    if (completedText) {
      if (context) {
        taskAssistantText.set(context.taskId, completedText);
        broadcast({ type: "assistant.text", text: completedText, ...contextFields(context) });
      } else {
        assistantText = completedText;
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
    else turnId = null;
  }
  const activity = mapNotification(notification);
  if (activity) {
    if (context && activeRun?.id === context.runId) {
      activeRun = updateAgentActivity(activeRun, context.agentId, activity.state);
      publishRun(activeRun);
    }
    publishActivity({ ...activity, ...contextFields(context) });
  }
});

function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return localHost && (parsed.port === "4780" || parsed.port === String(PORT));
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
    case ".json": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
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
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch {
    try {
      const body = await readFile(path.join(DIST, "index.html"));
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
httpServer.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws" || !isAllowedOrigin(request)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wsServer.handleUpgrade(request, socket, head, (webSocket) => wsServer.emit("connection", webSocket, request));
});

wsServer.on("connection", (socket) => {
  sockets.add(socket);
  send(socket, { type: "bridge.state", snapshot: snapshot(true) });
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
  for (const pending of pendingApprovals.values()) send(socket, { type: "approval.request", approval: pending.approval });
  socket.on("message", (data) => {
    void handleClientMessage(socket, data.toString()).catch((error) => {
      send(socket, { type: "error", message: errorMessage(error), recoverable: true });
    });
  });
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
});

httpServer.listen(PORT, HOST, () => {
  const appUrl = `http://${HOST}:${PORT}`;
  console.log(`Auto Codex bridge: ${appUrl}`);
  if (OPEN_UI) {
    const opener = process.platform === "win32"
      ? spawn("explorer.exe", [appUrl], { detached: true, stdio: "ignore", windowsHide: true })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [appUrl], { detached: true, stdio: "ignore" });
    opener.unref();
  }
  void ensureAppServer().catch((error) => {
    appServerReady = false;
    petState = "error";
    broadcastError(error, false);
    broadcastState();
  });
});

function shutdown(): void {
  for (const socket of sockets) socket.close(1001, "Server shutting down");
  appServer.stop();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
