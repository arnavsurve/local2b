import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RepoSpec } from './providers/types';
import { statePath, writeJsonAtomic } from './state';

/** Older records hold only the overall digest, as a string. */
const recordSchema = z.union([
  z.string().transform((all) => ({ all, toolchain: null })),
  z.object({ all: z.string(), toolchain: z.string() }),
]);
const recordsSchema = z.record(z.string(), recordSchema);

type BakeConfigRecord = { all: string; toolchain: string | null };

const recordsPath = () => statePath('bake-configs.json');

const key = ({ provider, repo }: { provider: string; repo: RepoSpec }) => `${provider}:${repo.owner}/${repo.name}`;

async function readRecords(): Promise<Record<string, BakeConfigRecord>> {
  const file = Bun.file(recordsPath());
  if (!(await file.exists())) return {};
  const parsed = recordsSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : {};
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A digest of the repo settings a bake depends on. Env keys are sorted so their order does not count. */
export function bakeConfigHash({ repo }: { repo: RepoSpec }) {
  return digest({
    setup: repo.setup,
    install: repo.install,
    warm: repo.warm,
    baseBranch: repo.baseBranch,
    clone: { strategy: repo.clone.strategy, depth: repo.clone.depth, filter: repo.clone.filter },
    env: Object.entries(repo.env).sort(([a], [b]) => a.localeCompare(b)),
  });
}

/**
 * A digest of what a start from the bake cannot redo: `setup` and `warm` run
 * only at bake. The rest (install, branch, clone, env) is applied again on
 * every start, so a bake made with older values of those is still usable.
 */
function toolchainHash({ repo }: { repo: RepoSpec }) {
  return digest({ setup: repo.setup, warm: repo.warm });
}

/** Notes the settings `repo`'s latest bake on `provider` was made with. */
export async function recordBakeConfig({ provider, repo }: { provider: string; repo: RepoSpec }) {
  const records = await readRecords();
  records[key({ provider, repo })] = { all: bakeConfigHash({ repo }), toolchain: toolchainHash({ repo }) };
  await writeJsonAtomic({ path: recordsPath(), value: records });
}

/** Drops the settings record of `repo`'s bake on `provider`, once that bake is gone. */
export async function forgetBakeConfig({ provider, repo }: { provider: string; repo: RepoSpec }) {
  const records = await readRecords();
  if (!Object.hasOwn(records, key({ provider, repo }))) return;
  delete records[key({ provider, repo })];
  await writeJsonAtomic({ path: recordsPath(), value: records });
}

/**
 * How `repo`'s settings compare with those its latest bake on `provider` was
 * made with. `changed`: a start from the bake still works and redoes the
 * difference. `toolchain-changed`: `setup` or `warm` differ, so the bake
 * lacks something a start would not add (also assumed for older records that
 * cannot tell). A bake made elsewhere, or before l2b recorded settings, is
 * `unknown`.
 */
export async function bakeConfigState({
  provider,
  repo,
}: {
  provider: string;
  repo: RepoSpec;
}): Promise<'same' | 'changed' | 'toolchain-changed' | 'unknown'> {
  const recorded = (await readRecords())[key({ provider, repo })];
  if (recorded === undefined) return 'unknown';
  if (recorded.all === bakeConfigHash({ repo })) return 'same';
  return recorded.toolchain === toolchainHash({ repo }) ? 'changed' : 'toolchain-changed';
}

export const BAKE_CONFIG_CHANGED = 'project config changed since the bake';
