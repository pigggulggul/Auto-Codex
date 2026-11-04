import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { IssueStore } from '../build-server/server/issues/store.js';

// No real Codex process or user project is used. Run after npm run build.
const parent = path.resolve('.cache'); await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'issue-bridge-integration-'));
const workspace = path.join(root, 'workspace'); await mkdir(workspace);
await cp(path.resolve('build-server'), path.join(root, 'build-server'), { recursive: true });
await cp(path.resolve('tools/fixtures/history-app-server.mjs'), path.join(root, 'app-server'));
const previewMode = process.argv.includes('--preview');
let port = 4781;
if (!previewMode) {
  const temporary = createServer(); await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve));
  port = temporary.address().port; await new Promise(resolve => temporary.close(resolve));
}
const child = spawn(process.execPath, [path.join(root, 'build-server/server/index.js')], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, AUTO_CODEX_PORT: String(port), CODEX_BIN: process.execPath, AUTO_CODEX_TEST_REQUESTS: path.join(root, 'requests.jsonl') },
});
let listening = false; child.stdout.on('data', data => { if (String(data).includes('Auto Codex bridge')) listening = true; });
// Keep diagnostic content private; only the outcome is reported.
child.stderr.on('data', () => {});
let ui, originless;
async function until(check) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Synthetic bridge did not respond in time');
}
async function connect(origin) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
  const messages = []; socket.on('message', data => messages.push(JSON.parse(String(data))));
  await once(socket, 'open'); return { socket, messages };
}
async function ask(connection, type, extra = {}) {
  const clientRequestId = randomUUID();
  connection.socket.send(JSON.stringify({ type, v: 1, clientRequestId, ...extra }));
  await until(() => connection.messages.some(item => item.type === 'issues.project.result' && item.clientRequestId === clientRequestId));
  return connection.messages.find(item => item.type === 'issues.project.result' && item.clientRequestId === clientRequestId);
}
try {
  await until(() => listening);
  ui = await connect(`http://127.0.0.1:${port}`);
  await until(() => ui.messages.some(item => item.type === 'bridge.state'));
  assert.equal((await ask(ui, 'issues.project.status')).error.code, 'PROJECT_REQUIRED');
  ui.socket.send(JSON.stringify({ type: 'project.select', path: workspace }));
  await until(() => ui.messages.some(item => item.type === 'project.selected'));
  await until(() => ui.messages.some(item => item.type === 'bridge.state' && item.snapshot.projectPath === workspace));
  const generation = ui.messages.findLast(item => item.type === 'bridge.state').snapshot.projectSelectionGeneration;
  ui.socket.send(JSON.stringify({ type: 'project.select', path: workspace }));
  await until(() => ui.messages.some(item => item.type === 'bridge.state' && item.snapshot.projectSelectionGeneration > generation));
  const result = await ask(ui, 'issues.project.status');
  assert.equal(result.ok, true); assert.equal(result.bound, false);
  assert.ok(!JSON.stringify(result).includes(workspace));
  const forged = await ask(ui, 'issues.project.bind', { path: workspace, permissions: 'all' });
  assert.equal(forged.ok, false);
  assert.equal((await ask(ui, 'issues.document.import', { path: workspace })).ok, false);
  assert.equal((await ask(ui, 'issues.view.query', { query: { kind: 'documents' } })).error.code, 'VIEW_AUTH_REQUIRED');
  originless = await connect();
  assert.equal((await ask(originless, 'issues.project.status')).ok, false);
  assert.equal((await ask(originless, 'issues.project.bind')).ok, false);
  assert.equal((await ask(originless, 'issues.document.import')).ok, false);
  assert.equal((await ask(originless, 'issues.view.query', { query: { kind: 'documents' } })).ok, false);
  console.log('Issue bridge integration passed: selection, status, forged fields and originless rejection.');
  if (previewMode) {
    const store = await IssueStore.open(root);
    try { await store.createProject(workspace); } finally { store.close(); }
    console.log('Synthetic issue preview is ready on 127.0.0.1:4781 for 45 seconds.');
    await new Promise(resolve => { const timer = setTimeout(resolve, 45_000); process.once('SIGINT', () => { clearTimeout(timer); resolve(); }); });
  }
} finally {
  ui?.socket.close(); originless?.socket.close();
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  assert.equal(path.dirname(await realpath(root)), await realpath(parent));
  await rm(root, { recursive: true, force: true });
}
