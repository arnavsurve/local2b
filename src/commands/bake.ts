import { parseArgs } from 'node:util';
import { BAKE_CONFIG_CHANGED, bakeConfigState, forgetBakeConfig, recordBakeConfig } from '../bake-config';
import { clearBakeFailure, recordBakeFailure } from '../bake-failures';
import { acquireBakeLock, bakeLockHolder, releaseBakeLock, type BakeLock } from '../bake-lock';
import { BAKE_LOCK_TOKEN_ENV, BAKE_LOG_ENV } from '../background-bake';
import { resolveCredentials } from '../credentials';
import { parseDuration } from '../duration';
import { repoSpecFor } from '../repo';
import { COMMAND_HELP } from '../help';
import type { Command, Context } from '../context';
import { CommandFailedError, type RepoSpec } from '../providers/types';
import { formatAge } from '../snapshots';
import { resolveTarget } from '../target';
import { warnIfUnconfigured } from '../hints';

/**
 * Makes the repo's bake on the selected provider, so later boxes start fast.
 * The repo defaults to the checkout in cwd, as for `up`; the branch does not.
 * `--if-older-than` skips the work while the current bake is recent enough.
 * `--delete` removes the bake instead.
 */
export const bake: Command = async ({ ctx: base, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      doppler: { type: 'string' },
      image: { type: 'string' },
      install: { type: 'string' },
      warm: { type: 'string' },
      branch: { type: 'string' },
      'if-older-than': { type: 'string' },
      delete: { type: 'boolean' },
    },
  });
  const target = await resolveTarget({ ctx: base, repo: positionals[0] ?? null });
  const { ctx, repo } = target;
  if (!repo) throw new Error(`usage: ${COMMAND_HELP.bake.usage}\n(no repo given, and none found from ${base.cwd})`);
  const spec = repoSpecFor({
    config: ctx.config,
    repo,
    install: values.install ?? null,
    warm: values.warm ?? null,
    baseBranch: values.branch ?? null,
  });
  if (values.delete) {
    await deleteBake({ ctx, repo: spec });
    return;
  }
  warnIfUnconfigured({ target, repo: spec });
  const skipIfNewerThanMs = values['if-older-than'] ? parseDuration(values['if-older-than']) : null;
  if (skipIfNewerThanMs !== null) {
    const bakedAt = await ctx.provider.bakedAt({ repo: spec });
    const ageMs = bakedAt ? Date.now() - bakedAt.getTime() : null;
    const state = await bakeConfigState({ provider: ctx.provider.id, repo: spec });
    const changed = state === 'changed' || state === 'toolchain-changed';
    if (ageMs !== null && ageMs < skipIfNewerThanMs && !changed) {
      console.log(
        `snapshot for ${repo} is ${formatAge({ hours: ageMs / 3_600_000 })} old, newer than ${values['if-older-than']}; skipping bake`
      );
      return;
    }
    if (ageMs !== null && changed) console.log(`${BAKE_CONFIG_CHANGED}; baking`);
  }
  const token = await holdBakeLock({ provider: ctx.provider.id, repo });
  try {
    const result = await ctx.provider.bake({
      repo: spec,
      credentials: await resolveCredentials({ config: ctx.config, repo, doppler: values.doppler ?? null }),
      image: values.image ?? ctx.config.image,
    });
    await recordBakeConfig({ provider: ctx.provider.id, repo: spec });
    await clearBakeFailure({ provider: ctx.provider.id, repo: spec });
    console.log(`baked ${result.summary}`);
  } catch (err) {
    if (err instanceof CommandFailedError) {
      await recordBakeFailure({ provider: ctx.provider.id, repo: spec, at: new Date(), log: process.env[BAKE_LOG_ENV] || null });
    }
    throw err;
  } finally {
    await releaseBakeLock({ provider: ctx.provider.id, repo, token });
  }
};

/**
 * One bake per provider and repo at a time. A background bake inherits the
 * lock its launcher took; any other bake takes it here, and fails while
 * another bake holds it.
 */
async function holdBakeLock({ provider, repo }: { provider: string; repo: string }) {
  const inherited = process.env[BAKE_LOCK_TOKEN_ENV];
  const holder = await bakeLockHolder({ provider, repo });
  if (inherited && (holder === null || holder.token === inherited)) return inherited;
  if (holder) throw alreadyBaking({ provider, repo, holder });
  const lock = await acquireBakeLock({ provider, repo, pid: process.pid, log: null });
  if (lock.acquired) return lock.token;
  throw alreadyBaking({ provider, repo, holder: lock.holder });
}

function alreadyBaking({ provider, repo, holder }: { provider: string; repo: string; holder: BakeLock }) {
  const where = holder.log ? `, log: ${holder.log}` : '';
  return new Error(
    `a bake of ${repo} on ${provider} is already running (pid ${holder.pid}${where}); boxes start from it once it finishes, so do not bake again`
  );
}

async function deleteBake({ ctx, repo }: { ctx: Context; repo: RepoSpec }) {
  const slug = `${repo.owner}/${repo.name}`;
  const deleted = await ctx.provider.deleteBake({ repo });
  await forgetBakeConfig({ provider: ctx.provider.id, repo });
  if (!deleted) throw new Error(`no bake of ${slug} on ${ctx.provider.id}`);
  console.log(`deleted the bake of ${slug} on ${ctx.provider.id}`);
}
