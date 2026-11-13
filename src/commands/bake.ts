import { parseArgs } from 'node:util';
import { BAKE_CONFIG_CHANGED, bakeConfigState, forgetBakeConfig, recordBakeConfig } from '../bake-config';
import { resolveCredentials } from '../credentials';
import { parseDuration } from '../duration';
import { repoSpecFor } from '../repo';
import { COMMAND_HELP } from '../help';
import type { Command, Context } from '../context';
import type { RepoSpec } from '../providers/types';
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
    const changed = (await bakeConfigState({ provider: ctx.provider.id, repo: spec })) === 'changed';
    if (ageMs !== null && ageMs < skipIfNewerThanMs && !changed) {
      console.log(
        `snapshot for ${repo} is ${formatAge({ hours: ageMs / 3_600_000 })} old, newer than ${values['if-older-than']}; skipping bake`
      );
      return;
    }
    if (ageMs !== null && changed) console.log(`${BAKE_CONFIG_CHANGED}; baking`);
  }
  const result = await ctx.provider.bake({
    repo: spec,
    credentials: await resolveCredentials({ config: ctx.config, repo, doppler: values.doppler ?? null }),
    image: values.image ?? ctx.config.image,
  });
  await recordBakeConfig({ provider: ctx.provider.id, repo: spec });
  console.log(`baked ${result.summary}`);
};

async function deleteBake({ ctx, repo }: { ctx: Context; repo: RepoSpec }) {
  const slug = `${repo.owner}/${repo.name}`;
  const deleted = await ctx.provider.deleteBake({ repo });
  await forgetBakeConfig({ provider: ctx.provider.id, repo });
  if (!deleted) throw new Error(`no bake of ${slug} on ${ctx.provider.id}`);
  console.log(`deleted the bake of ${slug} on ${ctx.provider.id}`);
}
