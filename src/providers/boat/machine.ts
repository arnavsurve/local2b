import type { BoatApi, Sandbox } from '@boatdev/sdk';
import type { Config } from '../../config';
import { step } from '../../progress';
import { buildBaseImage } from '../../toolkit/base-image';
import { withHeartbeat } from '../../toolkit/keepalive';
import type { Machine, MachineHost } from '../../toolkit/machine';
import { runChecked, withEnv } from '../../toolkit/session';
import { shellQuote } from '../../shell';
import { UnsupportedError, type PublicUrl } from '../types';
import { boatCall, boatClient, isNotFound, loadSdk, responseOf, warnOnError } from './api';
import {
  BASE_SNAPSHOT,
  HOME_DIR,
  IGNORE_COMMAND_LOGS,
  LIVE_STATES,
  PREFER_IPV4_WITHOUT_IPV6_ROUTE,
  STOCK_IMAGE,
  bakeFilter,
  bakedBoxName,
  baseImageScript,
  createRequest,
  forkRequest,
  isExpiredBox,
  newestBake,
  repoBakes,
  exitCodeOf,
  inDirCommand,
  nameFilter,
  savedSnapshotName,
  summaryOf,
  ttlSeconds,
  workdirOf,
  writeRoute,
} from './requests';
import { interactiveSsh, withSsh, writeOverSsh } from './ssh';

const HEARTBEATS_PER_IDLE_WINDOW = 3;
const READY_TIMEOUT_MS = 15 * 60_000;
const STOP_TIMEOUT_MS = 30 * 60_000;
const STOP_POLL_MS = 3000;

const unsupported = (operation: string, suggestion: string) =>
  new UnsupportedError({ provider: 'boat', operation, suggestion });

/** A command finished without an exit frame: boat reported an error instead. */
class StreamError extends Error {}

/** Everything one boat sandbox does for the toolkit, kept alive by re-arming its auto-stop deadline. */
function wrapSandbox({ api, sandbox, idleMs }: { api: BoatApi; sandbox: Pick<Sandbox, 'id' | 'labels'>; idleMs: number }) {
  const sandboxId = sandbox.id;
  const keepAlive = async () => {
    await boatCall({ what: 'keepalive', call: () => api.update({ sandboxId, ttlSeconds: ttlSeconds({ idleMs }) }) });
  };
  const held = <T>(task: () => Promise<T>) =>
    withHeartbeat({ intervalMs: idleMs / HEARTBEATS_PER_IDLE_WINDOW, beat: keepAlive, task });

  /** Detached plus attach, so a command has no time cap; the SDK reconnects the stream on its own. */
  const exec: Machine['exec'] = ({ cmd, cwd, onOutput }) =>
    held(async () => {
      let processId: number | null = null;
      let finished = false;
      try {
        const { runCommand } = await loadSdk();
        for await (const frame of runCommand(api, sandboxId, inDirCommand({ cwd, cmd }))) {
          if (frame.type === 'started') processId = Number(frame.processId);
          else if (frame.type === 'stdout' || frame.type === 'stderr') {
            if (frame.data) onOutput({ stream: frame.type, data: String(frame.data) });
          } else if (frame.type === 'exit') {
            finished = true;
            return exitCodeOf({ frame });
          } else if (frame.type === 'error') {
            finished = true;
            throw new StreamError(`boat command failed: ${frame.message ?? frame.error ?? 'unknown error'}`);
          }
        }
        throw new StreamError('boat ended the command stream without an exit code');
      } finally {
        if (!finished && processId !== null) {
          const pid = processId;
          await api.stopCommand({ sandboxId, processId: pid }).catch(warnOnError(`stopping command ${pid} in ${sandboxId}`));
        }
      }
    });

  const writeFile: Machine['writeFile'] = async ({ path, content }) => {
    if (writeRoute({ path }) === 'files-api') {
      await boatCall({ what: 'file write', call: () => api.writeFile({ sandboxId, path, content, encoding: 'utf8' }) });
      return;
    }
    await withSsh({ api, sandboxId, task: (session) => writeOverSsh({ session, path, content }) });
  };

  const machine: Machine = {
    id: sandboxId,
    homeDir: HOME_DIR,
    workdir: workdirOf({ sandbox }),
    exec,
    shell: () => Promise.reject(unsupported('a PTY shell', 'use `l2b shell`, which connects over ssh')),
    writeFile,
    publicUrl: () => {
      throw unsupported('a synchronous public URL', 'use `l2b url`');
    },
    pause: () =>
      Promise.reject(
        unsupported(
          'pause',
          'boat has no memory pause and l2b boxes keep no disk once stopped; push your branch and use `l2b down`'
        )
      ),
    destroy: async () => {
      await boatCall({
        what: 'delete',
        call: () => api.deleteSandbox({ sandboxId, xAsciiConfirmDelete: sandboxId }),
      });
    },
    snapshot: () => Promise.reject(unsupported('filesystem snapshots of a running box', 'use `l2b bake`')),
  };
  return { machine, held };
}

export type BoatHosts = {
  /** Ordinary boxes: snapshots off, erased by the stop at the end of the idle window. Starting from a bake forks it. */
  boxes: MachineHost;
  /** Creates a bake box, which has snapshots on so it can be kept once stopped. */
  startBake(opts: { name: string; bake: string; image: string }): Promise<Machine>;
  /** Stops a finished bake box so boat keeps its disk, replaces older bakes of the same name, and returns when it stopped. */
  keepBake(opts: { machine: Machine; bake: string }): Promise<Date>;
  publicUrl(opts: { name: string; port: number }): Promise<PublicUrl>;
  attach(opts: { name: string; cwd: string }): Promise<number>;
  prepare(): Promise<string>;
};

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_MAX_WAIT_S = 70;

/** Retries a start that boat refuses with 429 when the wait boat asks for is short (its per-minute limit). */
async function retryStarts<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const cause = err instanceof Error && 'cause' in err ? err.cause : err;
      const response = responseOf(cause);
      if (response?.status !== 429 || attempt >= RATE_LIMIT_RETRIES) throw err;
      const wait = Number(response.headers.get('retry-after')) || 30;
      if (wait > RATE_LIMIT_MAX_WAIT_S) throw err;
      step(`boat start limit reached, retrying in ${wait}s`);
      await Bun.sleep(wait * 1000);
    }
  }
}

/** boat sandboxes as toolkit machines: label names, an auto-stop deadline re-armed by a heartbeat, bakes kept as stopped boxes. */
export function createBoatHosts({ config, idle }: { config: Config['boat']; idle: { ms: number } }): BoatHosts {
  const api = boatClient({ config });
  const defaultImage = baseImageScript(config) === null ? STOCK_IMAGE : BASE_SNAPSHOT;

  async function findSandbox({ name }: { name: string }) {
    const client = await api();
    const { sandboxes } = await boatCall({
      what: 'list',
      call: () => client.sandboxes({ label: nameFilter({ name }), state: LIVE_STATES.join(','), limit: 10 }),
    });
    return sandboxes[0] ?? null;
  }

  async function requireSandbox({ name }: { name: string }) {
    const sandbox = await findSandbox({ name });
    if (!sandbox) throw new Error(`no sandbox named "${name}" (try: l2b ls)`);
    return sandbox;
  }

  async function stopped({ label }: { label: string[] | undefined }) {
    const client = await api();
    const found: Sandbox[] = [];
    let cursor: string | null = null;
    do {
      const page = await boatCall({
        what: 'list',
        call: () => client.sandboxes({ state: 'archived', label, limit: 100, cursor }),
      });
      found.push(...page.sandboxes);
      cursor = page.pageInfo?.hasMore ? (page.pageInfo.nextCursor ?? null) : null;
    } while (cursor);
    return found;
  }

  const findBake = async ({ bake }: { bake: string }) => newestBake({ sandboxes: await stopped({ label: bakeFilter({ bake }) }), bake });

  /**
   * A forked box can keep its disk when it stops, so stopped l2b boxes are
   * deleted on the next start. Expiry itself needs no local process.
   */
  async function sweepExpired() {
    const client = await api();
    const expired = (await stopped({ label: undefined })).filter((sandbox) => isExpiredBox({ sandbox }));
    await Promise.all(
      expired.map((sandbox) =>
        client
          .deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id })
          .catch(warnOnError(`deleting expired box ${sandbox.id}`))
      )
    );
  }

  async function create({
    name,
    image,
    workdir,
    idleMs,
    bake,
  }: {
    name: string;
    image: string;
    workdir: string;
    idleMs: number;
    bake: string | null;
  }) {
    if (await findSandbox({ name })) {
      throw new Error(`sandbox "${name}" already exists: reuse it with \`l2b exec ${name} -- <cmd>\`, or \`l2b down ${name}\` first`);
    }
    await sweepExpired().catch(warnOnError('sweeping expired boxes'));
    const client = await api();
    const source = image === STOCK_IMAGE ? null : await findBake({ bake: savedSnapshotName({ name: image }) });
    let sandboxId: string;
    let labels: Record<string, string> | undefined;
    if (source) {
      const request = forkRequest({ name, image, workdir, idleMs, config, bake });
      labels = request.labels;
      const forked = await retryStarts(() =>
        boatCall({ what: 'fork', call: () => client.fork({ sandboxId: source.id, forkRequest: request }) })
      );
      sandboxId = forked.sandbox?.id ?? forked.id;
      await client.update({ sandboxId, name }).catch(warnOnError(`naming box ${sandboxId}`));
    } else {
      const request = createRequest({ name, image, workdir, idleMs, config, bake });
      labels = request.labels;
      const created = await retryStarts(() => boatCall({ what: 'create', call: () => client.create(request) })).catch(
        (err: unknown) => {
          if (image === BASE_SNAPSHOT && isNotFound(err)) {
            throw new Error(`no ${BASE_SNAPSHOT} bake found (boat keeps one at least 14 days); run \`l2b image build --provider boat\``);
          }
          throw err;
        }
      );
      sandboxId = created.sandbox.id;
    }
    const { machine } = wrapSandbox({ api: client, sandbox: { id: sandboxId, labels }, idleMs });
    try {
      const { waitUntilReady } = await loadSdk();
      await waitUntilReady(client, sandboxId, { timeoutMs: READY_TIMEOUT_MS });
      const network = await machine.exec({ cmd: PREFER_IPV4_WITHOUT_IPV6_ROUTE, cwd: HOME_DIR, onOutput: () => {} });
      if (network !== 0) throw new Error(`network setup in the box failed (exit ${network})`);
    } catch (err) {
      await client
        .deleteSandbox({ sandboxId, xAsciiConfirmDelete: sandboxId })
        .catch(warnOnError(`deleting box ${sandboxId} after a failed start`));
      throw err;
    }
    return machine;
  }

  async function keepBake({ machine, bake }: { machine: Machine; bake: string }) {
    const client = await api();
    const sandboxId = machine.id;
    const ignored = await machine.exec({ cmd: IGNORE_COMMAND_LOGS, cwd: HOME_DIR, onOutput: () => {} });
    if (ignored !== 0) throw new Error(`could not write .boatignore in bake box (exit ${ignored})`);
    await boatCall({ what: 'rename', call: () => client.update({ sandboxId, name: bakedBoxName({ bake }) }) });
    await boatCall({ what: 'stop', call: () => client.stop({ sandboxId }) });
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    let stoppedAt: Date | null = null;
    while (!stoppedAt) {
      const { sandbox } = await boatCall({ what: 'status', call: () => client.get({ sandboxId }) });
      if (sandbox.state === 'archived' && sandbox.stoppedAt) stoppedAt = sandbox.stoppedAt;
      else if (sandbox.state === 'error') throw new Error(`bake box ${sandboxId} failed to stop: ${sandbox.error ?? 'no reason given'}`);
      else if (Date.now() > deadline) throw new Error(`bake box ${sandboxId} is still stopping after ${STOP_TIMEOUT_MS / 60_000} minutes`);
      else await Bun.sleep(STOP_POLL_MS);
    }
    for (const old of await stopped({ label: bakeFilter({ bake }) })) {
      if (old.id === sandboxId) continue;
      await boatCall({ what: 'delete', call: () => client.deleteSandbox({ sandboxId: old.id, xAsciiConfirmDelete: old.id }) });
    }
    return stoppedAt;
  }

  const boxes: MachineHost = {
    id: 'boat',
    homeDir: HOME_DIR,
    defaultImage,
    create: ({ name, image, workdir, idle: override }) =>
      create({ name, image, workdir, idleMs: override ? override.minutes * 60_000 : idle.ms, bake: null }),
    async connect({ name }) {
      const sandbox = await requireSandbox({ name });
      return wrapSandbox({ api: await api(), sandbox, idleMs: idle.ms }).machine;
    },
    async list() {
      const client = await api();
      const found = [];
      let cursor: string | null = null;
      do {
        const page = await boatCall({
          what: 'list',
          call: () => client.sandboxes({ state: LIVE_STATES.join(','), limit: 100, cursor }),
        });
        found.push(...page.sandboxes.flatMap((sandbox) => summaryOf({ sandbox }) ?? []));
        cursor = page.pageInfo?.hasMore ? (page.pageInfo.nextCursor ?? null) : null;
      } while (cursor);
      return found;
    },
    exists: async ({ name }) => (await findSandbox({ name })) !== null,
    async findSnapshot({ name }) {
      const bake = savedSnapshotName({ name });
      const found = await findBake({ bake });
      return found ? { id: bake, createdAt: found.stoppedAt } : null;
    },
    listSnapshots: async () => repoBakes({ sandboxes: await stopped({ label: undefined }) }),
    /** Deletes the bake and every older stopped box kept under its name. */
    async deleteSnapshot({ name }) {
      const bake = savedSnapshotName({ name });
      const kept = await stopped({ label: bakeFilter({ bake }) });
      const client = await api();
      for (const sandbox of kept) {
        await boatCall({ what: 'delete', call: () => client.deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id }) });
      }
      return newestBake({ sandboxes: kept, bake }) !== null;
    },
    imageRecipe: () => baseImageScript(config),
    imageExists: async () => (await findBake({ bake: savedSnapshotName({ name: BASE_SNAPSHOT }) })) !== null,
    buildImage: () => buildBase(),
  };

  async function buildBase() {
    const script = baseImageScript(config);
    if (script === null) throw new Error('nothing to build: boat.aptPackages and boat.imageCommands are empty');
    const name = 'l2b-image-build';
    if (await findSandbox({ name })) throw new Error(`stale image box "${name}" exists; run: l2b down ${name}`);
    step(`creating image box "${name}"`);
    const machine = await create({ name, image: STOCK_IMAGE, workdir: HOME_DIR, idleMs: idle.ms, bake: BASE_SNAPSHOT });
    await runChecked({ box: machine, cwd: HOME_DIR, what: `image build (sandbox ${name} left up for inspection)`, cmd: script });
    step('stopping the image box so boat keeps its disk');
    await keepBake({ machine, bake: BASE_SNAPSHOT });
    return BASE_SNAPSHOT;
  }

  return {
    boxes,
    startBake: ({ name, bake, image }) => create({ name, image, workdir: HOME_DIR, idleMs: idle.ms, bake }),
    keepBake,
    async publicUrl({ name, port }) {
      const client = await api();
      const sandbox = await requireSandbox({ name });
      const hosted = await boatCall({ what: 'host port', call: () => client.hostPort({ sandboxId: sandbox.id, port }) });
      if (!hosted.url) throw new Error(`boat returned no URL for port ${port}`);
      const gated = hosted.url.includes('_token=');
      return {
        url: hosted.url,
        note: [
          gated ? 'the URL carries an access token; anyone who has it can open the port' : null,
          'the service must listen on 0.0.0.0',
        ]
          .filter(Boolean)
          .join('; '),
      };
    },
    async attach({ name, cwd }) {
      const client = await api();
      const sandbox = await requireSandbox({ name });
      const { held } = wrapSandbox({ api: client, sandbox, idleMs: idle.ms });
      const remote = withEnv({ homeDir: HOME_DIR, cmd: `cd ${shellQuote(cwd)} && exec bash -l` });
      return held(() =>
        withSsh({ api: client, sandboxId: sandbox.id, task: (session) => interactiveSsh({ session, remote }) })
      );
    },
    async prepare() {
      if (baseImageScript(config) === null) {
        return "boat's stock image is used as is; set boat.aptPackages or boat.imageCommands to add tools";
      }
      return `kept bake ${await buildBaseImage({ host: boxes })} (boat keeps it at least 14 days)`;
    },
  };
}
