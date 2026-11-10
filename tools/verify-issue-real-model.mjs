import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, realpath, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { AnalysisTransport } from '../build-server/server/issues/analysis-transport.js';
import { AnalysisDraft } from '../build-server/server/issues/analysis-draft.js';
import { parseSegmentRequirements } from '../build-server/server/issues/analysis-output.js';
import { requireCompatibleAnalysisRequirements, requireNoConfiguredAnalysisHooks, requireNoListedAnalysisHooks } from '../build-server/server/issues/analysis-tool-policy.js';
import { resolveCodexLaunch } from '../build-server/server/codex-app-server.js';
import { buildSemanticValidationRequest, captureSemanticInput, parseSemanticFindings } from '../build-server/server/issues/semantic-validation.js';
import { buildPlanningProposalRequest, parsePlanningProposals } from '../build-server/server/issues/planning-proposal.js';
import { PlanningDraft } from '../build-server/server/issues/planning-draft.js';

// Direct invocation sends synthetic text. Worker mode receives only bridge-owned
// source text and returns model output over the private parent process pipe.
const workerMode = process.argv.length === 3 && process.argv[2] === '--worker';
if (process.argv.length > 2 && !workerMode) throw new Error('Unsupported invocation.');
async function failBeforeStart(message) {
  if (!workerMode) throw new Error(message);
  await new Promise(resolve => process.stdout.write(`${JSON.stringify({ ok: false, phase: 'startup', kind: 'operation', termination: 'confirmed' })}\n`, resolve));
  process.stdin.destroy(); process.exit(1);
}
if (process.platform !== 'win32') await failBeforeStart('This smoke test currently supports Windows only.');
const cancelled = new AbortController();
let input = null;
if (workerMode) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try { input = await new Promise((resolve, reject) => {
    let first = true;
    lines.on('line', line => {
      if (!first) { if (line === '{"cancel":true}') cancelled.abort(); return; }
      first = false;
      try {
        if (Buffer.byteLength(line, 'utf8') > 131072) throw new Error('Input too large');
        const value = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.model !== 'string' || !value.model || value.model.length > 200 || /[\x00-\x1f\x7f]/.test(value.model)) throw new Error('Invalid input');
        const keys = Object.keys(value).sort().join(',');
        if (keys === 'instruction,model,text') {
          if (typeof value.text !== 'string' || !value.text || value.text.length > 8192 || value.text.includes('\0') || typeof value.instruction !== 'string' || value.instruction.length > 1024 || value.instruction.includes('\0')) throw new Error('Invalid input');
        } else if (keys === 'document,kind,model,text' && value.kind === 'semantic') {
          if (typeof value.text !== 'string' || !value.text || value.text.length > 8192 || value.text.includes('\0')) throw new Error('Invalid input');
          const segment = { snapshotId: 'synthetic', projectRevision: 1, sourceId: 'synthetic', sourcePath: 'synthetic.txt', sourceSha256: 'a'.repeat(64), segmentId: 'synthetic', offset: 0, text: value.text };
          captureSemanticInput({ projectRevision: 1, draftRevision: 1, document: value.document, segment });
        } else if (keys === 'document,kind,model,request' && value.kind === 'proposal') {
          const snapshot = new PlanningDraft(value.document, 1).read(); buildPlanningProposalRequest(snapshot, value.request);
        } else throw new Error('Invalid input');
        resolve(value);
      } catch { reject(new Error('Invalid worker input')); }
    });
    lines.once('close', () => { cancelled.abort(); if (first) reject(new Error('Worker input closed')); });
  }); } catch { await failBeforeStart('Invalid worker input'); }
}
const scratchRoot = path.resolve('.cache');
let workspace, child;
async function removeEmptyWorkspace() {
  if (!workspace) return true;
  try {
    const info = await lstat(workspace), actual = await realpath(workspace), parent = await realpath(scratchRoot);
    if (!info.isDirectory() || info.isSymbolicLink() || actual.toLowerCase() !== path.resolve(workspace).toLowerCase() || path.dirname(actual).toLowerCase() !== parent.toLowerCase() || !path.basename(actual).startsWith('issue-real-model-')) return false;
    await rmdir(actual); // Only an empty directory is removed; never recurse into user data.
    return true;
  } catch { return false; }
}
try {
  for (const name of ['OPENAI_BASE_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) if (process.env[name]) throw new Error('Provider or proxy override');
  await mkdir(scratchRoot, { recursive: true });
  workspace = await mkdtemp(path.join(scratchRoot, 'issue-real-model-'));
  assert.equal((await lstat(workspace)).isSymbolicLink(), false);
  assert.equal((await realpath(workspace)).toLowerCase(), workspace.toLowerCase());
  assert.equal(path.dirname(await realpath(workspace)).toLowerCase(), (await realpath(scratchRoot)).toLowerCase());
  const launch = resolveCodexLaunch();
  const restrictions = ['--disable', 'plugins', '--disable', 'hooks', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps'];
  const args = launch.args[0] === '/d' && launch.args[2] === '/c' ? [...launch.args.slice(0, 3), `${launch.args[3]} ${restrictions.join(' ')}`] : [...launch.args, ...restrictions];
  child = spawn(launch.command, args, { cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
} catch { await removeEmptyWorkspace(); await failBeforeStart('Analysis startup unavailable'); }
child.stderr.resume();
const pending = new Map(); let next = 0, transport = null, phase = 'initialize', result = null, failure = null;
let stopPromise = null, stopConfirmed = false, spawnFailed = false;
const exited = once(child, 'exit').then(() => true, () => false);
child.once('error', () => { spawnFailed = !child.pid; for (const entry of pending.values()) entry.reject(new Error('App Server launch failed')); pending.clear(); });
child.once('exit', () => { for (const entry of pending.values()) entry.reject(new Error('App Server exited')); pending.clear(); });
child.stdin.on('error', () => { cancelled.abort(); for (const entry of pending.values()) entry.reject(new Error('App Server input closed')); pending.clear(); });
const send = (method, params, timeoutMs = 20000) => new Promise((resolve, reject) => {
  if (workerMode && cancelled.signal.aborted) { reject(new Error('Analysis cancelled')); return; }
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout')); }, timeoutMs);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  try { child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); } catch { clearTimeout(timer); pending.delete(id); reject(new Error('RPC write failed')); }
});
function stopAndWait() {
  if (stopPromise) return stopPromise;
  stopPromise = (async () => {
    if (spawnFailed && !child.pid) { stopConfirmed = true; return; }
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw new Error('Termination not confirmed');
    const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    if (killed.status !== 0 || !await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(false), 5000))])) throw new Error('Termination not confirmed');
    stopConfirmed = true;
  })();
  return stopPromise;
}
createInterface({ input: child.stdout }).on('line', line => {
  if (Buffer.byteLength(line, 'utf8') > 2 * 1024 * 1024) { cancelled.abort(); for (const entry of pending.values()) entry.reject(new Error('App Server response too large')); pending.clear(); return; }
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.id !== undefined && typeof message.method !== 'string') {
    const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id);
    if (message.error) entry.reject(new Error('RPC failed')); else entry.resolve(message.result);
  } else if (typeof message.method === 'string' && message.id === undefined) transport?.notification(message);
  else if (typeof message.method === 'string' && message.id !== undefined && !transport?.serverRequest(message)) {
    try { child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32003, message: 'Smoke test does not permit tool requests.' } })}\n`); } catch { /* A failed denial is not success. */ }
  }
});
try {
  await send('initialize', { clientInfo: { name: 'auto-codex-issue-smoke', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  phase = 'requirements';
  const requirements = await send('configRequirements/read', null);
  requireCompatibleAnalysisRequirements(requirements);
  phase = 'hooks';
  const hooks = await send('hooks/list', { cwds: [workspace] });
  requireNoListedAnalysisHooks(hooks, workspace);
  phase = 'configuration';
  const response = await send('config/read', { cwd: workspace, includeLayers: false });
  requireNoConfiguredAnalysisHooks(response);
  assert.ok(response?.config && typeof response.config === 'object' && !Array.isArray(response.config));
  const config = response.config;
  const providerName = config.model_provider ?? 'openai';
  assert.equal(providerName, 'openai', 'Only the configured OpenAI provider is supported by this smoke test');
  const provider = config.model_providers?.[providerName];
  for (const base of [provider?.base_url, config.openai_base_url, config.chatgpt_base_url]) if (base !== undefined && base !== null) {
    assert.equal(typeof base, 'string');
    const url = new URL(base);
    assert.ok(url.protocol === 'https:' && ['api.openai.com', 'chatgpt.com'].includes(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443'));
  }
  const servers = config.mcp_servers ?? {};
  assert.ok(servers && typeof servers === 'object' && !Array.isArray(servers) && Object.keys(servers).length <= 512);
  const deny = { 'features.apps': false, 'features.code_mode': false, 'features.code_mode_only': false, 'features.context_management': false, 'features.current_time_reminder': false, 'features.deferred_executor': false, 'features.enable_fanout': false, 'features.goals': false, 'features.hooks': false, 'features.image_generation': false, 'features.memories': false, 'features.multi_agent': false, 'features.multi_agent_v2': false, 'features.plugins': false, 'features.request_permissions_tool': false, 'features.shell_snapshot': false, 'features.shell_tool': false, 'features.standalone_web_search': false, 'features.token_budget': false, 'features.tool_suggest': false, 'features.unified_exec': false, 'features.view_image': false, 'cloud.skills.enabled': false, 'skills.include_instructions': false, 'tools.experimental_request_user_input.enabled': false, 'tools.update_plan.enabled': false, 'web_search': 'disabled', 'project_doc_max_bytes': 0 };
  for (const name of Object.keys(servers)) { assert.match(name, /^[A-Za-z0-9_-]{1,64}$/); deny[`mcp_servers.${name}.enabled`] = false; }
  phase = 'model-list';
  const models = await send('model/list', { limit: 50, includeHidden: false });
  const entries = Array.isArray(models?.data) ? models.data.filter(item => typeof item?.model === 'string' && item.model.length <= 200) : [];
  const model = workerMode ? entries.find(item => item.model === input.model) : entries.find(item => item.isDefault) ?? entries[0];
  assert.ok(model?.model, 'No model is available');
  if (workerMode) {
    phase = 'recheck-requirements';
    const freshRequirements = await send('configRequirements/read', null);
    phase = 'recheck-hooks';
    const freshHooks = await send('hooks/list', { cwds: [workspace] });
    phase = 'recheck-config';
    const freshConfig = await send('config/read', { cwd: workspace, includeLayers: false });
    requireCompatibleAnalysisRequirements(freshRequirements);
    requireNoConfiguredAnalysisHooks(freshConfig);
    requireNoListedAnalysisHooks(freshHooks, workspace);
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const fingerprint = value => { const raw = JSON.stringify(value); assert.ok(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= 2 * 1024 * 1024); const serialized = JSON.stringify(canonical(value)); return createHash('sha256').update(serialized).digest('hex'); };
    phase = 'recheck-requirements-compare'; assert.equal(fingerprint(requirements), fingerprint(freshRequirements), 'Requirements changed');
    phase = 'recheck-hooks-compare'; assert.equal(fingerprint(hooks), fingerprint(freshHooks), 'Hooks changed');
    phase = 'recheck-config-compare'; assert.equal(fingerprint(response), fingerprint(freshConfig), 'Configuration changed');
    if (cancelled.signal.aborted) throw new Error('Analysis cancelled');
  }
  const segment = { snapshotId: 'synthetic', projectRevision: 1, sourceId: 'synthetic', sourcePath: 'synthetic.txt', sourceSha256: 'a'.repeat(64), segmentId: 'synthetic', offset: 0, text: workerMode ? input.kind === 'proposal' ? 'proposal' : input.text : 'The synthetic app must show a status message.', instruction: workerMode && input.kind !== 'semantic' && input.kind !== 'proposal' ? input.instruction : '' };
  const semantic = workerMode && input.kind === 'semantic' ? captureSemanticInput({ projectRevision: 1, draftRevision: 1, document: input.document, segment }) : null;
  const proposal = workerMode && input.kind === 'proposal' ? new PlanningDraft(input.document, 1).read() : null;
  const draft = new AnalysisDraft(segment.snapshotId, 1, 1, async () => segment);
  let admission = false;
  transport = new AnalysisTransport({ request: send, respondError: (id, code, message) => child.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`), stopAndWait }, { cwd: workspace, model: model.model, config: deny, disabledPluginIds: [], canRun: () => true, acquire: () => { if (admission) return null; admission = true; return () => { admission = false; }; }, timeoutMs: 120000, ...(semantic ? { buildRequest: () => buildSemanticValidationRequest(semantic) } : proposal ? { buildRequest: () => buildPlanningProposalRequest(proposal, input.request) } : {}) });
  phase = 'model-call';
  if (workerMode) {
    const output = await transport.run(segment, cancelled.signal);
    if (semantic) parseSemanticFindings(output, semantic); else if (proposal) parsePlanningProposals(output, proposal); else parseSegmentRequirements(output, segment);
    assert.equal(admission, false, 'The analysis run remained admitted');
    result = { output };
  } else {
    await draft.runNext((value, signal) => transport.run(value, signal));
    const status = draft.inspect();
    assert.equal(status.processedSegments, 1, 'The synthetic model result was not accepted');
    assert.equal(admission, false, 'The synthetic run remained admitted');
    result = { model: model.model, processedSegments: status.processedSegments, candidateCount: status.segments[0].requirements.length };
  }
} catch (error) {
  failure = { phase, kind: error?.name === 'AssertionError' ? 'validation' : 'operation' };
} finally {
  try { await stopAndWait(); } catch { if (!failure) failure = { phase: 'shutdown', kind: 'termination-unconfirmed' }; }
  child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
  if (stopConfirmed && !await removeEmptyWorkspace() && !failure) failure = { phase: 'cleanup', kind: 'operation' };
}
if (workerMode) {
  process.stdout.write(`${JSON.stringify(failure ? { ok: false, phase: failure.phase, kind: failure.kind, termination: stopConfirmed ? 'confirmed' : 'unconfirmed' } : { ok: true, ...result, termination: 'confirmed' })}\n`);
  process.exitCode = failure ? 1 : 0;
  process.stdin.destroy();
} else {
  if (failure) throw new Error(`Real model smoke failed: phase=${failure.phase}; kind=${failure.kind}; termination=${stopConfirmed ? 'confirmed' : 'unconfirmed'}.`);
  console.log(JSON.stringify({ status: 'completed', ...result, termination: 'confirmed' }));
}
