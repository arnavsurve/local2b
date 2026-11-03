import { randomBytes } from 'node:crypto';
import type { Context } from './context';
import { provisionBox, type ProvisionOpts } from './provision';
import { step } from './progress';
import { repoName } from './repo';
import { run } from './session';

export function generatedBoxName({ repo }: { repo: string | null }) {
  const slug = repo ? repoName(repo) : 'box';
  return `run-${slug}-${randomBytes(3).toString('hex')}`;
}

/**
 * One-shot: provision a box, run a command in its workdir, tear it down.
 * The box is destroyed even if provisioning or the command fails, and on
 * SIGINT/SIGTERM. Idle expiry is only the backstop for a hard kill.
 */
export async function runOnce({
  ctx,
  opts,
  cmd,
  label,
  keep,
}: {
  ctx: Context;
  opts: ProvisionOpts;
  cmd: string;
  /** Human-readable form of `cmd` for progress output. */
  label: string;
  keep: boolean;
}) {
  const box = await provisionBox({ ctx, opts });
  const teardown = async () => {
    if (keep) return;
    step(`destroying box "${opts.name}"`);
    await box.destroy();
  };
  const onSignal = (signal: NodeJS.Signals) => {
    void teardown().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    step(`running: ${label}`);
    const exitCode = await run({ box, cmd, cwd: box.workdir });
    step(`command exited ${exitCode}`);
    return exitCode;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await teardown();
  }
}
