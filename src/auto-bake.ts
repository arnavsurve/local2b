import { bakeConfigState } from './bake-config';
import { recentBakeFailure } from './bake-failures';
import { launchBackgroundBake } from './background-bake';
import type { Context } from './context';
import type { StartOpts } from './providers/types';
import { repoSpecFor } from './repo';
import { formatAge } from './snapshots';

/** Why the repo's bake needs making again, or null when it is current. */
export type BakeNeed = 'missing' | 'stale' | 'changed' | 'toolchain-changed' | 'unrecorded' | null;

/**
 * Decides from the bake's age and the settings it was made with. A bake of
 * unknown age counts as missing; the provider still starts from it if it has one. `unrecorded`: the bake predates l2b noting
 * its settings, so a re-bake records them.
 */
export function bakeNeed({
  bakedAt,
  configState,
  now,
  thresholdHours,
}: {
  bakedAt: Date | null;
  configState: Awaited<ReturnType<typeof bakeConfigState>>;
  now: Date;
  thresholdHours: number;
}): BakeNeed {
  if (!bakedAt) return 'missing';
  switch (configState) {
    case 'toolchain-changed':
    case 'changed':
      return configState;
    case 'unknown':
      return 'unrecorded';
    case 'same':
      return now.getTime() - bakedAt.getTime() > thresholdHours * 3_600_000 ? 'stale' : null;
    default: {
      const unreachable: never = configState;
      return unreachable;
    }
  }
}

function describeNeed({ need, repo, bakedAt, now }: { need: Exclude<BakeNeed, null>; repo: string; bakedAt: Date | null; now: Date }) {
  switch (need) {
    case 'missing':
      return `no current bake of ${repo}`;
    case 'stale': {
      const age = bakedAt ? formatAge({ hours: (now.getTime() - bakedAt.getTime()) / 3_600_000 }) : 'unknown';
      return `the bake of ${repo} is ${age} old; this box starts from it`;
    }
    case 'changed':
      return `.l2b.json changed since the bake of ${repo}; this box starts from the bake and applies the change`;
    case 'toolchain-changed':
      return `setup or warm changed since the bake of ${repo}; this box starts without the bake`;
    case 'unrecorded':
      return `the bake of ${repo} has no record of its settings; this box starts from it`;
    default: {
      const unreachable: never = need;
      return unreachable;
    }
  }
}

/**
 * Keeps the repo's bake current without making anyone wait for it: when the
 * bake is missing, old or made with other settings, a bake starts in the
 * background and this start goes ahead now, from the existing bake unless
 * that bake lacks the current `setup` or `warm`. Says what it did on stderr.
 * Returns the start options to use.
 */
export async function keepBakeCurrent({
  ctx,
  start,
  doppler,
}: {
  ctx: Context;
  start: StartOpts;
  doppler: string | null;
}): Promise<StartOpts> {
  if (!start.repo || start.source !== 'bake') return start;
  const repo = `${start.repo.owner}/${start.repo.name}`;
  const provider = ctx.provider.id;
  const settings = repoSpecFor({ config: ctx.config, repo, install: null, warm: null, baseBranch: null });
  const now = new Date();
  const bakedAt = await ctx.provider.bakedAt({ repo: settings });
  const need = bakeNeed({
    bakedAt,
    configState: await bakeConfigState({ provider, repo: settings }),
    now,
    thresholdHours: ctx.config.staleSnapshotHours,
  });
  if (need === null) return start;
  const next: StartOpts = need === 'toolchain-changed' ? { ...start, source: 'fresh' } : start;
  const what = describeNeed({ need, repo, bakedAt, now });
  const failure = await recentBakeFailure({ provider, repo: settings, now });
  if (failure) {
    const log = failure.log ? ` (log: ${failure.log})` : '';
    console.error(
      `l2b: ${what}. The last bake with these settings failed${log}; fix setup, install or warm in .l2b.json and the next start bakes again, or run \`l2b bake\` to retry now`
    );
    return next;
  }
  const launched = await launchBackgroundBake({ l2b: ctx.l2b, cwd: ctx.cwd, provider, repo, doppler }).catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`l2b: ${what}. Could not start a background bake (${reason}); run \`l2b bake\` to bake now`);
    return null;
  });
  if (!launched) return next;
  switch (launched.status) {
    case 'started':
      console.error(`l2b: ${what}. Baking in the background for later boxes (log: ${launched.log})`);
      break;
    case 'running':
      console.error(`l2b: ${what}. A bake is already running for later boxes (pid ${launched.holder.pid}${launched.holder.log ? `, log: ${launched.holder.log}` : ''})`);
      break;
    default: {
      const unreachable: never = launched;
      return unreachable;
    }
  }
  return next;
}
