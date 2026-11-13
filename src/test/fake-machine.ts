import { ProviderAuthError } from '../providers/types';
import type { Machine, MachineHost } from '../toolkit/machine';

type FakeFailure = 'auth' | 'network' | null;

/**
 * In-memory machine host standing in for a provider SDK, for testing the
 * toolkit workflow command by command. Exec is scripted, not run: it returns
 * `execExitCode` and records each command line. Tests assert on which
 * machines are still alive afterwards.
 * `failure` makes every provider call fail the way a missing key or an
 * unreachable API would.
 *
 * The base image starts out built from `recipe-1`; `image` lets a test
 * delete it or change the recipe, and counts builds. Creating a machine from
 * the default image fails while it is not built.
 */
export function fakeMachineHost({
  id,
  execExitCode,
  homeDir,
  failure,
}: {
  id: string;
  execExitCode: number;
  homeDir: string;
  failure: FakeFailure;
}) {
  const alive = new Set<string>();
  const executed: string[] = [];
  const files = new Map<string, string>();
  const snapshots = new Set<string>();
  const image = { recipe: 'recipe-1', built: true, builds: 0 };

  const guard = () => {
    if (failure === 'auth') throw new ProviderAuthError({ provider: id, hint: `set ${id.toUpperCase()}_API_KEY` });
    if (failure === 'network') throw new Error(`${id} is unreachable`);
  };

  const makeBox = ({ name, workdir }: { name: string; workdir: string }): Machine => ({
    id: `id-${name}`,
    workdir,
    homeDir,
    async exec({ cmd }) {
      executed.push(cmd);
      return execExitCode;
    },
    async shell() {
      throw new Error('not used');
    },
    async writeFile({ path, content }) {
      files.set(path, content);
    },
    publicUrl: ({ port }) => `https://${id}:${port}/${name}`,
    pause: async () => {},
    destroy: async () => {
      alive.delete(name);
    },
    snapshot: async ({ name }) => {
      snapshots.add(name);
      return 'snap';
    },
  });

  const provider: MachineHost = {
    id,
    homeDir,
    defaultImage: 'fake-image',
    async create({ name, image: ref, workdir }) {
      guard();
      if (ref === 'fake-image' && !image.built) throw new Error('image fake-image not found');
      alive.add(name);
      return makeBox({ name, workdir });
    },
    async connect({ name }) {
      guard();
      if (!alive.has(name)) throw new Error(`no sandbox named "${name}" (try: l2b ls)`);
      return makeBox({ name, workdir: homeDir });
    },
    async list() {
      guard();
      return [...alive].map((name) => ({ name, state: 'running', id: `id-${name}`, image: 'fake-image' }));
    },
    async exists({ name }) {
      guard();
      return alive.has(name);
    },
    async findSnapshot({ name }) {
      guard();
      return snapshots.has(name) ? { id: 'snap', createdAt: null } : null;
    },
    async listSnapshots() {
      guard();
      return [...snapshots].map((name) => ({ name, id: 'snap', createdAt: null }));
    },
    async deleteSnapshot({ name }) {
      guard();
      return snapshots.delete(name);
    },
    imageRecipe: () => image.recipe,
    async imageExists() {
      guard();
      return image.built;
    },
    async buildImage() {
      guard();
      image.built = true;
      image.builds += 1;
      return 'fake-image';
    },
  };

  return { provider, alive, executed, files, snapshots, image };
}
