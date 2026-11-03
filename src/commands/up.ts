import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import {
  fullCloneCommand,
  shallowCloneCommand,
  worktreeScript,
} from '../git-scripts';
import { mirrorDir, repoName, snapshotName, worktreeDir } from '../repo';
import type { Command } from '../context';
import type { Box } from '../providers/types';
import { configureGit, pushCreds, runChecked } from '../session';
import { HOME } from '../shell';
import { resolveImage, secretSources } from './shared';

async function checkoutFromSnapshot({
  box,
  repo,
  branch,
}: {
  box: Box;
  repo: string;
  branch: string | null;
}) {
  const dir = worktreeDir(branch);
  await runChecked({
    box,
    cwd: HOME,
    what: 'worktree checkout',
    cmd: worktreeScript({ mirror: mirrorDir(repo), dir, branch }),
  });
  return dir;
}

async function checkoutFromClone({
  box,
  repo,
  branch,
  full,
}: {
  box: Box;
  repo: string;
  branch: string | null;
  full: boolean;
}) {
  const dir = `${HOME}/${repoName(repo)}`;
  const clone = full ? fullCloneCommand : shallowCloneCommand;
  await runChecked({
    box,
    cwd: HOME,
    what: 'git clone',
    cmd: clone({ repo, dir, branch }),
  });
  return dir;
}

export const up: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      branch: { type: 'string' },
      full: { type: 'boolean', default: false },
      doppler: { type: 'string' },
      image: { type: 'string' },
    },
  });
  const name = requirePositional({ positionals, index: 0, usage: 'l2b up <name>' });
  const repo = values.repo ?? null;
  const branch = values.branch ?? null;

  const snapshotId =
    repo && !values.full
      ? await ctx.provider.findSnapshot({ name: snapshotName(repo) })
      : null;
  const image = snapshotId ?? resolveImage({ ctx, override: values.image ?? null });
  const box = await ctx.provider.create({ name, image });
  await pushCreds({
    box,
    sources: secretSources({ ctx, doppler: values.doppler ?? null }),
  });
  await configureGit({ box });

  if (repo) {
    const dir = snapshotId
      ? await checkoutFromSnapshot({ box, repo, branch })
      : await checkoutFromClone({ box, repo, branch, full: values.full });
    console.log(`checkout: ${dir}`);
  }
  console.log(`${name} ready (${box.id})`);
};
