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
  ServerMessage,
  SkillInfo,
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
    Date.now() - Date.parse(lastActivity.timestamp) < 1_200;
  petState = activity.state;
  if (!duplicate) {
    lastActivity = activity;
    broadcast({ type: "activity.event", event: activity });
  }
  broadcastState();
}

function localActivity(state: PetState, title: string, detail?: string): ActivityEvent {
  return {
    id: randomUUID(),
    state,
    title,
    detail,
    source: "bridge",
    timestamp: new Date().toISOString(),
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
  if (turnId) throw new Error("진행 중인 작업을 중단한 뒤 프로젝트를 바꿔주세요.");
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
  broadcast({ type: "project.selected", path: resolved });
  broadcastState();
  await loadSkills(true);
  publishActivity(localActivity("idle", "프로젝트를 불러왔습니다", path.basename(resolved)));
}

async function trustCurrentProject(): Promise<void> {
  if (!projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
  if (turnId) throw new Error("진행 중인 작업을 중단한 뒤 프로젝트를 신뢰하세요.");
  await trustProject(projectPath);
  projectTrust = "trusted";
  threadId = null;
  turnId = null;
  selectedSkill = null;
  activeRole = "general";
  appServerReady = false;
  petState = "connecting";
  broadcast({ type: "project.trust", path: projectPath, status: projectTrust });
  broadcastState();
  appServer.stop();
  await ensureAppServer();
}

async function pickAndSelectProject(socket: WebSocket): Promise<void> {
  if (turnId) throw new Error("진행 중인 작업을 중단한 뒤 프로젝트를 바꿔주세요.");
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

async function startTurn(message: Extract<ClientMessage, { type: "turn.start" }>): Promise<void> {
  if (!projectPath) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
  if (turnId) throw new Error("이미 작업이 진행 중입니다.");
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

  const activeThreadId = await ensureThread();
  const text = selectedSkill ? `$${selectedSkill.name}\n\n${prompt}` : prompt;
  const input: Array<JsonObject> = [{ type: "text", text, text_elements: [] }];
  if (selectedSkill) input.push({ type: "skill", name: selectedSkill.name, path: selectedSkill.path });

  const response = await appServer.request<TurnStartResponse>("turn/start", {
    threadId: activeThreadId,
    input,
  });
  const id = response.turn?.id;
  if (!id) throw new Error("Codex가 작업 ID를 반환하지 않았습니다.");
  turnId = id;
  broadcast({ type: "turn.state", turnId, status: "inProgress" });
  broadcastState();
}

async function interruptTurn(): Promise<void> {
  if (!threadId || !turnId) throw new Error("중단할 작업이 없습니다.");
  await appServer.request("turn/interrupt", { threadId, turnId });
}

function approvalFromRequest(request: ProtocolServerRequest): PendingApproval | null {
  const params = request.params ?? {};
  const approvalId = randomUUID();
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
  petState = "waitingApproval";
  broadcast({ type: "approval.request", approval: pending.approval });
  publishActivity(localActivity("waitingApproval", pending.approval.title, pending.approval.reason));
}

function resolveApproval(message: Extract<ClientMessage, { type: "approval.resolve" }>): void {
  const pending = pendingApprovals.get(message.approvalId);
  if (!pending) throw new Error("만료되었거나 존재하지 않는 승인 요청입니다.");
  const legacyDecision: Record<typeof message.decision, string> = {
    accept: "approved",
    acceptForSession: "approved_for_session",
    decline: "denied",
    cancel: "abort",
  };
  appServer.respond(pending.requestId, {
    decision: pending.legacy ? legacyDecision[message.decision] : message.decision,
  });
  pendingApprovals.delete(message.approvalId);
  petState = turnId ? "thinking" : "idle";
  broadcast({ type: "approval.resolved", approvalId: message.approvalId });
  publishActivity(
    localActivity(
      petState,
      message.decision === "accept" || message.decision === "acceptForSession" ? "요청을 승인했습니다" : "요청을 거절했습니다",
    ),
  );
}

async function handleClientMessage(socket: WebSocket, raw: string): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    throw new Error("잘못된 JSON 메시지입니다.");
  }
  if (!message || typeof message.type !== "string") throw new Error("메시지 형식이 올바르지 않습니다.");
  switch (message.type) {
    case "project.pick":
      await pickAndSelectProject(socket);
      break;
    case "project.select":
      if (typeof message.path !== "string" || !message.path.trim()) throw new Error("프로젝트 경로를 입력하세요.");
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
    default:
      send(socket, { type: "error", message: "지원하지 않는 클라이언트 메시지입니다.", recoverable: true });
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
  if (notification.method === "item/agentMessage/delta") {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    if (delta) {
      assistantText += delta;
      broadcast({ type: "assistant.text", text: assistantText });
    }
  }
  if (notification.method === "item/completed" && !assistantText) {
    const completedText = completedAgentMessageText(params);
    if (completedText) {
      assistantText = completedText;
      broadcast({ type: "assistant.text", text: assistantText });
    }
  }
  if (notification.method === "turn/started") {
    const turn = params?.turn as JsonObject | undefined;
    if (typeof turn?.id === "string") turnId = turn.id;
    broadcast({ type: "turn.state", turnId, status: "inProgress" });
  }
  if (notification.method === "turn/completed") {
    const turn = params?.turn as JsonObject | undefined;
    const completedId = typeof turn?.id === "string" ? turn.id : turnId;
    const status = typeof turn?.status === "string" ? turn.status : "completed";
    broadcast({ type: "turn.state", turnId: completedId, status });
    turnId = null;
  }
  const activity = mapNotification(notification);
  if (activity) publishActivity(activity);
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
