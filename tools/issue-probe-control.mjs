/** Only for the isolated synthetic probe; no input or diagnostics are logged here. */
export function createProbeDeadline(timeoutMs, onTimeout) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

export async function waitForProbeTurn(completed, turnId, isCancelled, intervalMs = 25) {
  while (!completed.has(turnId)) {
    if (isCancelled()) throw new Error('Synthetic probe cancelled.');
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  if (isCancelled()) throw new Error('Synthetic probe cancelled.');
}

/** Classify errors without exposing exception messages, paths, or synthetic input. */
export function classifyProbeFailure(error) {
  if (error && typeof error === 'object' && error.name === 'AssertionError') return 'assertion';
  return 'operation';
}

/** Report both failures; cleanup must never replace the original result. */
export function describeProbeFailure({ phase, primary, cleanup, termination }) {
  const safePhase = typeof phase === 'string' && /^[a-z0-9-]{1,80}$/.test(phase) ? phase : 'unknown';
  const safeKind = value => ['assertion', 'operation'].includes(value) ? value : value === null ? 'none' : 'unknown';
  const safeTermination = typeof termination === 'string' && /^(not-started|unconfirmed|helper-exit-\d{1,3}|helper-unavailable-or-timeout)$/.test(termination) ? termination : 'unknown';
  return `Synthetic probe failed at ${safePhase}; primary=${safeKind(primary)}; cleanup=${safeKind(cleanup)}; termination=${safeTermination}.`;
}
