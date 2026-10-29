// Browser QA only: synthetic state, no Codex, shell, model, or user data access.
// Run after npm run build. Open http://127.0.0.1:4871. Ctrl+C stops the fixture.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { parseClientMessage } from "../../build-server/server/client-message.js";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const calls = [];
const conversations = [{ id: "ui-fixture", title: "UI 검증용 합성 대화", createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z", preview: "실제 Codex를 실행하지 않는 화면 검증입니다.", messageCount: 0 }];
const snapshot = {
  connected: true, appServerReady: true, projectPath: "C:\\synthetic-workspace",
  workspaceMode: "project", researchNetworkAccess: false, projectTrust: "untrusted",
  threadId: null, turnId: null, activeConversationId: "ui-fixture", activeRole: "general",
  activeRun: null, petState: "idle", selectedSkill: null, activeModel: null, activeEffort: null, conversations,
};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1:4871").pathname;
  // Read-only diagnostics for this fixture; contains only synthetic UI requests.
  if (pathname === "/fixture-calls" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(calls));
  }
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
  try {
    const target = path.resolve(dist, `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`);
    if (!target.startsWith(dist.endsWith(path.sep) ? dist : dist + path.sep)) { res.writeHead(403).end(); return; }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain", ".md": "text/plain", ".json": "application/json" };
    const body = await readFile(target);
    res.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 * 1024 });
wss.on("connection", (socket, request) => {
  if (request.headers.origin && request.headers.origin !== "http://127.0.0.1:4871") { socket.close(); return; }
  const send = (message) => socket.send(JSON.stringify(message));
  const state = () => send({ type: "bridge.state", snapshot });
  state();
  send({ type: "conversation.state", state: { id: "ui-fixture", messages: [], activities: [], taskOutputs: {}, assistantText: "", activeRun: null } });
  send({ type: "models.list", models: [{ id: "ui-fixture-model", model: "ui-fixture-model", displayName: "UI fixture · 실제 모델 아님", hidden: false, isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "fixture" }], inputModalities: ["text"], supportsPersonality: false }], errors: [] });
  send({ type: "skills.list", skills: [], errors: [] });
  socket.on("message", (raw) => {
    try {
      const message = parseClientMessage(raw.toString());
      calls.push(message);
      if (message.type === "turn.start") {
        const hold = message.prompt.includes("HOLD_UI");
        snapshot.turnId = "ui-fixture-turn"; snapshot.petState = hold ? "running" : "waitingApproval"; state();
        send({ type: "turn.state", status: "inProgress", turnId: snapshot.turnId });
        if (hold) return; // Explicit synthetic hold for navigation/interrupt QA.
        send({ type: "approval.request", approval: { approvalId: "ui-fixture-approval", kind: "command", title: "UI 검증용 합성 승인", reason: "실제 명령을 실행하지 않습니다. 키보드·화면 연결 검증 전용입니다.", command: "synthetic-no-execution", cwd: snapshot.projectPath } });
      }
      if (message.type === "approval.resolve") {
        if (message.approvalId !== "ui-fixture-approval" || snapshot.turnId === null) throw new Error("합성 승인 ID가 일치하지 않습니다.");
        send({ type: "approval.resolved", approvalId: message.approvalId });
        snapshot.turnId = null; snapshot.petState = "idle"; state();
        send({ type: "turn.state", status: "completed", turnId: "ui-fixture-turn" });
        send({ type: "assistant.text", text: `## UI 검증용 합성 응답\n\n선택한 결정: ${message.decision}\n\n실제 모델·명령·파일 작업은 실행하지 않았습니다.\n\n` + "긴 본문 읽기와 스크롤 확인용 문단입니다.\n\n".repeat(40) });
      }
      if (message.type === "turn.interrupt") { snapshot.turnId = null; snapshot.petState = "idle"; state(); send({ type: "approval.resolved", approvalId: "ui-fixture-approval" }); send({ type: "turn.state", status: "interrupted" }); }
      if (message.type === "workspace.mode") { snapshot.workspaceMode = message.mode; state(); }
      if (message.type === "workspace.network") { snapshot.researchNetworkAccess = message.enabled; state(); }
    } catch (error) { send({ type: "error", message: error.message, recoverable: true }); }
  });
});
server.listen(4871, "127.0.0.1", () => console.log("UI fixture only: http://127.0.0.1:4871 (no Codex/model execution)"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { for (const client of wss.clients) client.terminate(); wss.close(); server.close(); });
