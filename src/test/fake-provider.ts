import { configSchema } from '../config';
import type { Context } from '../context';
import type { Box, Provider } from '../providers/types';

/**
 * In-memory provider standing in for the remote edge (the one boundary we
 * don't own). Tests assert on which boxes are still alive afterwards.
 */
export function fakeContext({
  execExitCode,
  failExecWhen,
}: {
  execExitCode: number;
  failExecWhen: string | null;
}) {
  const alive = new Set<string>();
  const executed: string[] = [];
  const files = new Map<string, string>();
  const snapshots = new Set<string>();

  const provider: Provider = {
    id: 'fake',
    defaultImage: 'fake-image',
    async create({ name, workdir }) {
      alive.add(name);
      const box: Box = {
        id: `id-${name}`,
        workdir,
        async exec({ cmd }) {
          executed.push(cmd);
          if (failExecWhen && cmd.includes(failExecWhen)) throw new Error('exec blew up');
          return execExitCode;
        },
        async shell() {
          throw new Error('not used');
        },
        async writeFile({ path, content }) {
          files.set(path, content);
        },
        publicUrl: ({ port }) => `https://fake:${port}`,
        pause: async () => {},
        destroy: async () => {
          alive.delete(name);
        },
        snapshot: async ({ name }) => {
          snapshots.add(name);
          return 'snap';
        },
      };
      return box;
    },
    async connect() {
      throw new Error('not used');
    },
    list: async () => [],
    exists: async ({ name }) => alive.has(name),
    findSnapshot: async ({ name }) => (snapshots.has(name) ? { id: 'snap', createdAt: null } : null),
    buildImage: async () => 'fake-image',
  };

  const ctx: Context = { config: configSchema.parse({}), provider };
  return { ctx, alive, executed, files, snapshots };
}
