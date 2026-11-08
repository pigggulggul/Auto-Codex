import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { IssueWorkerClient } from '../build-server/server/issues/worker-client.js';
import { IssueProjectContext } from '../build-server/server/issues/project-context.js';
import { ExecutionApprovalRouter } from '../build-server/server/issues/execution-approval-router.js';
import { IssueExecutionRuntime } from '../build-server/server/issues/execution-runtime.js';

// Synthetic isolated integration check against the compiled production worker.
const parent = path.resolve('.cache');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'issues-worker-integration-'));
const workspace = path.join(root, 'workspace');
await mkdir(workspace);
let client;
try {
  client = new IssueWorkerClient(root);
  const context = new IssueProjectContext(() => ({ workspaceMode: 'project', projectPath: workspace, generation: 1 }), client);
  assert.deepEqual(await context.status(), { project: null });
  const binding = await context.bind();
  assert.equal(binding.alreadyBound, false);
  const id = binding.project.id;
  assert.deepEqual(await context.bind(), { project: { id, revision: 1 }, alreadyBound: true });
  assert.deepEqual(await client.request({ operation: 'project.lookup', selectedPath: workspace }), { kind: 'project.lookup', project: { id, revision: 1 } });
  const json = {
    format: 'auto-codex-issues', formatVersion: 1, documentId: 'doc-1', revision: 1,
    sources: [], categories: [], requirements: [],
    issues: [{ id: 'issue-1', categoryId: null, requirementIds: [], version: '1.0.0', order: 0,
      title: 'synthetic', description: '', acceptanceCriteria: ['synthetic test'], dependencyIds: [], status: 'completed' }],
  };
  const bytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(json)}\n\`\`\`\n`);
  const imported = await context.importDocument(bytes, () => true, { id, revision: 1 });
  assert.deepEqual(imported, { alreadyImported: false, issueCount: 1 });
  assert.deepEqual(await context.importDocument(bytes, () => true, { id, revision: 2 }), { alreadyImported: true, issueCount: 1 });
  const saved = await client.request({ operation: 'document.read', projectId: id, documentId: 'doc-1' });
  assert.equal(saved.kind, 'document');
  assert.equal(saved.issues[0].importedStatus, 'completed');
  assert.equal(saved.issues[0].localStatus, 'needs_review');
  const pending = Array.from({ length: 8 }, () => client.request({ operation: 'project.read', projectId: id }));
  await assert.rejects(client.request({ operation: 'project.read', projectId: id }), { code: 'BUSY' });
  assert.equal((await Promise.all(pending)).length, 8);
  const closing = client.close(); assert.equal(client.close(), closing);
  await assert.rejects(client.request({ operation: 'project.read', projectId: id }), { code: 'WORKER_UNAVAILABLE' });
  await closing; client = undefined;
  client = new IssueWorkerClient(root);
  const reopened = await client.request({ operation: 'document.list', projectId: id, expectedRevision: 2 });
  assert.deepEqual(reopened.documents, [{ id: 'doc-1', documentRevision: 1, issueCount: 1 }]);
  await assert.rejects(client.request({ operation: 'document.import', projectId: id, expectedRevision: 2, bytes }, () => false), { code: 'STALE_SELECTION' });
  assert.equal((await client.request({ operation: 'project.read', projectId: id })).revision, 2);
  await client.close();
  client = new IssueWorkerClient(root);
  const queued = { ...json, documentId: 'doc-3', issues: [{ ...json.issues[0], id: 'issue-3', status: 'ready' }] };
  const queuedBytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(queued)}\n\`\`\`\n`);
  const queuedRequest = { operation: 'document.import', projectId: id, expectedRevision: 2, bytes: queuedBytes };
  const queuedResult = client.request(queuedRequest);
  queuedBytes.fill(0); queuedRequest.expectedRevision = 999;
  assert.equal((await queuedResult).revision, 3);
  // Synthetic internal worker flow only; no model or external service is started.
  const owner = new AbortController(), events = [];
  let showApproval;
  const shown = new Promise(resolve => { showApproval = resolve; });
  const router = new ExecutionApprovalRouter({
    show: (signal, approvalId) => { assert.equal(signal, owner.signal); events.push('show'); showApproval(approvalId); },
    write: async (_request, decision) => { assert.equal(decision, 'decline'); events.push('write'); },
    deny: () => { events.push('deny'); }, resolved: () => { events.push('resolved'); },
  });
  const executionContext = new IssueProjectContext(() => ({ workspaceMode: 'project', projectPath: workspace, generation: 1 }), client);
  let admission = false;
  const runtime = new IssueExecutionRuntime({ context: executionContext, router, permitted: () => true, acquire: () => { if (admission) return null; admission = true; return () => { admission = false; }; }, transport: {
    startThread: async () => 'synthetic-thread', startTurn: async () => 'synthetic-turn',
    waitForCompletion: async () => {
      assert.equal(router.serverRequest({ id: 2, method: 'item/commandExecution/requestApproval', params: { threadId: 'synthetic-thread', turnId: 'synthetic-turn' } }), true);
      const approvalId = await shown;
      await new Promise(resolve => setImmediate(resolve));
      await router.resolve(approvalId, owner.signal, 'decline');
      return { threadId: 'synthetic-thread', turnId: 'synthetic-turn', status: 'completed' };
    },
    stopAndWait: async () => { events.push('stop'); router.resetAfterConfirmedStop(); },
  } });
  const result = await runtime.run({ projectId: id, documentId: 'doc-3', issueId: 'issue-3', expectedRevision: 3, idempotencyKey: 'synthetic-key', owner: owner.signal });
  assert.equal(result.phase, 'verifying'); assert.equal(admission, false);
  assert.deepEqual(events, ['show', 'write', 'resolved', 'stop']);
  await client.request({ operation: 'execution.transition', projectId: id, expectedRevision: 3, attemptId: result.attemptId, action: { type: 'unknown' } });
  const history = await client.request({ operation: 'execution.history', projectId: id, expectedRevision: 3, afterId: null });
  assert.equal(history.page.items[0].phase, 'outcome_unknown'); assert.equal(history.page.items[0].approvals.sent, 1);
  const otherWorkspace = path.join(root, 'other-workspace'); await mkdir(otherWorkspace);
  const otherContext = new IssueProjectContext(() => ({ workspaceMode: 'project', projectPath: otherWorkspace, generation: 1 }), client);
  const otherId = (await otherContext.bind()).project.id;
  const otherBytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(queued)}\n\`\`\`\n`);
  await otherContext.importDocument(otherBytes, () => true, { id: otherId, revision: 1 });
  const otherPrepare = { operation: 'execution.prepare', projectId: otherId, documentId: 'doc-3', issueId: 'issue-3', expectedRevision: 2, idempotencyKey: 'other-key', policy: { sandbox: 'workspace-write', networkAccess: false, approval: 'manual', revision: 1 } };
  await assert.rejects(client.request(otherPrepare), { code: 'PROJECT_BUSY' });
  // Reopen the real worker; this is a synthetic guard, not OS termination proof.
  await client.close(); client = new IssueWorkerClient(root);
  const recoveryContext = new IssueProjectContext(() => ({ workspaceMode: 'project', projectPath: workspace, generation: 1 }), client);
  const recovery = { projectId: id, attemptId: result.attemptId, expectedRevision: 3, reason: 'Synthetic review of uncertain outcome' };
  await assert.rejects(recoveryContext.reconcileExecution(recovery, () => false), { code: 'STALE_SELECTION' });
  const reconciled = await recoveryContext.reconcileExecution(recovery, () => true);
  assert.equal(reconciled.outcome, 'reconciled_unknown');
  const otherAttempt = await client.request(otherPrepare);
  assert.equal(otherAttempt.created, true);
  await client.request({ operation: 'execution.transition', projectId: otherId, expectedRevision: 2, attemptId: otherAttempt.record.attemptId, action: { type: 'settle', outcome: 'interrupted' } });
  const afterReconcile = await client.request({ operation: 'execution.history', projectId: id, expectedRevision: 3, afterId: null });
  assert.equal(afterReconcile.page.items[0].outcome, 'reconciled_unknown'); assert.equal(afterReconcile.page.items[0].approvals.sent, 1);
  // Terminating during a real large import models a lost worker reply, not a failed import.
  const large = { ...json, documentId: 'doc-2', issues: Array.from({ length: 30 }, (_, index) => ({ ...json.issues[0], id: `issue-next-${index}`, status: 'ready', description: 'x'.repeat(32000) })) };
  const largeBytes = new TextEncoder().encode(`\`\`\`auto-codex-issues-v1\n${JSON.stringify(large)}\n\`\`\`\n`);
  const pendingMutation = client.request({ operation: 'document.import', projectId: id, expectedRevision: 3, bytes: largeBytes }).then(result => ({ result }), error => ({ error }));
  await Promise.resolve();
  await client.worker.terminate();
  const outcome = await pendingMutation;
  if ('error' in outcome) assert.equal(outcome.error.code, 'OUTCOME_UNKNOWN');
  else assert.equal(outcome.result.documentId, 'doc-2');
  await client.close();
  client = new IssueWorkerClient(root);
  const current = await client.request({ operation: 'project.read', projectId: id });
  const afterCrash = await client.request({ operation: 'document.list', projectId: id, expectedRevision: current.revision });
  assert.ok(afterCrash.documents.filter(item => item.id === 'doc-2').length <= 1);
  await client.close();
  client = new IssueWorkerClient(path.join(root, 'missing'));
  await assert.rejects(client.request({ operation: 'project.read', projectId: id }), error => error.code === 'WORKER_UNAVAILABLE' && !error.message.includes(root));
  console.log(`Issue worker integration passed: import, review state, bounded queue and restart; terminated import: ${'error' in outcome ? outcome.error.code : 'completed'}.`);
} finally {
  if (client) await client.close();
  assert.equal(path.dirname(await realpath(root)), await realpath(parent));
  await rm(root, { recursive: true, force: true });
}
