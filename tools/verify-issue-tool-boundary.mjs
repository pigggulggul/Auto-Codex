import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { buildUnverifiedAnalysisToolPolicy, requireCompatibleAnalysisRequirements, requireNoListedAnalysisHooks } from '../build-server/server/issues/analysis-tool-policy.js';
import { buildSegmentAnalysisRequest } from '../build-server/server/issues/analysis-request.js';
import { AnalysisDraft } from '../build-server/server/issues/analysis-draft.js';
import { AnalysisTransport } from '../build-server/server/issues/analysis-transport.js';
import { classifyProbeFailure, createProbeDeadline, describeProbeFailure, describeProbeObservations, ProbeTimeoutError, waitForProbeTurn } from './issue-probe-control.mjs';

// This probe invokes the installed CLI with a new temporary CODEX_HOME and a fake
// loopback Responses provider. It never uses the user's project, account or model.
if (process.platform !== 'win32') throw new Error('This probe currently targets Windows.');
// Match server/codex-app-server.ts: Windows resolves the default codex.cmd through cmd.exe.
const executable = process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
if (!path.isAbsolute(executable)) throw new Error('Windows command processor was not found.');
const parent = path.resolve('.cache'); await mkdir(parent, { recursive: true });
const scratch = await mkdtemp(path.join(parent, 'issue-tool-probe-'));
const codexHome = path.join(scratch, 'codex-home'), workspace = path.join(scratch, 'workspace'), temp = path.join(scratch, 'temp');
await Promise.all([mkdir(codexHome), mkdir(workspace), mkdir(temp)]);
assert.equal((await lstat(scratch)).isSymbolicLink(), false);
assert.equal((await realpath(scratch)).toLowerCase(), path.resolve(scratch).toLowerCase());
assert.equal(path.dirname(await realpath(scratch)).toLowerCase(), (await realpath(parent)).toLowerCase());
// These paths appear only in a synthetic shell command; reject shell metacharacters.
assert.ok(!/[\r\n"%$!&|<>^`]/.test(scratch));
await writeFile(path.join(workspace, 'AGENTS.md'), 'SYNTHETIC_UNSELECTED_PROJECT_CONTEXT_4B65');
await writeFile(path.join(codexHome, 'AGENTS.md'), 'SYNTHETIC_UNSELECTED_HOME_CONTEXT_4B65');
await mkdir(path.join(workspace, '.agents', 'plugins'), { recursive: true });
await mkdir(path.join(workspace, 'plugins', 'synthetic-plugin', '.codex-plugin'), { recursive: true });
await writeFile(path.join(workspace, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: 'synthetic-local', plugins: [{ name: 'synthetic-plugin', source: { source: 'local', path: './plugins/synthetic-plugin' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }));
await writeFile(path.join(workspace, 'plugins', 'synthetic-plugin', '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'synthetic-plugin', version: '1.0.0', description: 'Synthetic local inventory fixture.', mcpServers: './.mcp.json' }));
await writeFile(path.join(workspace, 'plugins', 'synthetic-plugin', '.mcp.json'), JSON.stringify({ mcpServers: { plugin_fixture: { command: process.execPath, args: [path.resolve('tools/fixtures/issue-tool-probe-mcp.mjs'), path.join(scratch, 'synthetic-plugin-calls.txt')] } } }));
const observations = [], contextObservations = [], toolOutputClasses = [], commandOutputMarkers = [], serverRequests = [], syntheticNetworkHits = new Map(), commandRequestShapes = new Map(); let activeCase = '', caseRequests = 0, analysisInputObserved = false, analysisSchemaObserved = false, privatePathObserved = false, selectedEnvironmentIds = [];
const fake = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/synthetic-command-network-probe' && request.socket.remoteAddress === '127.0.0.1') { syntheticNetworkHits.set(activeCase, (syntheticNetworkHits.get(activeCase) || 0) + 1); response.writeHead(204).end(); return; }
  if (request.method !== 'POST' || request.url !== '/v1/responses' || request.socket.remoteAddress !== '127.0.0.1') { response.writeHead(404).end(); return; }
  const chunks = []; let length = 0;
  request.on('data', chunk => { length += chunk.length; if (length > 2_000_000) request.destroy(); else chunks.push(chunk); });
  request.on('end', () => {
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { response.writeHead(400).end(); return; }
    observations.push((Array.isArray(body.tools) ? body.tools : []).map(tool => ({ type: tool.type, name: tool.name || tool.function?.name || tool.namespace || null, ...(Array.isArray(tool.tools) ? { tools: tool.tools.map(item => ({ type: item.type, name: item.name })) } : {}) })));
    const serialized = JSON.stringify(body);
    if (activeCase === 'analysis-e2e' || activeCase.startsWith('analysis-command-')) {
      analysisInputObserved = serialized.includes('Synthetic selected source') && serialized.includes('Synthetic request');
      analysisSchemaObserved = serialized.includes('requirements') && serialized.includes('json_schema');
      privatePathObserved = serialized.includes('synthetic-private-path.md');
    }
    contextObservations.push({ projectInstructionsVisible: serialized.includes('SYNTHETIC_UNSELECTED_PROJECT_CONTEXT_4B65'), homeInstructionsVisible: serialized.includes('SYNTHETIC_UNSELECTED_HOME_CONTEXT_4B65') });
    const outputs = (Array.isArray(body.input) ? body.input : []).filter(item => item?.type === 'function_call_output').map(item => JSON.stringify(item.output));
    toolOutputClasses.push(outputs.map(value => /unknown|not found|not configured|unsupported|unrecognized/i.test(value) ? 'unknown-or-unavailable' : /denied|reject|approval/i.test(value) ? 'denied' : /error|failed|invalid/i.test(value) ? 'error' : 'other'));
    commandOutputMarkers.push(outputs.some(value => value.includes('SYNTHETIC_APPROVED_COMMAND')));
    const id = `resp_${randomUUID()}`, forced = caseRequests++ === 0 && activeCase.endsWith('-forced');
    const syntheticOutput = activeCase === 'analysis-e2e' || activeCase.startsWith('analysis-command-') ? JSON.stringify({ requirements: [{ origin: 'source', text: 'Synthetic requirement', quote: 'Synthetic selected source', uncertainty: '' }] }) : '{"requirements":[]}';
    const commandMarker = /^(command-escalated-(accept|decline)-local|analysis-command-(accept|decline))-forced$/.test(activeCase) ? path.join(scratch, `${activeCase}.txt`) : null;
    const syntheticCommand = activeCase.startsWith('command-network-') ? `curl.exe --silent --max-time 3 http://127.0.0.1:${fake.address().port}/synthetic-command-network-probe` : commandMarker ? `echo SYNTHETIC_APPROVED_COMMAND > "${commandMarker}"` : 'echo SYNTHETIC_APPROVED_COMMAND';
    const item = forced ? { id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', ...(activeCase.startsWith('request-user-') ? { name: 'request_user_input', arguments: JSON.stringify({ questions: [{ id: 'synthetic', header: 'Synthetic', question: 'Synthetic question?', options: [{ label: 'A', description: 'Synthetic A' }, { label: 'B', description: 'Synthetic B' }] }] }) } : activeCase.startsWith('command-') || activeCase.startsWith('analysis-command-') ? { name: 'exec_command', arguments: JSON.stringify({ cmd: syntheticCommand, sandbox_permissions: activeCase.startsWith('command-default-') ? 'use_default' : 'require_escalated', justification: 'Synthetic command approval control.' }) } : { name: 'synthetic_fixture_tool', namespace: activeCase.startsWith('plugin-') ? 'mcp__plugin_fixture' : 'mcp__synthetic_fixture', arguments: '{}' }), call_id: `call_${randomUUID()}` } : { id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: syntheticOutput, annotations: [] }] };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const emit = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    emit('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
    emit('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', ...(forced ? { arguments: '' } : { content: [] }) } });
    if (!forced) emit('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
    emit('response.output_item.done', { output_index: 0, item });
    emit('response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    response.end();
  });
});
let child, cancelled = false, deadline, rejectPending = () => {}, helperTerminationUnconfirmed = false, confirmedStopped = false;
let phase = 'starting', primaryFailure = null, cleanupFailure = null, terminationResult = 'not-started', turnCompletions = 0; const signals = new Set(), commandEvidence = [];
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic loopback listener timed out.')), 5000);
    fake.once('error', error => { clearTimeout(timer); reject(error); });
    fake.listen(0, '127.0.0.1', () => { clearTimeout(timer); resolve(); });
  });
  const port = fake.address().port;
  const quote = value => JSON.stringify(value);
  const mcp = path.resolve('tools/fixtures/issue-tool-probe-mcp.mjs');
  const marker = path.join(scratch, 'synthetic-tool-calls.txt');
  const config = [
    'model = "synthetic-model"', 'model_provider = "synthetic"', 'check_for_update_on_startup = false', 'web_search = "disabled"',
    '[features]', 'shell_tool = false', 'unified_exec = false', 'apps = false',
    '[model_providers.synthetic]', 'name = "Synthetic loopback provider"', `base_url = "http://127.0.0.1:${port}/v1"`, 'wire_api = "responses"', 'env_key = "SYNTHETIC_ISSUE_KEY"', 'supports_websockets = false',
    '[mcp_servers.synthetic_fixture]', `command = ${quote(process.execPath)}`, `args = [${quote(mcp)}, ${quote(marker)}]`, 'enabled = true', 'default_tools_approval_mode = "approve"',
    '[mcp_servers.synthetic_extra]', `command = ${quote(process.execPath)}`, `args = [${quote(mcp)}]`, 'enabled = true', 'default_tools_approval_mode = "approve"',
    '[plugins."synthetic-plugin@synthetic-local"]', 'enabled = true',
    '[plugins."synthetic-plugin@synthetic-local".mcp_servers.plugin_fixture]', 'default_tools_approval_mode = "approve"',
  ].join('\n');
  await writeFile(path.join(codexHome, 'config.toml'), config);
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATH: process.env.PATH, USERPROFILE: scratch, APPDATA: scratch, LOCALAPPDATA: scratch, TEMP: temp, TMP: temp, CODEX_HOME: codexHome, SYNTHETIC_ISSUE_KEY: 'synthetic-only' };
  const versionResult = spawnSync(executable, ['/d', '/s', '/c', 'codex --version'], { cwd: workspace, env, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  const version = /^codex-cli [0-9A-Za-z.+-]+$/.test(versionResult.stdout?.trim() || '') ? versionResult.stdout.trim() : 'unreported';
  // Inspect only the synthetic startup-report shape; never print configuration values.
  const startupResult = spawnSync(executable, ['/d', '/s', '/c', 'codex app-server --print-startup-config'], { cwd: workspace, env, encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
  if (startupResult.status === null) helperTerminationUnconfirmed = true;
  let startupReport = { status: 'unavailable', keys: [], requirementsType: 'unknown', requirementsKeys: [] };
  if (startupResult.status === 0) {
    try { const parsed = JSON.parse(startupResult.stdout); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { const requirements = parsed.configRequirements; startupReport = { status: 'parsed', keys: Object.keys(parsed).sort(), requirementsType: requirements === null ? 'null' : Array.isArray(requirements) ? 'array' : typeof requirements, requirementsKeys: requirements && typeof requirements === 'object' && !Array.isArray(requirements) ? Object.keys(requirements).sort() : [] }; } } catch { /* Treat malformed or unsupported reports as unavailable. */ }
  }
  // Check whether a synthetic Windows system-policy location is reflected; failure is
  // inconclusive, not proof that requirements cannot be active through other layers.
  const fakeProgramData = path.join(scratch, 'program-data');
  await mkdir(path.join(fakeProgramData, 'OpenAI', 'Codex'), { recursive: true });
  await writeFile(path.join(fakeProgramData, 'OpenAI', 'Codex', 'requirements.toml'), '[features]\nhooks = true\n');
  const policyResult = spawnSync(executable, ['/d', '/s', '/c', 'codex app-server --print-startup-config'], { cwd: workspace, env: { ...env, ProgramData: fakeProgramData }, encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
  if (policyResult.status === null) helperTerminationUnconfirmed = true;
  let syntheticPolicy = 'unavailable';
  if (policyResult.status === 0) {
    try { const value = JSON.parse(policyResult.stdout)?.configRequirements?.requirements?.featureRequirements?.hooks; syntheticPolicy = value === true ? 'reported-enabled' : value === false ? 'reported-disabled' : 'not-reported'; } catch { /* Do not expose the report. */ }
  }
  child = spawn(executable, ['/d', '/s', '/c', 'codex app-server'], { cwd: workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', data => { const text = String(data); if (/access.*denied|os error 5|EPERM/i.test(text)) signals.add('access-denied'); if (/failed to|error/i.test(text)) signals.add('cli-error'); }); // Do not echo diagnostics.
  const pending = new Map(), completed = new Map(), finalMessages = new Map(); let next = 0, analysisTransport = null;
  rejectPending = error => { for (const wait of pending.values()) wait.reject(error); pending.clear(); };
  child.once('exit', () => rejectPending(new Error('Synthetic CLI exited.')));
  child.once('error', () => rejectPending(new Error('Synthetic CLI could not start.')));
  createInterface({ input: child.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && typeof message.method !== 'string') { const wait = pending.get(message.id); if (!wait) return; pending.delete(message.id); if (message.error) wait.reject(new Error(`Synthetic RPC failed: ${message.error.code}`)); else wait.resolve(message.result); }
    if (typeof message.method === 'string' && message.id === undefined) analysisTransport?.notification(message);
    if (message.method === 'turn/completed' && typeof message.params?.turn?.id === 'string') { turnCompletions++; completed.set(message.params.turn.id, message.params.turn.status); }
    if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage' && typeof message.params?.turnId === 'string' && typeof message.params.item.text === 'string') finalMessages.set(message.params.turnId, message.params.item.text);
    if (message.id !== undefined && typeof message.method === 'string') {
      serverRequests.push(message.method);
      if (message.method === 'item/commandExecution/requestApproval' && /^command-(escalated|network)-(accept|decline)(-local)?-forced$/.test(activeCase)) {
        const params = message.params || {};
        commandRequestShapes.set(activeCase, { hasCommand: typeof params.command === 'string' && params.command.length > 0, hasCwd: typeof params.cwd === 'string' && params.cwd.length > 0, commandKind: params.kind === undefined || params.kind === 'command', environmentIdPresent: params.environmentId !== undefined && params.environmentId !== null, matchesSelectedEnvironment: typeof params.environmentId === 'string' && selectedEnvironmentIds.includes(params.environmentId), networkContext: params.networkApprovalContext !== undefined && params.networkApprovalContext !== null, networkAmendments: params.proposedNetworkPolicyAmendments !== undefined && params.proposedNetworkPolicyAmendments !== null });
        child.stdin.write(`${JSON.stringify({ id: message.id, result: { decision: activeCase.includes('-accept-') ? 'accept' : 'decline' } })}\n`);
      } else if (!analysisTransport?.serverRequest(message)) child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32003, message: 'Synthetic probe denies requests.' } })}\n`);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => { if (cancelled) { reject(new Error('Synthetic probe cancelled.')); return; } const id = ++next; pending.set(id, { resolve, reject }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); });
  deadline = createProbeDeadline(50_000, () => { cancelled = true; const error = new ProbeTimeoutError('Synthetic App Server probe timed out.'); rejectPending(error); return error; });
  const waitForTurn = turnId => waitForProbeTurn(completed, turnId, () => cancelled);
  const run = async () => {
    phase = 'initialize';
    await send('initialize', { clientInfo: { name: 'issue-tool-probe', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    // Check before plugin installation, MCP discovery or any thread can start.
    phase = 'managed-requirements';
    const requirementsRead = await send('configRequirements/read', null);
    requireCompatibleAnalysisRequirements(requirementsRead);
    phase = 'synthetic-hook-preflight';
    const initialConfig = await send('config/read', { cwd: workspace, includeLayers: false });
    assert.ok(initialConfig?.config && typeof initialConfig.config === 'object' && !Array.isArray(initialConfig.config), 'Synthetic effective configuration is unavailable.');
    const configuredHooks = initialConfig.config.hooks;
    assert.ok(configuredHooks === undefined || configuredHooks === null || typeof configuredHooks === 'object' && !Array.isArray(configuredHooks) && Object.keys(configuredHooks).length === 0, 'Synthetic effective configuration contains hooks; probe will not start a thread.');
    phase = 'synthetic-hook-discovery';
    const baselineHooks = await send('hooks/list', { cwds: [workspace] });
    requireNoListedAnalysisHooks(baselineHooks, workspace);
    const syntheticHooksPath = path.join(codexHome, 'hooks.json');
    await writeFile(syntheticHooksPath, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'synthetic-hook-never-execute' }] }] } }), { flag: 'wx' });
    let detectedHookCount = 0;
    try {
      const listed = await send('hooks/list', { cwds: [workspace] });
      assert.ok(Array.isArray(listed?.data) && listed.data.length === 1 && Array.isArray(listed.data[0]?.hooks) && Array.isArray(listed.data[0]?.errors) && listed.data[0].errors.length === 0, 'Synthetic hook list is invalid.');
      detectedHookCount = listed.data[0].hooks.length;
      assert.ok(detectedHookCount > 0, 'Synthetic hook was not discovered.');
      assert.throws(() => requireNoListedAnalysisHooks(listed, workspace), 'Synthetic hook was not rejected.');
    } finally {
      assert.equal((await lstat(syntheticHooksPath)).isSymbolicLink(), false);
      await rm(syntheticHooksPath);
    }
    const removedHooks = await send('hooks/list', { cwds: [workspace] });
    requireNoListedAnalysisHooks(removedHooks, workspace);
    phase = 'synthetic-plugin-install';
    let syntheticInstall = 'not-attempted';
    try { await send('plugin/install', { pluginName: 'synthetic-plugin', marketplacePath: path.join(workspace, '.agents', 'plugins', 'marketplace.json') }); syntheticInstall = 'completed'; } catch { syntheticInstall = 'unavailable'; }
    phase = 'inventory';
    const servers = [], pages = []; let cursor, pageCount = 0;
    do {
      const page = await send('mcpServerStatus/list', { limit: 1, detail: 'toolsAndAuthOnly', ...(cursor ? { cursor } : {}) });
      assert.ok(Array.isArray(page?.data), 'MCP inventory is not an array');
      pages.push({ cursor: cursor ?? null, response: page });
      servers.push(...page.data.map(server => ({ name: server.name, pluginId: server.pluginId ?? null, hasDiscoveryError: Boolean(server.toolsError) })));
      cursor = page.nextCursor ?? null; pageCount++;
      assert.ok(pageCount <= 16, 'MCP inventory did not terminate');
    } while (cursor);
    const plugins = await send('plugin/list', { cwds: [workspace], forceRefetch: false, marketplaceKinds: ['local'] });
    assert.ok(Array.isArray(plugins?.marketplaces), 'Plugin inventory is unavailable');
    const configRead = await send('config/read', { cwd: workspace, includeLayers: false });
    assert.ok(configRead?.config && typeof configRead.config === 'object', 'Effective config is unavailable');
    const syntheticPlugin = plugins.marketplaces.flatMap(market => market.plugins).find(plugin => plugin.id === 'synthetic-plugin@synthetic-local');
    const inventory = { syntheticInstall, servers, pages: pageCount, localPluginMarketplaces: plugins.marketplaces.length, localPluginCount: plugins.marketplaces.reduce((sum, market) => sum + market.plugins.length, 0), syntheticPluginListed: Boolean(syntheticPlugin), syntheticPluginInstalled: syntheticPlugin?.installed ?? null, syntheticPluginEnabled: syntheticPlugin?.enabled ?? null, pluginErrors: (plugins.marketplaceLoadErrors || []).length, configHasMcpServers: Object.hasOwn(configRead.config, 'mcp_servers') };
    assert.ok(servers.some(server => server.name === 'synthetic_extra') && servers.some(server => server.name === 'synthetic_fixture'));
    assert.equal(inventory.syntheticPluginListed, true, 'The synthetic local plugin was not listed.');
    assert.equal(inventory.syntheticInstall, 'completed', 'The synthetic plugin could not be installed.');
    assert.equal(inventory.syntheticPluginInstalled, true, 'The synthetic plugin was not installed.');
    assert.ok(servers.some(server => server.name === 'plugin_fixture' && server.pluginId === 'synthetic-plugin@synthetic-local'), 'The plugin MCP was not found in the inventory.');
    const policy = buildUnverifiedAnalysisToolPolicy(configRead, pages, plugins, requirementsRead, removedHooks, workspace);
    assert.equal(policy.verified, false); assert.equal(policy.serverCount, 2); assert.ok(policy.disabledPluginIds.includes('synthetic-plugin@synthetic-local'));
    // Keep the per-plugin-ID control independent of the global plugin switch.
    const pluginIdOnlyConfig = { ...policy.config };
    delete pluginIdOnlyConfig['features.plugins'];
    const knownToolsOff = { 'mcp_servers.synthetic_fixture.enabled': false, 'mcp_servers.synthetic_extra.enabled': false, 'features.multi_agent': false, 'features.goals': false, 'features.view_image': false, 'features.shell_tool': false, 'features.unified_exec': false, 'features.apps': false };
    const cases = []; let syntheticLocalEnvironmentId = null;
    for (const test of [
      { name: 'configured-mcp', config: undefined },
      { name: 'empty-mcp-map', config: { mcp_servers: {} } },
      { name: 'specific-mcp-disabled', config: { 'mcp_servers.synthetic_fixture.enabled': false } },
      { name: 'known-tools-disabled', config: knownToolsOff },
      { name: 'inventory-policy', config: pluginIdOnlyConfig, disabledPluginIds: policy.disabledPluginIds },
      { name: 'strict-context', config: { ...policy.config, 'features.plugins': false, 'features.hooks': false, 'project_doc_max_bytes': 0 }, disabledPluginIds: policy.disabledPluginIds },
      { name: 'plugins-disabled', config: { ...policy.config, 'features.plugins': false, 'features.hooks': false } },
      { name: 'command-enabled-empty-environment', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds },
      { name: 'command-default-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request' },
      { name: 'command-default-local-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request', localEnvironment: true },
      { name: 'command-escalated-decline-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request' },
      { name: 'command-escalated-accept-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request' },
      { name: 'command-escalated-decline-local-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request', localEnvironment: true },
      { name: 'command-escalated-accept-local-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request', localEnvironment: true },
      { name: 'command-network-decline-local-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request', localEnvironment: true },
      { name: 'command-network-accept-local-forced', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, approvalPolicy: 'on-request', localEnvironment: true },
      { name: 'configured-mcp-forced', config: undefined },
      { name: 'disabled-mcp-forced', config: knownToolsOff },
      { name: 'plugin-enabled-forced', config: knownToolsOff },
      { name: 'plugin-disabled-forced', config: pluginIdOnlyConfig, disabledPluginIds: policy.disabledPluginIds },
      { name: 'plugin-feature-disabled-forced', config: { ...policy.config, 'features.plugins': false, 'features.hooks': false } },
      { name: 'request-user-forced', config: knownToolsOff },
      { name: 'request-user-policy-forced', config: policy.config, disabledPluginIds: policy.disabledPluginIds },
    ]) {
      phase = `${test.name}-thread-start`; const previous = observations.length, previousServerRequests = serverRequests.length; activeCase = test.name; caseRequests = 0; selectedEnvironmentIds = [];
      try {
        const approvalPolicy = test.approvalPolicy || 'never';
        const started = await send('thread/start', { cwd: workspace, model: 'synthetic-model', sandbox: 'read-only', approvalPolicy, ephemeral: true, ...(!test.localEnvironment ? { environments: [] } : {}), ...(test.config ? { config: test.config } : {}) });
        assert.ok(started?.thread?.id, 'No synthetic thread ID');
        selectedEnvironmentIds = Array.isArray(started.thread.environments) ? started.thread.environments.map(entry => entry?.environmentId).filter(id => typeof id === 'string') : [];
        if (test.localEnvironment && selectedEnvironmentIds.length === 1) syntheticLocalEnvironmentId = selectedEnvironmentIds[0];
        phase = `${test.name}-turn-start`;
        const turn = await send('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'Synthetic issue text. Return an empty requirements array.', text_elements: [] }], sandboxPolicy: { type: 'readOnly', networkAccess: false }, approvalPolicy, ...(!test.localEnvironment ? { environments: [] } : {}), ...(test.disabledPluginIds ? { disabledPluginIds: test.disabledPluginIds } : {}) });
        assert.ok(turn?.turn?.id, 'No synthetic turn ID');
        phase = `${test.name}-turn-completion`;
        await waitForTurn(turn.turn.id);
        assert.ok(observations.length > previous, 'No synthetic provider request');
        let calls = 0; try { calls = (await readFile(marker, 'utf8')).trim().split('\n').filter(Boolean).length; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        let pluginCalls = 0; try { pluginCalls = (await readFile(path.join(scratch, 'synthetic-plugin-calls.txt'), 'utf8')).trim().split('\n').filter(Boolean).length; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        let commandMarkerWritten = false;
        if (/^command-escalated-(accept|decline)-local-forced$/.test(test.name)) {
          try { commandMarkerWritten = (await lstat(path.join(scratch, `${test.name}.txt`))).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const result = { name: test.name, tools: observations[previous], context: contextObservations[previous], providerRequests: observations.length - previous, toolOutputs: toolOutputClasses.slice(previous), commandOutputObserved: commandOutputMarkers.slice(previous).some(Boolean), commandMarkerWritten, syntheticNetworkHits: syntheticNetworkHits.get(test.name) || 0, approvalShape: commandRequestShapes.get(test.name) || null, serverRequests: serverRequests.slice(previousServerRequests), turnStatus: completed.get(turn.turn.id), syntheticMcpCalls: calls, syntheticPluginCalls: pluginCalls };
        cases.push(result);
        if (/^command-(default|escalated-accept|escalated-decline|network-accept|network-decline)(-local)?-forced$/.test(test.name)) commandEvidence.push({ name: test.name, completed: result.turnStatus === 'completed', providerRequests: result.providerRequests, approvalRequested: result.serverRequests.includes('item/commandExecution/requestApproval'), approvalShape: result.approvalShape, otherRequest: result.serverRequests.some(method => method !== 'item/commandExecution/requestApproval'), outputClasses: result.toolOutputs.flat(), commandOutputObserved: result.commandOutputObserved, commandMarkerWritten, syntheticNetworkHits: result.syntheticNetworkHits });
      } catch (error) {
        if (cancelled || test.name === 'configured-mcp') throw error;
        cases.push({ name: test.name, error: 'RPC_OR_PROBE_FAILED' });
      }
    }
    assert.ok(cases[0].tools.some(tool => tool.name === 'mcp__synthetic_fixture'), 'The configured synthetic MCP tool was not observed.');
    assert.ok(cases.find(item => item.name === 'empty-mcp-map')?.tools?.some(tool => tool.name === 'mcp__synthetic_fixture'), 'The empty-map merge behavior changed; review this boundary.');
    const disabled = cases.find(item => item.name === 'specific-mcp-disabled');
    assert.equal(disabled?.turnStatus, 'completed', 'The disabled-MCP visibility probe did not complete.');
    assert.ok(!disabled.tools.some(tool => tool.name === 'mcp__synthetic_fixture'), 'The disabled MCP tool remained visible.');
    assert.ok(disabled.tools.some(tool => tool.name === 'mcp__synthetic_extra'), 'The other MCP server was unexpectedly disabled.');
    assert.ok(cases.find(item => item.name === 'known-tools-disabled')?.tools?.some(tool => tool.name === 'mcp__plugin_fixture'), 'The enabled synthetic plugin MCP was not observed.');
    assert.deepEqual(cases.find(item => item.name === 'inventory-policy')?.tools?.map(tool => tool.name), [], 'The generated candidate did not remove all observed tools.');
    const strict = cases.find(item => item.name === 'strict-context');
    assert.equal(strict?.context?.homeInstructionsVisible, true, 'The synthetic global instruction observation changed.');
    assert.equal(strict?.context?.projectInstructionsVisible, false, 'The untrusted synthetic project instruction observation changed.');
    assert.deepEqual(cases.find(item => item.name === 'plugins-disabled')?.tools?.map(tool => tool.name), [], 'The synthetic plugin feature override did not remove all observed tools.');
    assert.equal(cases.find(item => item.name === 'command-enabled-empty-environment')?.turnStatus, 'completed', 'The command visibility control did not complete.');
    for (const name of ['command-escalated-decline-local-forced', 'command-escalated-accept-local-forced']) {
      phase = `${name}-assertions`;
      const command = cases.find(item => item.name === name);
      assert.equal(command?.turnStatus, 'completed', 'The synthetic command control did not complete.');
      assert.equal(command?.providerRequests, 2, 'The synthetic command result was not returned.');
      assert.ok(command.serverRequests.includes('item/commandExecution/requestApproval'), 'The synthetic command did not request approval.');
      assert.equal(command.commandMarkerWritten, name.includes('-accept-'), 'The synthetic marker did not match the approval decision.');
    }
    for (const name of ['command-network-decline-local-forced', 'command-network-accept-local-forced']) {
      phase = `${name}-assertions`;
      const command = cases.find(item => item.name === name);
      assert.equal(command?.turnStatus, 'completed', 'The synthetic network command did not complete.');
      assert.ok(command.serverRequests.includes('item/commandExecution/requestApproval'), 'The synthetic network command did not request approval.');
      assert.equal(command.syntheticNetworkHits, name.includes('-accept-') ? 1 : 0, 'The synthetic loopback request did not match the approval decision.');
    }
    const control = cases.find(item => item.name === 'configured-mcp-forced'), denied = cases.find(item => item.name === 'disabled-mcp-forced');
    assert.equal(control?.turnStatus, 'completed', 'The positive-control turn did not complete.');
    assert.equal(denied?.turnStatus, 'completed', 'The disabled-MCP turn did not complete.');
    assert.equal(control?.providerRequests, 2, 'The positive-control tool call was not observed.');
    assert.equal(denied?.providerRequests, 2, 'The disabled tool-call response was not observed.');
    assert.equal(control?.syntheticMcpCalls, 1, 'The synthetic MCP positive control did not execute.');
    assert.equal(denied?.syntheticMcpCalls, 1, 'Disabled synthetic MCP executed unexpectedly.');
    assert.ok(denied.toolOutputs.flat().includes('unknown-or-unavailable'), 'The disabled MCP call was not rejected as unavailable.');
    const pluginControl = cases.find(item => item.name === 'plugin-enabled-forced'), pluginDenied = cases.find(item => item.name === 'plugin-disabled-forced');
    assert.equal(pluginControl?.turnStatus, 'completed'); assert.equal(pluginControl?.syntheticPluginCalls, 1, 'The plugin MCP positive control did not execute.');
    assert.equal(pluginDenied?.turnStatus, 'completed'); assert.equal(pluginDenied?.syntheticPluginCalls, 1, 'The disabled plugin MCP executed unexpectedly.');
    assert.ok(pluginDenied.toolOutputs.flat().includes('unknown-or-unavailable'), 'The disabled plugin MCP was not rejected as unavailable.');
    const pluginFeatureDenied = cases.find(item => item.name === 'plugin-feature-disabled-forced');
    assert.equal(pluginFeatureDenied?.turnStatus, 'completed'); assert.equal(pluginFeatureDenied?.syntheticPluginCalls, 1, 'The globally disabled plugin MCP executed unexpectedly.');
    assert.ok(pluginFeatureDenied.toolOutputs.flat().includes('unknown-or-unavailable'), 'The globally disabled plugin MCP was not rejected as unavailable.');
    const input = cases.find(item => item.name === 'request-user-forced');
    assert.equal(input?.turnStatus, 'completed', 'The user-input probe did not complete.');
    assert.equal(input?.providerRequests, 2, 'The user-input response was not observed.');
    const deniedInput = cases.find(item => item.name === 'request-user-policy-forced');
    assert.equal(deniedInput?.turnStatus, 'completed', 'The disabled user-input probe did not complete.');
    assert.equal(deniedInput?.providerRequests, 2, 'The disabled user-input response was not observed.');
    assert.ok(!deniedInput.serverRequests.includes('item/tool/requestUserInput'), 'The disabled user-input request reached the client.');
    assert.ok(deniedInput.toolOutputs.flat().includes('unknown-or-unavailable'), 'The disabled user-input call was not rejected as unavailable.');
    phase = 'analysis-e2e'; activeCase = phase; caseRequests = 0;
    const segment = { snapshotId: 'synthetic-snapshot', projectRevision: 1, sourceId: 'synthetic-source', sourcePath: 'synthetic-private-path.md', sourceSha256: 'a'.repeat(64), segmentId: 'synthetic-segment', offset: 0, text: 'Synthetic selected source', instruction: 'Synthetic request' };
    const draft = new AnalysisDraft(segment.snapshotId, segment.projectRevision, 1, async () => segment);
    let admission = false;
    analysisTransport = new AnalysisTransport({ request: send, respondError: (id, code, message) => child.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`), stopAndWait: async () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw new Error('Synthetic termination unavailable.');
      const exited = once(child, 'exit').then(() => true, () => false);
      const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      if (killed.status !== 0 || !await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(false), 5000))])) throw new Error('Synthetic termination not confirmed.');
      confirmedStopped = true;
    } }, { cwd: workspace, model: 'synthetic-model', config: { ...policy.config, 'features.plugins': false, 'features.hooks': false }, disabledPluginIds: policy.disabledPluginIds, canRun: () => true, acquire: () => { if (admission) return null; admission = true; return () => { admission = false; }; }, timeoutMs: 15000 });
    await draft.runNext(async (value, signal) => {
      phase = 'analysis-e2e-build';
      const request = buildSegmentAnalysisRequest(value);
      assert.ok(!request.input[0].text.includes(segment.sourcePath));
      phase = 'analysis-e2e-transport';
      return analysisTransport.run(value, signal);
    });
    const draftResult = draft.inspect();
    if (draftResult.segments[0]?.status === 'failed') {
      const reason = draftResult.segments[0].error;
      if (['STALE_INPUT', 'INVALID_OUTPUT', 'MODEL_FAILED', 'LIMIT_EXCEEDED'].includes(reason)) phase = `analysis-e2e-${reason.toLowerCase().replaceAll('_', '-')}`;
    }
    assert.equal(admission, false, 'Synthetic transport admission was not released.');
    assert.equal(analysisInputObserved, true, 'The synthetic selected input did not reach the provider.');
    assert.equal(analysisSchemaObserved, true, 'The structured-output schema did not reach the provider.');
    assert.equal(privatePathObserved, false, 'The private source path reached the provider.');
    assert.equal(draftResult.processedSegments, 1, 'Synthetic structured analysis did not process its segment.');
    assert.equal(draftResult.segments[0].requirements[0]?.evidence?.quote, 'Synthetic selected source');
    const finalMcpCalls = (await readFile(marker, 'utf8')).trim().split('\n').filter(Boolean).length;
    const finalPluginCalls = (await readFile(path.join(scratch, 'synthetic-plugin-calls.txt'), 'utf8')).trim().split('\n').filter(Boolean).length;
    assert.equal(finalMcpCalls, 1); assert.equal(finalPluginCalls, 1);
    cases.push({ name: 'analysis-e2e', tools: observations.at(-1), context: contextObservations.at(-1), turnStatus: 'completed', providerRequests: caseRequests, toolOutputs: [], syntheticMcpCalls: finalMcpCalls, syntheticPluginCalls: finalPluginCalls });
    assert.ok(syntheticLocalEnvironmentId, 'Synthetic local environment ID unavailable.');
    for (const decision of ['decline', 'accept']) {
    phase = `analysis-command-${decision}-e2e`; activeCase = `analysis-command-${decision}-forced`; caseRequests = 0;
    const approvalDraft = new AnalysisDraft(segment.snapshotId, segment.projectRevision, 1, async () => segment);
    let approvalCount = 0, approvalCleanup = 0, approvalAdmission = false;
    analysisTransport = new AnalysisTransport({ request: send, respondError: (id, code, message) => child.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`), stopAndWait: async () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw new Error('Synthetic termination unavailable.');
      const exited = once(child, 'exit').then(() => true, () => false);
      const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      if (killed.status !== 0 || !await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(false), 5000))])) throw new Error('Synthetic termination not confirmed.');
      confirmedStopped = true;
    } }, { cwd: workspace, model: 'synthetic-model', config: { ...policy.config, 'features.shell_tool': true }, disabledPluginIds: policy.disabledPluginIds, commandEnvironmentId: syntheticLocalEnvironmentId, commandApprovals: {
      request: request => { approvalCount++; child.stdin.write(`${JSON.stringify({ id: request.id, result: { decision } })}\n`); return true; },
      cancel: () => { approvalCleanup++; },
    }, canRun: () => true, acquire: () => { if (approvalAdmission) return null; approvalAdmission = true; return () => { approvalAdmission = false; }; }, timeoutMs: 15000 });
    await approvalDraft.runNext((value, signal) => analysisTransport.run(value, signal));
    const approvalResult = approvalDraft.inspect();
    assert.equal(approvalResult.processedSegments, 1, 'Synthetic approval analysis did not process its segment.');
    assert.equal(approvalResult.segments[0].requirements[0]?.evidence?.quote, 'Synthetic selected source');
    assert.equal(approvalCount, 1, 'The synthetic approval was not delivered to the transport handler.');
    assert.equal(approvalCleanup, 1, 'The synthetic approval handler was not cleaned up.');
    assert.equal(approvalAdmission, false, 'The synthetic approval admission was not released.');
    let markerWritten = false;
    try { markerWritten = (await lstat(path.join(scratch, `${activeCase}.txt`))).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(markerWritten, decision === 'accept', 'The synthetic transport command did not match the approval decision.');
    cases.push({ name: `analysis-command-${decision}-e2e`, tools: observations.at(-1), context: contextObservations.at(-1), turnStatus: 'completed', providerRequests: caseRequests, toolOutputs: [], commandMarkerWritten: markerWritten, syntheticMcpCalls: finalMcpCalls, syntheticPluginCalls: finalPluginCalls });
    }
    return { cli: version, provider: 'loopback-synthetic', environment: 'mixed-empty-and-local', managedRequirements: requirementsRead.requirements === null ? 'none-reported' : 'no-known-conflict', startupReport, syntheticPolicy, hookDiscovery: { baseline: 'empty', fixtureDetected: detectedHookCount > 0, removed: true }, inventory, commandControls: commandEvidence, cases };
  };
  observations.result = await Promise.race([run(), deadline.promise]);
} catch (error) {
  primaryFailure = classifyProbeFailure(error);
} finally {
 try {
  cancelled = true; deadline?.clear(); rejectPending(new Error('Synthetic probe ended.'));
  let childStopped = !child || confirmedStopped; terminationResult = child ? confirmedStopped ? 'helper-exit-0' : 'unconfirmed' : 'not-started';
  if (child && !confirmedStopped && child.exitCode === null && child.signalCode === null && child.pid) {
    const stopped = once(child, 'exit').then(() => true, () => false);
    const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    terminationResult = Number.isInteger(killed.status) ? `helper-exit-${killed.status}` : 'helper-unavailable-or-timeout';
    childStopped = killed.status === 0 && await Promise.race([stopped, new Promise(resolve => setTimeout(() => resolve(false), 5000))]);
  }
  if (child && !childStopped) {
    // Do not keep the diagnostic process alive indefinitely if the sandbox cannot
    // confirm termination. The child and its scratch data remain untrusted.
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
  }
  fake.closeAllConnections();
  if (fake.listening) await new Promise(resolve => fake.close(resolve));
  assert.equal((await lstat(scratch)).isSymbolicLink(), false);
  assert.equal((await realpath(scratch)).toLowerCase(), path.resolve(scratch).toLowerCase());
  assert.equal(path.dirname(await realpath(scratch)).toLowerCase(), (await realpath(parent)).toLowerCase());
  assert.ok(path.basename(scratch).startsWith('issue-tool-probe-'));
  if (childStopped && !helperTerminationUnconfirmed) {
    // Revalidate the actual target at deletion time, not only at creation.
    const info = await lstat(scratch), actual = await realpath(scratch), actualParent = await realpath(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || actual.toLowerCase() !== path.resolve(scratch).toLowerCase() || path.dirname(actual).toLowerCase() !== actualParent.toLowerCase() || !path.basename(actual).startsWith('issue-tool-probe-')) throw new Error('Synthetic scratch cleanup target changed.');
    await rm(actual, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
  else throw new Error(`Synthetic CLI termination was not confirmed at ${phase} (${terminationResult}; helper-unconfirmed: ${helperTerminationUnconfirmed}); signals: ${[...signals].join(',') || 'none'}. Its isolated scratch directory was preserved.`);
 } catch (error) { cleanupFailure = classifyProbeFailure(error); }
}
if (primaryFailure || cleanupFailure) throw new Error(`${describeProbeFailure({ phase, primary: primaryFailure, cleanup: cleanupFailure, termination: terminationResult })} ${describeProbeObservations({ providerRequests: observations.length, turnCompletions, accessDenied: signals.has('access-denied'), cliError: signals.has('cli-error') })} commandControls=${JSON.stringify(commandEvidence)}`);
const { cases, ...summary } = observations.result;
console.log(JSON.stringify({ ...summary, cases: cases.map(item => ({ name: item.name, ...(item.tools ? { tools: item.tools.map(tool => tool.name), context: item.context, turnStatus: item.turnStatus, providerRequests: item.providerRequests, toolOutputs: item.toolOutputs, commandOutputObserved: item.commandOutputObserved, commandMarkerWritten: item.commandMarkerWritten, syntheticNetworkHits: item.syntheticNetworkHits, syntheticMcpCalls: item.syntheticMcpCalls, syntheticPluginCalls: item.syntheticPluginCalls } : { error: item.error }) })) }));
