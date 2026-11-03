import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { bakeScript } from '../git-scripts';
import { checkoutDir, mirrorDir, repoName, snapshotName } from '../repo';
import type { Command } from '../context';
import { step } from '../progress';
import { configureGit, pushCreds, pushEnv, runChecked, scrubCreds } from '../session';
import { HOME } from '../shell';
import { resolveImage, secretSourcesFor } from '../sources';

/**
 * Builds the per-repo snapshot: a bare partial mirror plus a checkout with
 * dependencies installed. `up` switches that checkout to the requested branch,
 * so each box pays for a quick incremental install instead of a full one. Credentials are used to clone, then scrubbed,
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
      warm: { type: 'string' },
      branch: { type: 'string' },
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

  step(`creating bake box "${bakeName}"`);
  const box = await ctx.provider.create({
    name: bakeName,
    image: resolveImage({ ctx, override: values.image ?? null }),
    workdir: HOME,
  });
  await pushCreds({
    box,
    sources: secretSourcesFor({ ctx, doppler: values.doppler ?? null }),
  });
  await pushEnv({ box, env: ctx.config.repos[repo]?.env ?? {} });
  await configureGit({ box });
  step('cloning the mirror and installing dependencies (several minutes)');
  await runChecked({
    box,
    cwd: HOME,
    what: `bake (sandbox ${bakeName} left up for inspection)`,
    cmd: bakeScript({
      repo,
      mirror: mirrorDir(repo),
      checkout: checkoutDir(repo),
      install: values.install ?? ctx.config.repos[repo]?.install ?? null,
      warm: values.warm ?? ctx.config.repos[repo]?.warm ?? null,
      branch: values.branch ?? ctx.config.repos[repo]?.baseBranch ?? null,
      depth: ctx.config.cloneDepth,
    }),
  });

  step('snapshotting');
  await scrubCreds({ box });
  const snapshotId = await box.snapshot({ name: snapshotName(repo) });
  await box.destroy();
  console.log(`baked ${snapshotId}`);
};
