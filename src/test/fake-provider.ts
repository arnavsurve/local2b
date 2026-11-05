import { configSchema } from '../config';
import { buildContext, type Context } from '../context';
import { ProviderAuthError, type Box, type Provider } from '../providers/types';

type FakeFailure = 'auth' | 'network' | null;

/**
 * In-memory provider standing in for the remote edge (the one boundary we
 * don't own). Tests assert on which boxes are still alive afterwards.
 * `failure` makes every provider call fail the way a missing key or an
 * unreachable API would.
 */
export function fakeProvider({
  id,
  execExitCode,
  failExecWhen,
  homeDir,
  failure,
}: {
  id: string;
  execExitCode: number;
  failExecWhen: string | null;
  homeDir: string;
  failure: FakeFailure;
}) {
  const alive = new Set<string>();
  const executed: string[] = [];
  const files = new Map<string, string>();
  const snapshots = new Set<string>();

  const guard = () => {
    if (failure === 'auth') throw new ProviderAuthError({ provider: id, hint: `set ${id.toUpperCase()}_API_KEY` });
    if (failure === 'network') throw new Error(`${id} is unreachable`);
  };

  const makeBox = ({ name, workdir }: { name: string; workdir: string }): Box => ({
    id: `id-${name}`,
    workdir,
    homeDir,
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

  const provider: Provider = {
    id,
    homeDir,
    defaultImage: 'fake-image',
    async create({ name, workdir }) {
      guard();
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
    buildImage: async () => 'fake-image',
  };

  return { provider, alive, executed, files, snapshots };
}

export function fakeContext({
  execExitCode,
  failExecWhen,
  homeDir,
}: {
  execExitCode: number;
  failExecWhen: string | null;
  homeDir: string;
}) {
  const fake = fakeProvider({ id: 'fake', execExitCode, failExecWhen, homeDir, failure: null });
  const ctx: Context = {
    config: configSchema.parse({}),
    provider: fake.provider,
    providers: [fake.provider],
    configured: ['fake'],
    defaultId: 'fake',
    flag: null,
    env: null,
  };
  return { ctx, alive: fake.alive, executed: fake.executed, files: fake.files, snapshots: fake.snapshots };
}

/**
 * A context with several named fake providers. The first is the config
 * default; `configured` lists the ones searched when addressing a box by name.
 */
export function fakeMultiContext({
  providers,
  configured,
  flag,
  env,
  repos,
}: {
  providers: { id: string; failure: FakeFailure }[];
  configured: string[];
  flag: string | null;
  env: string | null;
  repos: Record<string, string>;
}) {
  const fakes = providers.map(({ id, failure }) =>
    fakeProvider({ id, execExitCode: 0, failExecWhen: null, homeDir: '/home/user', failure })
  );
  const [first] = fakes;
  if (!first) throw new Error('fakeMultiContext needs at least one provider');
  const base = configSchema.parse({});
  const config = {
    ...base,
    repos: Object.fromEntries(
      Object.entries(repos).map(([repo, provider]) => [
        repo,
        { provider, gitHost: null, baseBranch: null, install: null, warm: null, env: {} },
      ])
    ),
  };
  const ctx = buildContext({
    config,
    providers: fakes.map((f) => f.provider),
    configured,
    defaultId: first.provider.id,
    flag,
    env,
  });
  const fake = (id: string) => {
    const found = fakes.find((f) => f.provider.id === id);
    if (!found) throw new Error(`no fake provider ${id}`);
    return found;
  };
  return { ctx, fake };
}
