import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { bakeScript } from '../git-scripts';
import { mirrorDir, repoName, seedDir, snapshotName } from '../repo';
import type { Command } from '../context';
import { configureGit, pushCreds, runChecked, scrubCreds } from '../session';
import { HOME } from '../shell';
import { resolveImage, secretSources } from './shared';

/**
 * Builds the per-repo snapshot: a bare partial mirror plus a seed worktree
 * with dependencies installed. Credentials are used to clone, then scrubbed,
 * and the snapshot is filesystem-only so no memory (and no secret) is kept.
 */
export const bake: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      doppler: { type: 'string' },
      image: { type: 'string' },
      install: { type: 'string' },
    },
  });
  const repo = requirePositional({
    positionals,
    index: 0,
    usage: 'l2b bake <owner/repo>',
  });
  const bakeName = `bake-${repoName(repo)}`;
  if (await ctx.provider.exists({ name: bakeName })) {
    throw new Error(`stale bake sandbox "${bakeName}" exists; run: l2b down ${bakeName}`);
  }

  const box = await ctx.provider.create({
    name: bakeName,
    image: resolveImage({ ctx, override: values.image ?? null }),
  });
  await pushCreds({
    box,
    sources: secretSources({ ctx, doppler: values.doppler ?? null }),
  });
  await configureGit({ box });
  await runChecked({
    box,
    cwd: HOME,
    what: `bake (sandbox ${bakeName} left up for inspection)`,
    cmd: bakeScript({
      repo,
      mirror: mirrorDir(repo),
      seed: seedDir,
      install: values.install ?? ctx.config.repos[repo]?.install ?? null,
    }),
  });

  await scrubCreds({ box });
  const snapshotId = await box.snapshot({ name: snapshotName(repo) });
  await box.destroy();
  console.log(`baked ${snapshotId}`);
};
