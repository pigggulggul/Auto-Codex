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
