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
  if (error instanceof ProbeTimeoutError) return 'timeout';
  return 'operation';
}

export class ProbeTimeoutError extends Error {}

/** Only aggregate synthetic observations, never input or diagnostics. */
export function describeProbeObservations({ providerRequests, turnCompletions, accessDenied, cliError }) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 9999) : 0;
  return `providerRequests=${count(providerRequests)}; turnCompletions=${count(turnCompletions)}; accessDenied=${accessDenied === true}; cliError=${cliError === true}.`;
}

/** Report both failures; cleanup must never replace the original result. */
export function describeProbeFailure({ phase, primary, cleanup, termination }) {
  const safePhase = typeof phase === 'string' && /^[a-z0-9-]{1,80}$/.test(phase) ? phase : 'unknown';
  const safeKind = value => ['assertion', 'operation', 'timeout'].includes(value) ? value : value === null ? 'none' : 'unknown';
  const safeTermination = typeof termination === 'string' && /^(not-started|unconfirmed|helper-exit-\d{1,3}|helper-unavailable-or-timeout)$/.test(termination) ? termination : 'unknown';
  return `Synthetic probe failed at ${safePhase}; primary=${safeKind(primary)}; cleanup=${safeKind(cleanup)}; termination=${safeTermination}.`;
}
