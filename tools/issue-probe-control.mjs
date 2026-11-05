/** Only for the isolated synthetic probe; no input or diagnostics are logged here. */
export function createProbeDeadline(timeoutMs, onTimeout) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

/** Classify failures without exposing messages or other potentially sensitive data. */
export function classifyProbeFailure(error, cancelled) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (error?.code === 'ERR_ASSERTION') return 'assertion-failed';
  if (message === 'Synthetic CLI exited.') return 'cli-exited';
  if (message.startsWith('Synthetic RPC failed:')) return 'rpc-failed';
  return cancelled ? 'deadline' : 'probe-error';
}

export async function waitForProbeTurn(completed, turnId, isCancelled, intervalMs = 25) {
  while (!completed.has(turnId)) {
    if (isCancelled()) throw new Error('Synthetic probe cancelled.');
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  if (isCancelled()) throw new Error('Synthetic probe cancelled.');
}
