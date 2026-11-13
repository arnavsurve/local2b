import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { RepoSpec } from './providers/types';

const recordsSchema = z.record(z.string(), z.string());

function recordsPath() {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(stateHome, 'l2b', 'bake-configs.json');
}

const key = ({ provider, repo }: { provider: string; repo: RepoSpec }) => `${provider}:${repo.owner}/${repo.name}`;

async function readRecords() {
  const file = Bun.file(recordsPath());
  if (!(await file.exists())) return {};
  const parsed = recordsSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

/** A digest of the repo settings a bake depends on. Env keys are sorted so their order does not count. */
export function bakeConfigHash({ repo }: { repo: RepoSpec }) {
  const settings = {
    setup: repo.setup,
    install: repo.install,
    warm: repo.warm,
    baseBranch: repo.baseBranch,
    clone: { strategy: repo.clone.strategy, depth: repo.clone.depth, filter: repo.clone.filter },
    env: Object.entries(repo.env).sort(([a], [b]) => a.localeCompare(b)),
  };
  return createHash('sha256').update(JSON.stringify(settings)).digest('hex');
}

async function writeRecords(records: Record<string, string>) {
  const path = recordsPath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(records, null, 2));
}

/** Notes the settings `repo`'s latest bake on `provider` was made with. */
export async function recordBakeConfig({ provider, repo }: { provider: string; repo: RepoSpec }) {
  const records = await readRecords();
  records[key({ provider, repo })] = bakeConfigHash({ repo });
  await writeRecords(records);
}

/** Drops the settings record of `repo`'s bake on `provider`, once that bake is gone. */
export async function forgetBakeConfig({ provider, repo }: { provider: string; repo: RepoSpec }) {
  const records = await readRecords();
  if (!Object.hasOwn(records, key({ provider, repo }))) return;
  delete records[key({ provider, repo })];
  await writeRecords(records);
}

/**
 * Whether `repo`'s settings differ from those its latest bake on `provider`
 * was made with. A bake made elsewhere, or before l2b recorded settings, is
 * `unknown`.
 */
export async function bakeConfigState({ provider, repo }: { provider: string; repo: RepoSpec }) {
  const recorded = (await readRecords())[key({ provider, repo })];
  if (recorded === undefined) return 'unknown';
  return recorded === bakeConfigHash({ repo }) ? 'same' : 'changed';
}

export const BAKE_CONFIG_CHANGED = 'project config changed since the bake';
