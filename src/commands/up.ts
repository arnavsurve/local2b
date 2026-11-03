import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import {
  fullCloneCommand,
  shallowCloneCommand,
  switchScript,
} from '../git-scripts';
import { checkoutDir, mirrorDir, snapshotName } from '../repo';
import type { Command } from '../context';
import type { Box } from '../providers/types';
import { step } from '../progress';
import { configureGit, pushCreds, runChecked } from '../session';
import { HOME } from '../shell';
import { resolveImage, secretSources } from './shared';

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
  if (install) {
    step(`installing dependencies: ${install}`);
    await runChecked({ box, cwd: dir, what: 'install', cmd: install });
  }
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
  const dir = checkoutDir(repo);
  step('no baked snapshot for this repo, cloning (slow; run `l2b bake` once to speed this up)');
  const clone = full ? fullCloneCommand : shallowCloneCommand;
  await runChecked({
    box,
    cwd: HOME,
    what: 'git clone',
    cmd: clone({ repo, dir, branch }),
  });
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
      install: { type: 'string' },
    },
  });
  const name = requirePositional({ positionals, index: 0, usage: 'l2b up <name>' });
  const repo = values.repo ?? null;
  const branch = values.branch ?? null;

  step('looking for a baked snapshot');
  const snapshotId =
    repo && !values.full
      ? await ctx.provider.findSnapshot({ name: snapshotName(repo) })
      : null;
  const image = snapshotId ?? resolveImage({ ctx, override: values.image ?? null });
  const workdir = repo ? checkoutDir(repo) : HOME;
  step(`creating box "${name}"`);
  const box = await ctx.provider.create({ name, image, workdir });
  step('pushing credentials');
  await pushCreds({
    box,
    sources: secretSources({ ctx, doppler: values.doppler ?? null }),
  });
  await configureGit({ box });

  if (repo) {
    if (snapshotId) {
      await checkoutFromSnapshot({
        box,
        repo,
        branch,
        install: values.install ?? ctx.config.repos[repo]?.install ?? null,
        depth: ctx.config.cloneDepth,
      });
    } else {
      await checkoutFromClone({ box, repo, branch, full: values.full });
    }
  }

  step('ready');
  console.log(
    [
      `${name} ready`,
      `workdir: ${box.workdir}`,
      `run:     l2b exec ${name} -- <command>`,
      `stop:    l2b down ${name}  (it also expires after ${ctx.config.idle.minutes} min idle)`,
    ].join('\n')
  );
};
