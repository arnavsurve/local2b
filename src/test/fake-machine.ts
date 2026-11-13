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
 * delete it or change the recipe, and counts builds. Build `n` is pinned as
 * `fake-image@n` (the first is `fake-image@0`); the name `fake-image` means
 * the newest build, or the one before it while `nameLags` is set, as a host
 * that serves a stale build for a short while after a rebuild does. A build
 * takes a moment; `listedWhileBuilding` makes the image look present while it
 * builds. Creating a machine from the default image fails while it is not
 * built. `startedFrom` maps each machine created, and `bakedFrom` each
 * snapshot, to the build or image it runs.
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
  const startedFrom = new Map<string, string>();
  const bakedFrom = new Map<string, string>();
  const image = { recipe: 'recipe-1', built: true, builds: 0, building: false, listedWhileBuilding: false, nameLags: false };
  const pinned = (build: number) => `fake-image@${build}`;
  const isBuilt = (ref: string) => {
    const build = /^fake-image@(\d+)$/.exec(ref)?.[1];
    return image.built && build !== undefined && Number(build) <= image.builds;
  };
  /** What a machine created from `ref` actually runs. */
  const resolve = (ref: string) => {
    if (ref !== 'fake-image') return ref;
    if (!image.built) throw new Error('image fake-image not found');
    return pinned(image.nameLags ? Math.max(0, image.builds - 1) : image.builds);
  };

  const guard = () => {
    if (failure === 'auth') throw new ProviderAuthError({ provider: id, hint: `set ${id.toUpperCase()}_API_KEY` });
    if (failure === 'network') throw new Error(`${id} is unreachable`);
  };

  const makeBox = ({ name, workdir, from }: { name: string; workdir: string; from: string }): Machine => ({
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
      bakedFrom.set(name, from);
      return 'snap';
    },
  });

  const provider: MachineHost = {
    id,
    homeDir,
    defaultImage: 'fake-image',
    async create({ name, image: ref, workdir }) {
      guard();
      if (ref.startsWith('fake-image@') && !isBuilt(ref)) throw new Error(`image ${ref} not found`);
      const from = resolve(ref);
      startedFrom.set(name, from);
      alive.add(name);
      return makeBox({ name, workdir, from });
    },
    async connect({ name }) {
      guard();
      if (!alive.has(name)) throw new Error(`no sandbox named "${name}"; start one with \`l2b up ${name}\`, or list running boxes with \`l2b ls\``);
      return makeBox({ name, workdir: homeDir, from: 'unknown' });
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
      bakedFrom.delete(name);
      return snapshots.delete(name);
    },
    imageRecipe: () => image.recipe,
    async imageExists({ ref }) {
      guard();
      return isBuilt(ref);
    },
    async currentImage() {
      guard();
      if (image.building && image.listedWhileBuilding) return pinned(image.builds + 1);
      return image.built ? pinned(image.builds) : null;
    },
    async buildImage() {
      guard();
      image.building = true;
      await Bun.sleep(20);
      image.building = false;
      image.built = true;
      image.builds += 1;
      return pinned(image.builds);
    },
  };

  return { provider, alive, executed, files, snapshots, startedFrom, bakedFrom, image };
}
