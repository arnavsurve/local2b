/**
 * Runs `task` while periodically calling `beat`, then beats once more when it
 * finishes so the idle countdown starts from the last real activity. This is
 * what makes box cleanup implicit: every l2b operation pushes the deadline out,
 * and a box nobody is using expires on its own with no process left to forget.
 */
export async function withHeartbeat<T>({
  intervalMs,
  beat,
  task,
}: {
  intervalMs: number;
  beat: () => Promise<void>;
  task: () => Promise<T>;
}) {
  await beat();
  const timer = setInterval(() => {
    beat().catch((err) => {
      console.error(`l2b: keepalive failed: ${err instanceof Error ? err.message : err}`);
    });
  }, intervalMs);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    await beat();
  }
}
