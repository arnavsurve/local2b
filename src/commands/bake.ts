import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { resolveClone } from '../config';
import { hostFor, remoteUrl } from '../git-host';
import { parseDuration } from '../duration';
import { bakeScript } from '../git-scripts';
import { checkoutDir, mirrorDir, repoName, snapshotName } from '../repo';
import { selectForRepo, type Command } from '../context';
import { describeInstall, resolveInstall } from '../install';
import { step } from '../progress';
import { configureGit, pushCreds, pushEnv, runChecked, scrubCreds } from '../session';
import { lookupSnapshot, formatAge, recordBake } from '../snapshots';
import { resolveImage, secretSourcesFor } from '../sources';

/**
 * Builds the per-repo snapshot: a bare partial mirror plus a checkout with
 * dependencies installed. `up` switches that checkout to the requested branch,
 * so each box pays for a quick incremental install instead of a full one. Credentials are used to clone, then scrubbed,
 * and the snapshot is filesystem-only so no memory (and no secret) is kept.
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
    usage: 'l2b bake <owner/repo>',
  });
  const ctx = selectForRepo({ ctx: base, repo });
  const host = hostFor({ config: ctx.config, repo });
  const skipIfNewerThanMs = values['if-older-than'] ? parseDuration(values['if-older-than']) : null;
  if (skipIfNewerThanMs !== null) {
    const existing = await lookupSnapshot({ provider: ctx.provider, repo });
    const ageMs = existing?.createdAt ? Date.now() - existing.createdAt.getTime() : null;
    if (ageMs !== null && ageMs < skipIfNewerThanMs) {
      console.log(
        `snapshot for ${repo} is ${formatAge({ hours: ageMs / 3_600_000 })} old, newer than ${values['if-older-than']}; skipping bake`
      );
      return;
    }
  }
  const bakeName = `bake-${repoName(repo)}`;
  if (await ctx.provider.exists({ name: bakeName })) {
    throw new Error(`stale bake sandbox "${bakeName}" exists; run: l2b down ${bakeName}`);
  }

  step(`creating bake box "${bakeName}"`);
  const box = await ctx.provider.create({
    name: bakeName,
    image: resolveImage({ ctx, override: values.image ?? null }),
    workdir: ctx.provider.homeDir,
  });
  await pushCreds({
    box,
    host,
    sources: secretSourcesFor({ ctx, doppler: values.doppler ?? null }),
  });
  await pushEnv({ box, env: ctx.config.repos[repo]?.env ?? {} });
  await configureGit({ box, host });
  const clone = resolveClone({ config: ctx.config, repo });
  console.log(`clone strategy: ${clone.strategy}`);
  step('cloning and installing dependencies (several minutes)');
  await runChecked({
    box,
    cwd: box.homeDir,
    what: `bake (sandbox ${bakeName} left up for inspection)`,
    cmd: bakeScript({
      remote: remoteUrl({ host, repo }),
      mirror: clone.strategy === 'mirror' ? mirrorDir({ homeDir: box.homeDir, repo }) : null,
      checkout: checkoutDir({ homeDir: box.homeDir, repo }),
      install: null,
      warm: null,
      branch: values.branch ?? ctx.config.repos[repo]?.baseBranch ?? null,
      depth: clone.depth,
      filter: clone.filter,
    }),
  });
  const checkout = checkoutDir({ homeDir: box.homeDir, repo });
  const configured = values.install ?? ctx.config.repos[repo]?.install ?? null;
  const resolved = configured === '' ? null : await resolveInstall({ box, dir: checkout, configured });
  if (configured !== '') step(describeInstall({ install: resolved }));
  const prepare = [resolved?.command ?? null, values.warm ?? ctx.config.repos[repo]?.warm ?? null].filter(
    (cmd) => cmd !== null
  );
  if (prepare.length > 0) {
    await runChecked({
      box,
      cwd: checkout,
      what: `bake install (sandbox ${bakeName} left up for inspection)`,
      cmd: prepare.join(' && '),
    });
  }

  step('snapshotting');
  await scrubCreds({ box });
  const snapshotId = await box.snapshot({ name: snapshotName(repo) });
  await box.destroy();
  await recordBake({ provider: ctx.provider.id, repo, at: new Date() });
  console.log(`baked ${snapshotId}`);
};
