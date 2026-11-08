import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { IssueBridgeApi } from '../build-server/server/issues/bridge-api.js';
import { createIsolatedAnalysisFactory } from '../build-server/server/issues/analysis-isolated-factory.js';

// Explicit opt-in: exercise the issue bridge with one synthetic real-model request.
const root = path.resolve('.'), selectedPath = await realpath(root), owner = new AbortController();
const sourceText = 'The synthetic app must show a status message.';
const sha256 = createHash('sha256').update(sourceText).digest('hex');
let held = false, bound = false;
const selection = () => ({ workspaceMode: 'project', projectPath: selectedPath, generation: 1 });
const factory = createIsolatedAnalysisFactory({ root, selection, model: () => 'gpt-6.1-sol', ready: () => true, validateProject: realpath, acquire: () => { if (held) return null; held = true; return () => { held = false; }; } });
const api = new IssueBridgeApi({
  selection,
  context: () => ({ status: async () => ({ project: bound ? { id: 'synthetic-project', revision: 1 } : null }), bind: async () => { bound = true; return { project: { id: 'synthetic-project', revision: 1 }, alreadyBound: false }; } }),
  pick: async () => selectedPath, pickView: async () => selectedPath, pickSource: async () => path.join(selectedPath, 'synthetic-source.md'),
  readSource: async () => ({ relativePath: 'synthetic-source.md', bytes: Buffer.byteLength(sourceText), sha256, text: sourceText }),
  canonical: realpath, busy: () => false, now: () => Date.now(), createAnalysisExecution: factory, analysisAvailable: () => true,
});
const ask = (type, fields = {}) => api.handle(JSON.stringify({ type, v: 1, clientRequestId: randomUUID(), ...fields }), true, () => !owner.signal.aborted, owner.signal);
try {
  assert.equal((await ask('issues.project.bind')).ok, true);
  assert.equal((await ask('issues.view.authorize')).ok, true);
  const source = await ask('issues.sources.add'); assert.ok(source.ok && source.sources?.items.length === 1);
  const selected = source.sources.items[0];
  const prepared = await ask('issues.analysis.prepare', { expectedRevision: 1, expectedSources: [{ id: selected.id, sha256: selected.sha256 }], instruction: '' });
  assert.ok(prepared.ok && prepared.snapshot);
  const started = await ask('issues.analysis.start', { snapshotId: prepared.snapshot.id, expectedRevision: 1 }); assert.ok(started.ok);
  let status;
  for (let i = 0; i < 240; i++) {
    const response = await ask('issues.analysis.status'); assert.ok(response.ok && response.analysisStatus !== 'unavailable');
    status = response.analysisStatus;
    if (!['preparing', 'running'].includes(status.state)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(status?.state, 'complete', 'Synthetic bridge analysis did not complete');
  assert.equal(status.progress?.processed, 1);
  const result = await ask('issues.analysis.segment', { index: 0, offset: 0 });
  assert.ok(result.ok && result.analysisSegment?.status === 'processed');
  assert.equal(held, false);
  console.log(JSON.stringify({ status: status.state, processed: status.progress.processed, candidates: result.analysisSegment.items.length, admissionReleased: !held }));
} finally { owner.abort(); }
