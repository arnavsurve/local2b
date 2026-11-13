import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { acquireBakeLock, releaseBakeLock, transferBakeLock, type BakeLock } from './bake-lock';
import { statePath, stateSlug } from './state';

/** Set in a background bake's environment: the token of the bake lock its launcher took for it. */
export const BAKE_LOCK_TOKEN_ENV = 'L2B_BAKE_LOCK_TOKEN';
/** Set in a background bake's environment: the log its output goes to. */
export const BAKE_LOG_ENV = 'L2B_BAKE_LOG';

export const bakeLogPath = (target: { provider: string; repo: string }) => statePath('logs', `bake-${stateSlug(target)}.log`);

/**
 * Starts `l2b bake` for `repo` on `provider` as a detached process that
 * outlives this one, with its output in a log under the state directory. The
 * per provider+repo bake lock is taken here, before the process starts, so
 * two agents starting boxes at once launch one bake; the process inherits the
 * lock and frees it when it ends.
 */
export async function launchBackgroundBake({
  l2b,
  cwd,
  provider,
  repo,
  doppler,
}: {
  /** The argv that runs l2b. */
  l2b: string[];
  /** Where the bake looks up `.l2b.json`, as the command that launched it did. */
  cwd: string;
  provider: string;
  repo: string;
  doppler: string | null;
}): Promise<{ status: 'started'; log: string } | { status: 'running'; holder: BakeLock }> {
  const log = bakeLogPath({ provider, repo });
  const lock = await acquireBakeLock({ provider, repo, pid: process.pid, log });
  if (!lock.acquired) return { status: 'running', holder: lock.holder };
  const [command, ...prefix] = l2b;
  if (!command) throw new Error('no l2b command to run a background bake with');
  try {
    mkdirSync(dirname(log), { recursive: true });
    const out = openSync(log, 'w');
    const child = spawn(command, [...prefix, 'bake', repo, '--provider', provider, ...(doppler ? ['--doppler', doppler] : [])], {
      cwd,
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, [BAKE_LOCK_TOKEN_ENV]: lock.token, [BAKE_LOG_ENV]: log },
    });
    child.on('error', () => {});
    closeSync(out);
    if (child.pid === undefined) throw new Error(`could not start ${command}`);
    child.unref();
    await transferBakeLock({ provider, repo, token: lock.token, pid: child.pid });
    return { status: 'started', log };
  } catch (err) {
    await releaseBakeLock({ provider, repo, token: lock.token });
    throw err;
  }
}
