import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { resolveCredentials } from '../credentials';
import { parseDuration } from '../duration';
import { repoSpecFor } from '../repo';
import { COMMAND_HELP } from '../help';
import { selectForRepo, type Command } from '../context';
import { formatAge } from '../snapshots';

/**
 * Makes the repo's bake on the selected provider, so later boxes start fast.
 * `--if-older-than` skips the work while the current bake is recent enough.
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
    },
  });
  const repo = requirePositional({
    positionals,
    index: 0,
    usage: COMMAND_HELP.bake.usage,
  });
  const ctx = selectForRepo({ ctx: base, repo });
  const spec = repoSpecFor({
    config: ctx.config,
    repo,
    install: values.install ?? null,
    warm: values.warm ?? null,
    baseBranch: values.branch ?? null,
  });
  const skipIfNewerThanMs = values['if-older-than'] ? parseDuration(values['if-older-than']) : null;
  if (skipIfNewerThanMs !== null) {
    const bakedAt = await ctx.provider.bakedAt({ repo: spec });
    const ageMs = bakedAt ? Date.now() - bakedAt.getTime() : null;
    if (ageMs !== null && ageMs < skipIfNewerThanMs) {
      console.log(
        `snapshot for ${repo} is ${formatAge({ hours: ageMs / 3_600_000 })} old, newer than ${values['if-older-than']}; skipping bake`
      );
      return;
    }
  }
  const result = await ctx.provider.bake({
    repo: spec,
    credentials: await resolveCredentials({ config: ctx.config, repo, doppler: values.doppler ?? null }),
    image: values.image ?? ctx.config.image,
  });
  console.log(`baked ${result.summary}`);
};
