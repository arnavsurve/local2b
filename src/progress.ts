const startedAt = Date.now();

/** Progress goes to stderr so stdout stays clean for the command's own output. */
export function step(message: string) {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.error(`l2b: ${message} (+${elapsed}s)`);
}
