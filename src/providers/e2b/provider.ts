import { Sandbox, Template } from 'e2b';
import type { Box, IdlePolicy, Provider } from '../types';
import { withHeartbeat } from '../../keepalive';
import type { Config } from '../../config';
import { resolveValue } from '../../secrets';
import { devTemplate } from './template';
import { snapshotHasName } from './snapshot-match';

const NAME_KEY = 'l2b';
const WORKDIR_KEY = 'l2b_workdir';
const FALLBACK_WORKDIR = '/home/user';
const HEARTBEATS_PER_IDLE_WINDOW = 3;
const BUILD_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const IMAGE_NAME = 'l2b-dev';
const LIVE_STATES: ('running' | 'paused')[] = ['running', 'paused'];

function wrapBox({
  sandbox,
  idle,
  workdir,
}: {
  sandbox: Sandbox;
  idle: IdlePolicy;
  workdir: string;
}): Box {
  const keepAlive = () => sandbox.setTimeout(idle.ms);
  const held = <T>(task: () => Promise<T>) =>
    withHeartbeat({
      intervalMs: idle.ms / HEARTBEATS_PER_IDLE_WINDOW,
      beat: keepAlive,
      task,
    });

  return {
    id: sandbox.sandboxId,
    workdir,
    exec: ({ cmd, cwd, onOutput }) =>
      held(async () => {
        try {
          const result = await sandbox.commands.run(cmd, {
            cwd,
            timeoutMs: 0,
            onStdout: (data) => onOutput({ stream: 'stdout', data }),
            onStderr: (data) => onOutput({ stream: 'stderr', data }),
          });
          return result.exitCode;
        } catch (err) {
          if (err instanceof Error && 'exitCode' in err && typeof err.exitCode === 'number') {
            return err.exitCode;
          }
          throw err;
        }
      }),
    async shell({ cols, rows, cwd, onData }) {
      const handle = await sandbox.pty.create({ cols, rows, cwd, onData, timeoutMs: 0 });
      return {
        sendInput: (data) => sandbox.pty.sendInput(handle.pid, data),
        resize: (size) => sandbox.pty.resize(handle.pid, size),
        wait: () =>
          held(async () => {
            try {
              return (await handle.wait()).exitCode;
            } catch (err) {
              if (err instanceof Error && 'exitCode' in err && typeof err.exitCode === 'number') {
                return err.exitCode;
              }
              throw err;
            }
          }),
      };
    },
    async writeFile({ path, content }) {
      await sandbox.files.write(path, content);
    },
    publicUrl: ({ port }) => `https://${sandbox.getHost(port)}`,
    pause: async () => {
      await sandbox.pause();
    },
    destroy: async () => {
      await sandbox.kill();
    },
    async snapshot({ name }) {
      const snapshot = await sandbox.createSnapshot({ name, mode: 'filesystem' });
      return snapshot.snapshotId;
    },
  };
}

export function createE2bProvider({
  config,
  idle,
}: {
  config: Config['e2b'];
  idle: IdlePolicy;
}): Provider {
  const apiKey = () => resolveValue(config.apiKey);

  async function findInfo({ name }: { name: string }) {
    const paginator = Sandbox.list({
      apiKey: await apiKey(),
      query: { metadata: { [NAME_KEY]: name }, state: LIVE_STATES },
    });
    const items = await paginator.nextItems();
    return items[0] ?? null;
  }

  return {
    id: 'e2b',
    defaultImage: IMAGE_NAME,

    async create({ name, image, workdir }) {
      if (await findInfo({ name })) {
        throw new Error(
          `sandbox "${name}" already exists: reuse it with \`l2b exec ${name} -- <cmd>\`, or \`l2b down ${name}\` first`
        );
      }
      const sandbox = await Sandbox.create(image, {
        apiKey: await apiKey(),
        timeoutMs: idle.ms,
        lifecycle: { onTimeout: idle.action },
        metadata: { [NAME_KEY]: name, [WORKDIR_KEY]: workdir },
      });
      return wrapBox({ sandbox, idle, workdir });
    },

    async connect({ name }) {
      const info = await findInfo({ name });
      if (!info) throw new Error(`no sandbox named "${name}" (try: l2b ls)`);
      const sandbox = await Sandbox.connect(info.sandboxId, {
        apiKey: await apiKey(),
        timeoutMs: idle.ms,
      });
      return wrapBox({
        sandbox,
        idle,
        workdir: info.metadata[WORKDIR_KEY] ?? FALLBACK_WORKDIR,
      });
    },

    async list() {
      const paginator = Sandbox.list({
        apiKey: await apiKey(),
        query: { state: LIVE_STATES },
      });
      const items = await paginator.nextItems();
      return items.flatMap((info) => {
        const name = info.metadata[NAME_KEY];
        if (!name) return [];
        return [{ name, state: info.state, id: info.sandboxId, image: info.templateId }];
      });
    },

    async exists({ name }) {
      return (await findInfo({ name })) !== null;
    },

    async findSnapshot({ name }) {
      const paginator = Sandbox.listSnapshots({ apiKey: await apiKey() });
      do {
        for (const snapshot of await paginator.nextItems()) {
          if (snapshotHasName({ names: snapshot.names, name })) {
            return { id: snapshot.snapshotId, createdAt: null };
          }
        }
      } while (paginator.hasNext);
      return null;
    },

    async buildImage() {
      await Template.build(devTemplate({
          features: config.features,
          nodeMajor: config.nodeMajor,
          npmGlobals: config.npmGlobals,
          aptPackages: config.aptPackages,
          imageCommands: config.imageCommands,
        }), IMAGE_NAME, {
        apiKey: await apiKey(),
        cpuCount: config.cpuCount,
        memoryMB: config.memoryMB,
        requestTimeoutMs: BUILD_REQUEST_TIMEOUT_MS,
      });
      return IMAGE_NAME;
    },
  };
}
