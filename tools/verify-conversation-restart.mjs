// Run after npm run build. Isolated local fixture, no live Codex turns.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, ".cache"), { recursive: true });
const scratch = await mkdtemp(path.join(root, ".cache", "history-restart-"));
await cp(path.join(root, "build-server"), path.join(scratch, "build-server"), { recursive: true });
const projectA = path.join(scratch, "project-a");
const projectB = path.join(scratch, "project-b");
await mkdir(projectA);
await mkdir(projectB);
await cp(path.join(root, "tools", "fixtures", "history-app-server.mjs"), path.join(scratch, "app-server"));
const requests = path.join(scratch, "requests.jsonl");
const port = 4785;
let child;
let socket;
let received = [];

async function until(predicate, description) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${description}`);
}
const last = (type) => received.findLast((message) => message.type === type);
const send = (message) => socket.send(JSON.stringify(message));
async function stop() {
  socket?.close();
  if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
}
async function start() {
  received = [];
  child = spawn(process.execPath, [path.join(scratch, "build-server", "server", "index.js")], {
    cwd: scratch, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AUTO_CODEX_PORT: String(port), CODEX_BIN: process.execPath, AUTO_CODEX_TEST_REQUESTS: requests },
  });
  let listening = false;
  let diagnostics = "";
  child.stderr.on("data", (data) => { diagnostics += String(data); });
  child.stdout.on("data", (data) => { if (String(data).includes("Auto Codex bridge")) listening = true; });
  await until(() => listening, "bridge start");
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
  socket.on("message", (data) => received.push(JSON.parse(String(data))));
  try { await until(() => last("bridge.state")?.snapshot.appServerReady && last("conversation.state"), "fixture ready"); }
  catch (error) { throw new Error(`${error.message}: ${diagnostics || last("error")?.message || "no diagnostics"}`); }
}
async function exchange(message, condition, description) {
  const boundary = received.length;
  send(message);
  await until(() => received.slice(boundary).some(condition), description);
}
async function turn(prompt, mode = "solo") {
  await exchange({ type: "turn.start", prompt, skillMode: "auto", executionMode: mode }, (message) => message.type === "turn.state" && message.status === "completed", "completed turn");
}
async function saved(predicate) {
  await until(async () => {
    try { return predicate(JSON.parse(await readFile(path.join(scratch, ".local-data", "history.json"), "utf8"))); } catch { return false; }
  }, "atomic history save");
}

try {
  await start();
  await exchange({ type: "project.select", path: projectA }, (message) => message.type === "project.selected", "project A");
  const chatA = last("bridge.state").snapshot.activeConversationId;
  await turn("첫 번째 합성 요청");
  const threadA = last("bridge.state").snapshot.threadId;
  await exchange({ type: "project.select", path: projectB }, (message) => message.type === "project.selected", "project B");
  const chatB = last("bridge.state").snapshot.activeConversationId;
  assert.notEqual(chatA, chatB);
  await exchange({ type: "conversation.select", conversationId: chatA }, (message) => message.type === "conversation.state" && message.state.id === chatA, "restore project A");
  assert.equal(last("bridge.state").snapshot.projectPath, projectA);
  assert.equal(last("conversation.state").state.messages.length, 2);
  await turn("두 번째 합성 요청");
  await saved((archive) => archive.conversations.find((chat) => chat.id === chatA)?.messages.length === 4);
  await stop();
  await start();
  assert.equal(last("bridge.state").snapshot.activeConversationId, chatA);
  assert.equal(last("bridge.state").snapshot.threadId, threadA);
  assert.equal(last("conversation.state").state.messages.length, 4);
  await turn("재시작 후 이어가기");
  const calls = (await readFile(requests, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(calls.some((call) => call.method === "thread/resume" && call.params.threadId === threadA));
  assert.ok(calls.filter((call) => call.method === "turn/start").every((call) => call.params.sandboxPolicy.networkAccess === false));
  assert.ok(calls.filter((call) => call.method.startsWith("thread/")).every((call) => call.params.approvalPolicy === "on-request"));
  await exchange({ type: "turn.start", prompt: "HOLD_FOR_RESTART", skillMode: "auto", executionMode: "team" }, (message) => message.type === "approval.request", "pending team approval");
  const expiredApproval = last("approval.request").approval.approvalId;
  await saved((archive) => archive.conversations.find((chat) => chat.id === chatA)?.activeRun?.tasks.some((task) => task.status === "waitingApproval"));
  const stored = await readFile(path.join(scratch, ".local-data", "history.json"), "utf8");
  assert.ok(!stored.includes(expiredApproval));
  await stop();
  await start();
  assert.equal(last("conversation.state").state.activeRun.status, "interrupted");
  assert.equal(last("conversation.state").state.messages.at(-1).status, "interrupted");
  assert.ok(!received.some((message) => message.type === "approval.request"));
  await exchange({ type: "approval.resolve", approvalId: expiredApproval, decision: "accept" }, (message) => message.type === "error" && message.message.includes("만료"), "expired approval rejection");
  await turn("중단된 작업 다음 요청");
  await exchange({ type: "conversation.select", conversationId: chatB }, (message) => message.type === "conversation.state" && message.state.id === chatB, "saved project B");
  assert.equal(last("bridge.state").snapshot.projectPath, projectB);
  const movedProject = path.join(scratch, "project-b-moved");
  assert.equal(path.dirname(projectB), scratch);
  assert.equal(path.dirname(movedProject), scratch);
  await rename(projectB, movedProject);
  const callsBefore = (await readFile(requests, "utf8")).trim().split("\n").map(JSON.parse).filter((call) => call.method === "turn/start").length;
  await exchange({ type: "turn.start", prompt: "사라진 폴더 거부", skillMode: "auto", executionMode: "solo" }, (message) => message.type === "error", "missing project rejection");
  const callsAfter = (await readFile(requests, "utf8")).trim().split("\n").map(JSON.parse).filter((call) => call.method === "turn/start").length;
  assert.equal(callsAfter, callsBefore);
  await saved((archive) => archive.activeConversationId === chatB);
  await stop();
  await start();
  assert.equal(last("bridge.state").snapshot.activeConversationId, chatB);
  assert.equal(last("bridge.state").snapshot.projectPath, null);
  assert.equal(last("conversation.state").state.id, chatB);
  console.log("PASS: project switching, transcript restore, durable thread resume, partial team recovery, expired approval rejection, network disabled.");
} finally { await stop(); }
