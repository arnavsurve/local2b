import { z } from 'zod';
import { bakeConfigHash } from './bake-config';
import type { RepoSpec } from './providers/types';
import { statePath, writeJsonAtomic } from './state';

/** A bake whose repo command failed is not retried in the background with the same settings for this long; other failures are retried on the next start. */
export const BAKE_RETRY_AFTER_MS = 3_600_000;

const failureSchema = z.object({ config: z.string(), at: z.iso.datetime(), log: z.string().nullable() });
const failuresSchema = z.record(z.string(), failureSchema);

const failuresPath = () => statePath('bake-failures.json');
const key = ({ provider, repo }: { provider: string; repo: RepoSpec }) => `${provider}:${repo.owner}/${repo.name}`;

async function readFailures() {
  const file = Bun.file(failuresPath());
  if (!(await file.exists())) return {};
  const parsed = failuresSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

/** Notes that a bake of `repo` with its current settings failed, and where its log is. */
export async function recordBakeFailure({ provider, repo, at, log }: { provider: string; repo: RepoSpec; at: Date; log: string | null }) {
  const failures = await readFailures();
  failures[key({ provider, repo })] = { config: bakeConfigHash({ repo }), at: at.toISOString(), log };
  await writeJsonAtomic({ path: failuresPath(), value: failures });
}

export async function clearBakeFailure({ provider, repo }: { provider: string; repo: RepoSpec }) {
  const failures = await readFailures();
  if (!Object.hasOwn(failures, key({ provider, repo }))) return;
  delete failures[key({ provider, repo })];
  await writeJsonAtomic({ path: failuresPath(), value: failures });
}

/** The last bake failure of `repo` with these same settings, if it is recent enough that retrying now would likely fail again. */
export async function recentBakeFailure({ provider, repo, now }: { provider: string; repo: RepoSpec; now: Date }) {
  const failure = (await readFailures())[key({ provider, repo })];
  if (!failure || failure.config !== bakeConfigHash({ repo })) return null;
  const at = new Date(failure.at);
  return now.getTime() - at.getTime() < BAKE_RETRY_AFTER_MS ? { at, log: failure.log } : null;
}
