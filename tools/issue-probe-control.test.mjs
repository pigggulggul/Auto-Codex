import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyProbeFailure, createProbeDeadline, waitForProbeTurn } from './issue-probe-control.mjs';

test('failure classification returns only bounded diagnostic labels', () => {
  assert.equal(classifyProbeFailure({ code: 'ERR_ASSERTION', message: 'private detail' }, false), 'assertion-failed');
  assert.equal(classifyProbeFailure(new Error('Synthetic CLI exited.'), false), 'cli-exited');
  assert.equal(classifyProbeFailure(new Error('Synthetic RPC failed: private detail'), false), 'rpc-failed');
  assert.equal(classifyProbeFailure(new Error('private detail'), true), 'deadline');
  assert.equal(classifyProbeFailure(new Error('private detail'), false), 'probe-error');
});

test('deadline cancels an unresolved turn wait instead of leaving a live polling loop', async () => {
  let cancelled = false;
  const deadline = createProbeDeadline(15, () => { cancelled = true; return new Error('synthetic timeout'); });
  const waiting = waitForProbeTurn(new Map(), 'turn', () => cancelled, 2);
  await assert.rejects(Promise.race([waiting, deadline.promise]), /synthetic timeout/);
  await assert.rejects(waiting, /cancelled/);
  deadline.clear();
});

test('a completed turn stops the deadline without triggering cancellation', async () => {
  let cancelled = false;
  const deadline = createProbeDeadline(100, () => { cancelled = true; return new Error('synthetic timeout'); });
  const completed = new Map();
  const waiting = waitForProbeTurn(completed, 'turn', () => cancelled, 2);
  completed.set('turn', 'completed');
  await Promise.race([waiting, deadline.promise]);
  deadline.clear();
  assert.equal(cancelled, false);
});

test('a late completion cannot convert cancellation into success', async () => {
  const completed = new Map([['turn', 'completed']]);
  await assert.rejects(waitForProbeTurn(completed, 'turn', () => true, 1), /cancelled/);
});
