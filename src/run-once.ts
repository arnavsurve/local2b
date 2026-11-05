import { randomBytes } from 'node:crypto';
import type { ExecOutput, Provider, StartOpts } from './providers/types';
import { step } from './progress';
import { repoName } from './repo';

export function generatedBoxName({ repo }: { repo: string | null }) {
  const slug = repo ? repoName(repo) : 'box';
  return `run-${slug}-${randomBytes(3).toString('hex')}`;
}

const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 } as const;

/**
 * One-shot on the workflow boundary: start a box, run `cmd` in its workdir,
 * and destroy the box unless `after` is `keep`. The box is destroyed when the
 * command fails or throws, and on SIGINT/SIGTERM; idle expiry is only the
 * backstop for a hard kill. A failed start leaves nothing to destroy.
 */
export async function runOnce({
  provider,
  start,
  cmd,
  label,
  after,
  onOutput,
}: {
  provider: Provider;
  start: StartOpts;
  cmd: string;
  /** Human-readable form of `cmd` for progress output. */
  label: string;
  after: 'destroy' | 'keep';
  onOutput: (output: ExecOutput) => void;
}) {
  const box = await provider.start(start);
  const teardown = async () => {
    if (after === 'keep') return;
    step(`destroying box "${start.name}"`);
    await box.destroy();
  };
  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    void teardown().finally(() => process.exit(SIGNAL_EXIT[signal]));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    step(`running: ${label}`);
    const exitCode = await box.exec({ cmd, cwd: null, onOutput });
    step(`command exited ${exitCode}`);
    return exitCode;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await teardown();
  }
}
