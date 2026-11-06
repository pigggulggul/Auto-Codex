import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyProbeFailure, createProbeDeadline, describeProbeFailure, waitForProbeTurn } from './issue-probe-control.mjs';

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

test('reports primary and cleanup failures without leaking exception messages or paths', () => {
  const primary = classifyProbeFailure(new assert.AssertionError({ message: 'synthetic private input' }));
  const cleanup = classifyProbeFailure(new Error('C:/private/path'));
  const summary = describeProbeFailure({ phase: 'analysis-e2e', primary, cleanup, termination: 'helper-exit-255' });
  assert.equal(summary, 'Synthetic probe failed at analysis-e2e; primary=assertion; cleanup=operation; termination=helper-exit-255.');
  assert.doesNotMatch(summary, /private/);
  assert.match(describeProbeFailure({ phase: 'C:/private', primary: 'secret', cleanup: null, termination: 'secret' }), /unknown; primary=unknown; cleanup=none; termination=unknown/);
});
