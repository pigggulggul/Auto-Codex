// Run after npm run build. Isolated local fixture, no live Codex turns.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {randomUUID} from 'node:crypto';

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
  assert.equal(last('bridge.state').snapshot.conversations.find(c=>c.id===chatA).title,'첫 번째 합성 요청');
  const renameId=randomUUID();await exchange({type:'conversation.rename',conversationId:chatA,title:'사용자가 정한 프로젝트 이름',expectedTitle:'첫 번째 합성 요청',clientRequestId:renameId},m=>m.type==='conversation.rename.result'&&m.clientRequestId===renameId&&m.ok,'durable custom title');
  await saved(a=>a.conversations.find(c=>c.id===chatA)?.title==='사용자가 정한 프로젝트 이름');
  const staleId=randomUUID();await exchange({type:'conversation.rename',conversationId:chatA,title:'stale overwrite',expectedTitle:'첫 번째 합성 요청',clientRequestId:staleId},m=>m.type==='conversation.rename.result'&&m.clientRequestId===staleId&&!m.ok,'stale title rejected');
  const missingId=randomUUID();await exchange({type:'conversation.rename',conversationId:'missing-chat',title:'not saved',expectedTitle:'',clientRequestId:missingId},m=>m.type==='conversation.rename.result'&&m.clientRequestId===missingId&&!m.ok,'foreign conversation rejected');
  await new Promise(r=>setTimeout(r,350));
  const historyFile=path.join(scratch,'.local-data','history.json'),historySaved=path.join(scratch,'.local-data','history-saved.json');assert.equal(path.dirname(historyFile),path.join(scratch,'.local-data'));await rename(historyFile,historySaved);await mkdir(historyFile);
  const failedId=randomUUID();await exchange({type:'conversation.rename',conversationId:chatA,title:'must not claim saved',expectedTitle:'사용자가 정한 프로젝트 이름',clientRequestId:failedId},m=>m.type==='conversation.rename.result'&&m.clientRequestId===failedId&&!m.ok,'storage failure is not success');assert.equal(last('bridge.state').snapshot.conversations.find(c=>c.id===chatA).title,'사용자가 정한 프로젝트 이름');await rmdir(historyFile);await rename(historySaved,historyFile);
  const threadA = last("bridge.state").snapshot.threadId;
  await exchange({ type: "project.select", path: projectB }, (message) => message.type === "project.selected", "project B");
  const chatB = last("bridge.state").snapshot.activeConversationId;
  assert.notEqual(chatA, chatB);
  const defaultId=randomUUID();await exchange({type:'conversation.rename',conversationId:chatB,title:'새 대화',expectedTitle:'새 대화',clientRequestId:defaultId},m=>m.type==='conversation.rename.result'&&m.clientRequestId===defaultId&&m.ok,'user default-label name');await turn('이 요청이 사용자 제목을 덮어쓰지 않음');assert.equal(last('bridge.state').snapshot.conversations.find(c=>c.id===chatB).title,'새 대화');
  await exchange({ type: "conversation.select", conversationId: chatA }, (message) => message.type === "conversation.state" && message.state.id === chatA, "restore project A");
  assert.equal(last("bridge.state").snapshot.projectPath, projectA);
  assert.equal(last("conversation.state").state.messages.length, 2);
  await turn("두 번째 합성 요청");
  assert.equal(last('bridge.state').snapshot.conversations.find(c=>c.id===chatA).title,'사용자가 정한 프로젝트 이름');
  await saved((archive) => archive.conversations.find((chat) => chat.id === chatA)?.messages.length === 4);
  await stop();
  await start();
  assert.equal(last("bridge.state").snapshot.activeConversationId, chatA);
  assert.equal(last('bridge.state').snapshot.conversations.find(c=>c.id===chatA).title,'사용자가 정한 프로젝트 이름');
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
  await exchange({ type: "project.select", path: projectA }, (message) => message.type === "project.selected", "project A for stop during start");
  const interruptBoundary = received.length;
  send({type:"turn.start",prompt:"HOLD_START_FOR_INTERRUPT",skillMode:"auto",executionMode:"solo"});
  send({type:"turn.interrupt"});
  await until(() => received.slice(interruptBoundary).some(message => message.type === "turn.state" && message.status === "interrupted"), "stop during delayed turn start");
  const finalCalls = (await readFile(requests,"utf8")).trim().split("\n").map(JSON.parse);
  assert(finalCalls.some(call => call.method === "turn/interrupt"));
  console.log("PASS: durable custom titles, stale/missing rename rejection, project switching, transcript restore, durable thread resume, partial team recovery, expired approval rejection, network disabled, interrupt during delayed start.");
} finally { await stop(); }
