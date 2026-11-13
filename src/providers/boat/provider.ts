import type { Config } from '../../config';
import { step } from '../../progress';
import { bakeScript } from '../../toolkit/git-scripts';
import { bakeBoxName, checkoutDir, mirrorDir, snapshotName } from '../../toolkit/layout';
import { configureGit, pushEnv, runChecked, runSetup, scrubCreds, writeCredentials } from '../../toolkit/session';
import { ensureBaseImage } from '../../toolkit/base-image';
import { machineWorkflow } from '../../toolkit/workflow';
import type { Box, Provider } from '../types';
import { createBoatHosts } from './machine';
import { savedSnapshotName } from './requests';

/**
 * boat runs the toolkit's mirror workflow, with a bake kept as a stopped box
 * that later boxes fork. A box expires through boat's own auto-stop deadline,
 * set to the idle window at create and re-armed by a heartbeat while l2b runs
 * a command or a shell. Boxes have snapshots off, so that stop erases them.
 * Credentials reach the box over SSH stdin into tmpfs; shells are `ssh -t`.
 */
export function createBoatProvider({ config, idle }: { config: Config['boat']; idle: { ms: number } }): Provider {
  const hosts = createBoatHosts({ config, idle });
  const boxes = machineWorkflow({ host: hosts.boxes });
  const withAccess = (box: Box): Box => ({
    ...box,
    url: ({ port }) => hosts.publicUrl({ name: box.name, port }),
    attach: ({ cwd }) => hosts.attach({ name: box.name, cwd: cwd ?? box.workdir }),
  });

  /**
   * Clones and installs in a bake box, then stops it so boat keeps its disk
   * (at least 14 days). Credentials live only in tmpfs, which a stop drops;
   * they are scrubbed first anyway. A failed bake leaves its box up for
   * inspection until it expires or the next bake replaces it.
   */
  const bake: Provider['bake'] = async ({ repo, credentials, image }) => {
    const slug = `${repo.owner}/${repo.name}`;
    const label = savedSnapshotName({ name: snapshotName(slug) });
    const bakeName = bakeBoxName(slug);
    if (await hosts.boxes.exists({ name: bakeName })) {
      step(`removing box "${bakeName}" left by an earlier bake`);
      await (await hosts.boxes.connect({ name: bakeName })).destroy();
    }
    if (image === null) await ensureBaseImage({ host: hosts.boxes });
    step(`creating bake box "${bakeName}"`);
    const machine = await hosts.startBake({ name: bakeName, bake: label, image: image ?? hosts.boxes.defaultImage });
    await writeCredentials({ box: machine, credentials });
    await pushEnv({ box: machine, env: repo.env });
    if (credentials.git) await configureGit({ box: machine, host: credentials.git });
    const inspect = `(sandbox ${bakeName} left up for inspection)`;
    await runSetup({ box: machine, setup: repo.setup, failureNote: inspect });
    console.log(`clone strategy: ${repo.clone.strategy}`);
    step('cloning and installing dependencies (several minutes)');
    const dir = checkoutDir({ homeDir: machine.homeDir, repo: slug });
    await runChecked({
      box: machine,
      cwd: machine.homeDir,
      what: `bake ${inspect}`,
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
      await runChecked({ box: machine, cwd: dir, what: `bake install ${inspect}`, cmd: prepare.join(' && ') });
    }
    step('stopping the bake box so boat keeps its disk');
    await scrubCreds({ box: machine });
    const bakedAt = await hosts.keepBake({ machine, bake: label });
    return { summary: `${label} (stopped box ${machine.id}; boat keeps it at least 14 days)`, bakedAt };
  };

  return {
    ...boxes,
    prepare: () => hosts.prepare(),
    bake,
    start: async (opts) => withAccess(await boxes.start(opts)),
    connect: async (opts) => withAccess(await boxes.connect(opts)),
  };
}
