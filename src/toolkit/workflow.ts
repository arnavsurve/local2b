import { step } from '../progress';
import type { Box, Provider, RepoSpec, StartOpts, Terminal } from '../providers/types';
import { shellQuote } from '../shell';
import { lookupSnapshot, recordBake } from './bake-records';
import { bakeScript, cloneCommand, switchScript } from './git-scripts';
import { checkoutDir, mirrorDir, snapshotName } from './layout';
import type { Machine, MachineHost } from './machine';
import { putFile } from './files';
import { configureGit, configureGitIdentity, pushEnv, runChecked, runSetup, scrubCreds, withEnv, writeCredentials } from './session';

/**
 * The snapshot-and-mirror workflow over a `MachineHost`: a bake is a
 * filesystem snapshot holding a bare partial mirror plus an installed
 * checkout; a start boots that snapshot, switches the checkout to the branch
 * and installs incrementally. Credentials live in a tmpfs env file that every
 * command sources, and are scrubbed before a snapshot.
 */

const slugOf = (repo: RepoSpec) => `${repo.owner}/${repo.name}`;

/** The snapshot decides the layout, not the current config: a baked mirror is used when present. */
async function existingMirror({ machine, repo }: { machine: Machine; repo: string }) {
  const mirror = mirrorDir({ homeDir: machine.homeDir, repo });
  const code = await machine.exec({ cmd: `test -d ${shellQuote(mirror)}`, cwd: machine.homeDir, onOutput: () => {} });
  return code === 0 ? mirror : null;
}

async function installDependencies({ machine, dir, install }: { machine: Machine; dir: string; install: string | null }) {
  if (!install) return;
  step(`installing dependencies: ${install}`);
  await runChecked({ box: machine, cwd: dir, what: 'install', cmd: install });
}

async function checkout({
  machine,
  repo,
  branch,
  fromSnapshot,
}: {
  machine: Machine;
  repo: RepoSpec;
  branch: string | null;
  fromSnapshot: 'snapshot' | 'clone';
}) {
  const slug = slugOf(repo);
  const dir = checkoutDir({ homeDir: machine.homeDir, repo: slug });
  if (fromSnapshot === 'snapshot') {
    const mirror = await existingMirror({ machine, repo: slug });
    step(`checking out ${branch ?? 'the default branch'}`);
    await runChecked({
      box: machine,
      cwd: machine.homeDir,
      what: 'branch checkout',
      cmd: switchScript({ mirror, dir, branch, depth: repo.clone.depth }),
    });
  } else {
    step('no baked snapshot for this repo, cloning (slow; run `l2b bake` once to speed this up)');
    await runSetup({ box: machine, setup: repo.setup, failureNote: null });
    await runChecked({
      box: machine,
      cwd: machine.homeDir,
      what: 'git clone',
      cmd: cloneCommand({ remote: repo.remoteUrl, dir, branch, depth: repo.clone.depth, filter: repo.clone.filter }),
    });
  }
  await installDependencies({ machine, dir, install: repo.install });
}

async function attachShell({ machine, terminal, cwd }: { machine: Machine; terminal: Terminal; cwd: string | null }) {
  const session = await machine.shell({
    ...terminal.size(),
    cwd: cwd ?? machine.workdir,
    onData: (data) => terminal.write(data),
  });
  const offResize = terminal.onResize((size) => {
    void session.resize(size).catch(() => {});
  });
  const offInput = terminal.onInput((data) => {
    void session.sendInput(data).catch(() => {});
  });
  try {
    await session.sendInput(new TextEncoder().encode(`${withEnv({ homeDir: machine.homeDir, cmd: 'clear' })}\n`));
    return await session.wait();
  } finally {
    offResize();
    offInput();
  }
}

function asBox({ name, machine }: { name: string; machine: Machine }): Box {
  return {
    name,
    workdir: machine.workdir,
    exec: ({ cmd, cwd, onOutput }) =>
      machine.exec({ cmd: withEnv({ homeDir: machine.homeDir, cmd }), cwd: cwd ?? machine.workdir, onOutput }),
    attach: ({ terminal, cwd }) => attachShell({ machine, terminal, cwd }),
    put: ({ path, content, executable }) => putFile({ box: machine, path, content, executable }),
    url: async ({ port }) => ({ url: machine.publicUrl({ port }), note: null }),
    refreshCredentials: ({ credentials }) => writeCredentials({ box: machine, credentials }),
    pause: () => machine.pause(),
    destroy: () => machine.destroy(),
  };
}

/** A workflow-level `Provider` built from machine primitives. */
export function machineWorkflow({ host }: { host: MachineHost }): Provider {
  async function start({ name, repo, branch, source, image, idle, credentials, gitIdentity }: StartOpts) {
    step('looking for a baked snapshot');
    const snapshot = repo && source === 'bake' ? await lookupSnapshot({ provider: host, repo: slugOf(repo) }) : null;
    const workdir = repo ? checkoutDir({ homeDir: host.homeDir, repo: slugOf(repo) }) : host.homeDir;
    step(`creating box "${name}"`);
    const machine = await host.create({ name, image: snapshot?.id ?? image ?? host.defaultImage, workdir, idle });
    try {
      step('pushing credentials');
      await writeCredentials({ box: machine, credentials });
      await pushEnv({ box: machine, env: repo?.env ?? {} });
      if (credentials.git) await configureGit({ box: machine, host: credentials.git });
      await configureGitIdentity({ box: machine, identity: gitIdentity });
      if (repo) await checkout({ machine, repo, branch, fromSnapshot: snapshot ? 'snapshot' : 'clone' });
    } catch (err) {
      await machine.destroy().catch(() => {});
      throw err;
    }
    step('ready');
    return asBox({ name, machine });
  }

  /**
   * Credentials are used to clone, then scrubbed, and the snapshot is
   * filesystem-only so no memory (and no secret) is kept. A failed bake leaves
   * its box up for inspection.
   */
  async function bake({ repo, credentials, image }: Parameters<Provider['bake']>[0]) {
    const slug = slugOf(repo);
    const bakeName = `bake-${repo.name}`;
    if (await host.exists({ name: bakeName })) {
      throw new Error(`stale bake sandbox "${bakeName}" exists; run: l2b down ${bakeName}`);
    }
    step(`creating bake box "${bakeName}"`);
    const machine = await host.create({ name: bakeName, image: image ?? host.defaultImage, workdir: host.homeDir, idle: null });
    await writeCredentials({ box: machine, credentials });
    await pushEnv({ box: machine, env: repo.env });
    if (credentials.git) await configureGit({ box: machine, host: credentials.git });
    await runSetup({ box: machine, setup: repo.setup, failureNote: `(sandbox ${bakeName} left up for inspection)` });
    console.log(`clone strategy: ${repo.clone.strategy}`);
    step('cloning and installing dependencies (several minutes)');
    const dir = checkoutDir({ homeDir: machine.homeDir, repo: slug });
    await runChecked({
      box: machine,
      cwd: machine.homeDir,
      what: `bake (sandbox ${bakeName} left up for inspection)`,
      cmd: bakeScript({
        remote: repo.remoteUrl,
        mirror: repo.clone.strategy === 'mirror' ? mirrorDir({ homeDir: machine.homeDir, repo: slug }) : null,
        checkout: dir,
        install: null,
        warm: null,
        branch: repo.baseBranch,
        depth: repo.clone.depth,
        filter: repo.clone.filter,
      }),
    });
    const prepare = [repo.install, repo.warm].filter((cmd) => cmd !== null && cmd !== '');
    if (prepare.length > 0) {
      await runChecked({
        box: machine,
        cwd: dir,
        what: `bake install (sandbox ${bakeName} left up for inspection)`,
        cmd: prepare.join(' && '),
      });
    }
    step('snapshotting');
    await scrubCreds({ box: machine });
    const snapshotId = await machine.snapshot({ name: snapshotName(slug) });
    await machine.destroy();
    const bakedAt = new Date();
    await recordBake({ provider: host.id, repo: slug, at: bakedAt });
    return { summary: snapshotId, bakedAt };
  }

  return {
    id: host.id,
    prepare: async () => `built image ${await host.buildImage()}`,
    bake,
    bakedAt: async ({ repo }) => (await lookupSnapshot({ provider: host, repo: slugOf(repo) }))?.createdAt ?? null,
    start,
    connect: async ({ name }) => asBox({ name, machine: await host.connect({ name }) }),
    exists: (opts) => host.exists(opts),
    list: () => host.list(),
  };
}
