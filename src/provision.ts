import type { Context } from './context';
import {
  fullCloneCommand,
  shallowCloneCommand,
  switchScript,
} from './git-scripts';
import { hostFor, remoteUrl, type GitHost } from './git-host';
import { step } from './progress';
import type { Box } from './providers/types';
import { checkoutDir, mirrorDir, snapshotName } from './repo';
import { configureGit, pushCreds, pushEnv, runChecked } from './session';
import { HOME } from './shell';
import { secretSourcesFor, resolveImage } from './sources';

export type ProvisionOpts = {
  name: string;
  repo: string | null;
  branch: string | null;
  full: boolean;
  install: string | null;
  doppler: string | null;
  image: string | null;
};

async function checkoutFromSnapshot({
  box,
  repo,
  branch,
  install,
  depth,
}: {
  box: Box;
  repo: string;
  branch: string | null;
  install: string | null;
  depth: number;
}) {
  const dir = checkoutDir(repo);
  step(`checking out ${branch ?? 'the default branch'}`);
  await runChecked({
    box,
    cwd: HOME,
    what: 'branch checkout',
    cmd: switchScript({ mirror: mirrorDir(repo), dir, branch, depth }),
  });
  if (!install) return;
  step(`installing dependencies: ${install}`);
  await runChecked({ box, cwd: dir, what: 'install', cmd: install });
}

async function checkoutFromClone({
  box,
  repo,
  host,
  branch,
  full,
}: {
  box: Box;
  repo: string;
  host: GitHost;
  branch: string | null;
  full: boolean;
}) {
  step('no baked snapshot for this repo, cloning (slow; run `l2b bake` once to speed this up)');
  const clone = full ? fullCloneCommand : shallowCloneCommand;
  await runChecked({
    box,
    cwd: HOME,
    what: 'git clone',
    cmd: clone({ remote: remoteUrl({ host, repo }), dir: checkoutDir(repo), branch }),
  });
}

/**
 * Creates a box with credentials and, when a repo is given, a checkout of the
 * branch. If setup fails after the box exists, the box is destroyed rather
 * than left behind.
 */
export async function provisionBox({
  ctx,
  opts,
}: {
  ctx: Context;
  opts: ProvisionOpts;
}) {
  const { name, repo, branch, full } = opts;
  step('looking for a baked snapshot');
  const snapshotId =
    repo && !full
      ? await ctx.provider.findSnapshot({ name: snapshotName(repo) })
      : null;
  const image = snapshotId ?? resolveImage({ ctx, override: opts.image });
  const host = hostFor({ config: ctx.config, repo });
  const workdir = repo ? checkoutDir(repo) : HOME;

  step(`creating box "${name}"`);
  const box = await ctx.provider.create({ name, image, workdir });
  try {
    step('pushing credentials');
    await pushCreds({
      box,
      host,
      sources: secretSourcesFor({ ctx, doppler: opts.doppler }),
    });
    await pushEnv({ box, env: repo ? (ctx.config.repos[repo]?.env ?? {}) : {} });
    await configureGit({ box, host });
    if (repo && snapshotId) {
      await checkoutFromSnapshot({
        box,
        repo,
        branch,
        install: opts.install ?? ctx.config.repos[repo]?.install ?? null,
        depth: ctx.config.cloneDepth,
      });
    } else if (repo) {
      await checkoutFromClone({ box, repo, host, branch, full });
    }
  } catch (err) {
    await box.destroy().catch(() => {});
    throw err;
  }
  step('ready');
  return box;
}
