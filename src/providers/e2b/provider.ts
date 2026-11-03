import { Sandbox, Template } from 'e2b';
import type { Box, Provider } from '../types';
import type { Config } from '../../config';
import { resolveValue } from '../../secrets';
import { devTemplate } from './template';

const NAME_KEY = 'l2b';
const TIMEOUT_MS = 60 * 60 * 1000;
const BUILD_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const IMAGE_NAME = 'l2b-dev';
const LIVE_STATES: ('running' | 'paused')[] = ['running', 'paused'];

function wrapBox({ sandbox }: { sandbox: Sandbox }): Box {
  return {
    id: sandbox.sandboxId,
    async exec({ cmd, cwd, onOutput }) {
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

export function createE2bProvider({ config }: { config: Config['e2b'] }): Provider {
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

    async create({ name, image }) {
      if (await findInfo({ name })) throw new Error(`sandbox "${name}" already exists`);
      const sandbox = await Sandbox.create(image, {
        apiKey: await apiKey(),
        timeoutMs: TIMEOUT_MS,
        metadata: { [NAME_KEY]: name },
      });
      return wrapBox({ sandbox });
    },

    async connect({ name }) {
      const info = await findInfo({ name });
      if (!info) throw new Error(`no sandbox named "${name}" (try: l2b ls)`);
      const sandbox = await Sandbox.connect(info.sandboxId, {
        apiKey: await apiKey(),
        timeoutMs: TIMEOUT_MS,
      });
      return wrapBox({ sandbox });
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
          const matches = snapshot.names.some(
            (full) => full.split(':')[0]?.endsWith(`/${name}`)
          );
          if (matches) return snapshot.snapshotId;
        }
      } while (paginator.hasNext);
      return null;
    },

    async buildImage() {
      await Template.build(devTemplate({ npmGlobals: config.npmGlobals }), IMAGE_NAME, {
        apiKey: await apiKey(),
        cpuCount: config.cpuCount,
        memoryMB: config.memoryMB,
        requestTimeoutMs: BUILD_REQUEST_TIMEOUT_MS,
      });
      return IMAGE_NAME;
    },
  };
}
