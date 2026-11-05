import type { Context } from './context';
import { cloneCommand, switchScript } from './toolkit/git-scripts';
import { resolveClone, type CloneOptions } from './config';
import { hostFor, remoteUrl, type ResolvedGitHost } from './git-host';
import { describeInstall, resolveInstall } from './toolkit/install';
import { step } from './progress';
import type { Machine } from './toolkit/machine';
import { checkoutDir, mirrorDir } from './toolkit/layout';
import { shellQuote } from './shell';
import { resolveGitIdentity } from './git-identity';
import { configureGit, configureGitIdentity, pushCreds, pushEnv, runChecked } from './toolkit/session';
import { lookupSnapshot } from './toolkit/bake-records';
import { staleSnapshotHint } from './snapshots';
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

/**
 * The snapshot decides the layout, not the current config: a baked mirror is
 * used when present, otherwise the checkout is a plain clone fetched in place.
 */
async function existingMirror({ box, repo }: { box: Machine; repo: string }) {
  const mirror = mirrorDir({ homeDir: box.homeDir, repo });
  const code = await box.exec({ cmd: `test -d ${shellQuote(mirror)}`, cwd: box.homeDir, onOutput: () => {} });
  return code === 0 ? mirror : null;
}

async function installDependencies({
  box,
  dir,
  configured,
}: {
  box: Machine;
  dir: string;
  configured: string | null;
}) {
  if (configured === '') return;
  const resolved = await resolveInstall({ box, dir, configured });
  step(describeInstall({ install: resolved }));
  if (!resolved) return;
  await runChecked({ box, cwd: dir, what: 'install', cmd: resolved.command });
}

async function checkoutFromSnapshot({
  box,
  repo,
  branch,
  install,
  depth,
}: {
  box: Machine;
  repo: string;
  branch: string | null;
  install: string | null;
  depth: number | null;
}) {
  const dir = checkoutDir({ homeDir: box.homeDir, repo });
  const mirror = await existingMirror({ box, repo });
  step(`checking out ${branch ?? 'the default branch'}`);
  await runChecked({
    box,
    cwd: box.homeDir,
    what: 'branch checkout',
    cmd: switchScript({ mirror, dir, branch, depth }),
  });
  await installDependencies({ box, dir, configured: install });
}

async function checkoutFromClone({
  box,
  repo,
  host,
  branch,
  clone,
  install,
}: {
  box: Machine;
  repo: string;
  host: ResolvedGitHost;
  branch: string | null;
  clone: CloneOptions;
  install: string | null;
}) {
  const dir = checkoutDir({ homeDir: box.homeDir, repo });
  step('no baked snapshot for this repo, cloning (slow; run `l2b bake` once to speed this up)');
  await runChecked({
    box,
    cwd: box.homeDir,
    what: 'git clone',
    cmd: cloneCommand({
      remote: remoteUrl({ host, repo }),
      dir,
      branch,
      depth: clone.depth,
      filter: clone.filter,
    }),
  });
  await installDependencies({ box, dir, configured: install });
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
  const snapshot = repo && !full ? await lookupSnapshot({ provider: ctx.provider, repo }) : null;
  const snapshotId = snapshot?.id ?? null;
  if (repo && snapshot) {
    const hint = staleSnapshotHint({
      repo,
      createdAt: snapshot.createdAt,
      now: new Date(),
      thresholdHours: ctx.config.staleSnapshotHours,
    });
    if (hint) console.error(`l2b: ${hint}`);
  }
  const image = snapshotId ?? resolveImage({ ctx, override: opts.image });
  const host = hostFor({ config: ctx.config, repo });
  const workdir = repo
    ? checkoutDir({ homeDir: ctx.provider.homeDir, repo })
    : ctx.provider.homeDir;

  step(`creating box "${name}"`);
  const box = await ctx.provider.create({ name, image, workdir, idle: null });
  try {
    step('pushing credentials');
    await pushCreds({
      box,
      host,
      sources: secretSourcesFor({ ctx, doppler: opts.doppler }),
    });
    await pushEnv({ box, env: repo ? (ctx.config.repos[repo]?.env ?? {}) : {} });
    await configureGit({ box, host });
    await configureGitIdentity({ box, identity: await resolveGitIdentity({ override: ctx.config.gitIdentity }) });
    const install = repo ? (opts.install ?? ctx.config.repos[repo]?.install ?? null) : null;
    if (repo && snapshotId) {
      await checkoutFromSnapshot({
        box,
        repo,
        branch,
        install,
        depth: resolveClone({ config: ctx.config, repo }).depth,
      });
    } else if (repo) {
      const configured = resolveClone({ config: ctx.config, repo });
      await checkoutFromClone({
        box,
        repo,
        host,
        branch,
        clone: full ? { ...configured, depth: null } : configured,
        install,
      });
    }
  } catch (err) {
    await box.destroy().catch(() => {});
    throw err;
  }
  step('ready');
  return box;
}
