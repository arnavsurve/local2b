import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { $ } from 'bun';
import { configSchema } from '../config';
import { buildContext } from '../context';
import type { ContractSubject } from '../providers/contract';
import {
  ProviderAuthError,
  UnsupportedError,
  type Box,
  type Credentials,
  type ExecOutput,
  type Provider,
  type RepoSpec,
  type Terminal,
} from '../providers/types';

export type FakeFailure = 'auth' | 'network' | null;

export type FakeClock = { now(): number; advance(opts: { ms: number }): void };

export function fakeClock({ start }: { start: number }): FakeClock {
  let now = start;
  return {
    now: () => now,
    advance: ({ ms }) => {
      now += ms;
    },
  };
}

type FakeBox = {
  name: string;
  home: string;
  tmp: string;
  workdir: string;
  env: Record<string, string>;
  credentials: Credentials;
  idleMs: number;
  lastActive: number;
  running: number;
  state: 'running' | 'paused';
};

const SWITCH_SCRIPT = [
  'set -e',
  'git fetch --quiet origin',
  'if [ -z "$L2B_BRANCH" ]; then git checkout --quiet --detach origin/HEAD; exit 0; fi',
  'if git rev-parse --verify --quiet "refs/remotes/origin/$L2B_BRANCH" >/dev/null; then start="origin/$L2B_BRANCH"; else start=origin/HEAD; fi',
  'git checkout --quiet -B "$L2B_BRANCH" "$start"',
].join('\n');

const repoKey = (repo: RepoSpec) => `${repo.owner}/${repo.name}`;

/**
 * In-memory provider standing in for the remote edge (the one boundary we
 * don't own). Each box is a temp directory and commands run in a real local
 * bash, so checkouts, setup and installs are real. A bake keeps the checkout
 * and the home its setup prepared. Credentials live only in this
 * process's memory and reach commands as environment variables. Idle expiry
 * follows the injected clock: a box idle past its window is gone on the next
 * call. Terminals are unsupported. `failure` makes every call fail the way a
 * missing key or an unreachable API would.
 */
export function fakeProvider({ id, clock, failure }: { id: string; clock: FakeClock; failure: FakeFailure }) {
  const root = mkdtempSync(join(tmpdir(), `l2b-fake-${id}-`));
  const boxes = new Map<string, FakeBox>();
  const bakes = new Map<string, { home: string; dir: string; at: Date }>();
  /** Every command line run, as a provider-side history would keep it. */
  const history: string[] = [];
  let prepared = 0;

  const guard = () => {
    if (failure === 'auth') throw new ProviderAuthError({ provider: id, hint: `set ${id.toUpperCase()}_API_KEY` });
    if (failure === 'network') throw new Error(`${id} is unreachable`);
  };

  const expireIdle = () => {
    for (const box of boxes.values()) {
      if (box.running === 0 && clock.now() - box.lastActive >= box.idleMs) remove(box);
    }
  };

  const remove = (box: FakeBox) => {
    boxes.delete(box.name);
    rmSync(join(root, 'boxes', box.name), { recursive: true, force: true });
  };

  async function spawn({
    cmd,
    cwd,
    env,
    onOutput,
  }: {
    cmd: string;
    cwd: string;
    env: Record<string, string>;
    onOutput: (output: ExecOutput) => void;
  }) {
    history.push(cmd);
    const proc = Bun.spawn(['bash', '-c', cmd], { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const pump = async (stream: ReadableStream<Uint8Array>, name: ExecOutput['stream']) => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) onOutput({ stream: name, data: decoder.decode(chunk, { stream: true }) });
    };
    try {
      await Promise.all([pump(proc.stdout, 'stdout'), pump(proc.stderr, 'stderr')]);
    } catch (err) {
      proc.kill('SIGKILL');
      await proc.exited;
      throw err;
    }
    return proc.exited;
  }

  const envFor = ({ home, tmp, env, credentials }: { home: string; tmp: string; env: Record<string, string>; credentials: Credentials }) => ({
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    TMPDIR: tmp,
    GIT_TERMINAL_PROMPT: '0',
    ...env,
    ...credentials.variables,
  });

  async function checked({ what, ...opts }: { what: string; cmd: string; cwd: string; env: Record<string, string> }) {
    let stderr = '';
    const code = await spawn({ ...opts, onOutput: (o) => (stderr += o.stream === 'stderr' ? o.data : '') });
    if (code !== 0) throw new Error(`${what} failed (exit ${code}): ${stderr.trim()}`);
  }

  async function prepareCheckout({
    repo,
    dir,
    env,
    seed,
    branch,
    extra,
  }: {
    repo: RepoSpec;
    dir: string;
    env: Record<string, string>;
    seed: string | null;
    branch: string | null;
    extra: string | null;
  }) {
    if (seed) cpSync(seed, dir, { recursive: true });
    for (const cmd of seed ? [] : repo.setup) {
      await checked({ what: `setup "${cmd}"`, cmd, cwd: env.HOME ?? root, env });
    }
    if (!seed) await checked({ what: 'git clone', cmd: `git clone --quiet "$L2B_REMOTE" "$L2B_DIR"`, cwd: root, env: { ...env, L2B_REMOTE: repo.remoteUrl, L2B_DIR: dir } });
    await checked({ what: 'branch checkout', cmd: SWITCH_SCRIPT, cwd: dir, env: { ...env, L2B_BRANCH: branch ?? '' } });
    for (const cmd of [repo.install, extra]) {
      if (cmd) await checked({ what: 'install', cmd, cwd: dir, env });
    }
  }

  const touch = (box: FakeBox) => {
    box.lastActive = clock.now();
    box.state = 'running';
  };

  const live = (name: string) => {
    expireIdle();
    const box = boxes.get(name);
    if (!box) throw new Error(`no sandbox named "${name}" (try: l2b ls)`);
    return box;
  };

  const wrap = (box: FakeBox): Box => ({
    name: box.name,
    workdir: box.workdir,
    async exec({ cmd, cwd, onOutput }) {
      const current = live(box.name);
      current.running += 1;
      touch(current);
      try {
        return await spawn({ cmd, cwd: cwd ?? current.workdir, env: envFor(current), onOutput });
      } finally {
        current.running -= 1;
        touch(current);
      }
    },
    async attach() {
      throw new UnsupportedError({ provider: id, operation: 'attach', suggestion: 'use l2b exec' });
    },
    async put({ path, content, executable }) {
      const current = live(box.name);
      touch(current);
      const target = isAbsolute(path) ? path : path.startsWith('~/') ? join(current.home, path.slice(2)) : join(current.workdir, path);
      mkdirSync(dirname(target), { recursive: true });
      rmSync(target, { force: true });
      writeFileSync(target, content);
      if (executable) chmodSync(target, 0o755);
      return target;
    },
    async url({ port }) {
      live(box.name);
      return { url: `https://${id}:${port}/${box.name}`, note: null };
    },
    async refreshCredentials({ credentials }) {
      live(box.name).credentials = credentials;
    },
    async pause() {
      live(box.name).state = 'paused';
    },
    async destroy() {
      const current = boxes.get(box.name);
      if (current) remove(current);
    },
  });

  const provider: Provider = {
    id,
    async prepare() {
      guard();
      prepared += 1;
      return 'nothing to prepare';
    },
    async bake({ repo, credentials }) {
      guard();
      const base = join(root, 'bakes', repo.owner, repo.name);
      const home = join(base, 'home');
      const dir = join(base, 'checkout');
      rmSync(base, { recursive: true, force: true });
      mkdirSync(home, { recursive: true });
      try {
        const env = envFor({ home, tmp: home, env: repo.env, credentials });
        await prepareCheckout({ repo, dir, env, seed: null, branch: repo.baseBranch, extra: repo.warm });
      } catch (err) {
        rmSync(base, { recursive: true, force: true });
        throw err;
      }
      const at = new Date(clock.now());
      bakes.set(repoKey(repo), { home, dir, at });
      return { summary: `${id}:${repoKey(repo)}`, bakedAt: at };
    },
    async bakedAt({ repo }) {
      guard();
      return bakes.get(repoKey(repo))?.at ?? null;
    },
    async start({ name, repo, branch, source, idle, credentials, gitIdentity }) {
      guard();
      expireIdle();
      if (boxes.has(name)) {
        throw new Error(`sandbox "${name}" already exists: reuse it with \`l2b exec ${name} -- <cmd>\`, or \`l2b down ${name}\` first`);
      }
      const dir = join(root, 'boxes', name);
      const home = join(dir, 'home');
      const tmp = join(dir, 'tmp');
      mkdirSync(home, { recursive: true });
      mkdirSync(tmp, { recursive: true });
      const box: FakeBox = {
        name,
        home,
        tmp,
        workdir: repo ? join(home, repo.name) : home,
        env: repo?.env ?? {},
        credentials,
        idleMs: idle.minutes * 60_000,
        lastActive: clock.now(),
        running: 1,
        state: 'running',
      };
      boxes.set(name, box);
      const bake = repo && source === 'bake' ? (bakes.get(repoKey(repo)) ?? null) : null;
      if (bake) cpSync(bake.home, home, { recursive: true });
      try {
        if (gitIdentity) {
          await checked({
            what: 'git identity',
            cmd: 'git config --global user.name "$L2B_NAME" && git config --global user.email "$L2B_EMAIL"',
            cwd: home,
            env: { ...envFor(box), L2B_NAME: gitIdentity.name, L2B_EMAIL: gitIdentity.email },
          });
        }
        if (repo) {
          await prepareCheckout({ repo, dir: box.workdir, env: envFor(box), seed: bake?.dir ?? null, branch, extra: null });
        }
      } catch (err) {
        remove(box);
        throw err;
      } finally {
        box.running -= 1;
        touch(box);
      }
      return wrap(box);
    },
    async connect({ name }) {
      guard();
      const box = live(name);
      touch(box);
      return wrap(box);
    },
    async exists({ name }) {
      guard();
      expireIdle();
      return boxes.has(name);
    },
    async list() {
      guard();
      expireIdle();
      return [...boxes.values()].map((box) => ({ name: box.name, state: box.state, id: `id-${box.name}`, image: 'fake-image' }));
    },
  };

  /** Command lines and files the fake keeps that contain `value`. */
  async function findPersisted({ value }: { value: string }) {
    const inHistory = history.filter((cmd) => cmd.includes(value)).map((cmd) => `history: ${cmd}`);
    const onDisk = (await $`grep -rlF -e ${value} ${root}`.nothrow().quiet()).text().split('\n').filter(Boolean);
    return [...inHistory, ...onDisk];
  }

  return {
    provider,
    history,
    findPersisted,
    prepared: () => prepared,
    alive: () => [...boxes.keys()],
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A local origin repo at `dir` with a `main` and a `feature/contract` branch. */
async function createOrigin({ dir }: { dir: string }) {
  mkdirSync(dir, { recursive: true });
  const git = (args: string[]) => $`git -c user.name=t -c user.email=t@t ${args}`.cwd(dir).quiet();
  await git(['init', '-q', '-b', 'main']);
  await Bun.write(join(dir, 'a.txt'), 'main\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'init']);
  await git(['checkout', '-qb', 'feature/contract']);
  await Bun.write(join(dir, 'a.txt'), 'feature\n');
  await git(['commit', '-qam', 'feature work']);
  await git(['checkout', '-q', 'main']);
}

export async function fakeOrigin() {
  const dir = mkdtempSync(join(tmpdir(), 'l2b-origin-'));
  await createOrigin({ dir });
  return { dir, remoteUrl: `file://${dir}`, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const noTerminal: Terminal = {
  size: () => ({ cols: 80, rows: 24 }),
  onInput: () => () => {},
  onResize: () => () => {},
  write: () => {},
};

export async function fakeContractSubject(): Promise<ContractSubject> {
  const clock = fakeClock({ start: Date.now() });
  const fake = fakeProvider({ id: 'fake', clock, failure: null });
  const origin = await fakeOrigin();
  const idle = { minutes: 15 };
  return {
    provider: fake.provider,
    repo: {
      owner: 'o',
      name: 'widgets',
      remoteUrl: origin.remoteUrl,
      baseBranch: null,
      clone: { strategy: 'plain', depth: null, filter: null },
      setup: [],
      install: null,
      warm: null,
      env: {},
    },
    branch: 'feature/contract',
    credentials: { variables: {}, git: null },
    idle,
    passIdleTime: async () => clock.advance({ ms: idle.minutes * 60_000 + 1 }),
    findPersisted: fake.findPersisted,
    unsupported: [{ operation: 'attach', attempt: ({ box }) => box.attach({ terminal: noTerminal, cwd: null }) }],
    cleanup: async () => {
      fake.cleanup();
      origin.cleanup();
    },
  };
}

/**
 * A context with several named fake providers sharing one clock. The first is
 * the config default; `configured` lists the ones searched when addressing a
 * box by name. Repos clone from local origins created by `addOrigin`. The
 * context's cwd is an empty directory outside any checkout.
 */
export function fakeContext({
  providers,
  configured,
  flag,
  env,
  config,
  clock,
}: {
  providers: { id: string; failure: FakeFailure }[];
  configured: string[];
  flag: string | null;
  env: string | null;
  config: Record<string, unknown>;
  clock: FakeClock;
}) {
  const originRoot = mkdtempSync(join(tmpdir(), 'l2b-origins-'));
  const cwd = mkdtempSync(join(tmpdir(), 'l2b-cwd-'));
  const fakes = providers.map(({ id, failure }) => fakeProvider({ id, clock, failure }));
  const [first] = fakes;
  if (!first) throw new Error('fakeContext needs at least one provider');
  const ctx = buildContext({
    config: configSchema.parse({ gitHost: { type: 'github', baseUrl: `file://${originRoot}` }, ...config }),
    providers: fakes.map((f) => f.provider),
    configured,
    defaultId: first.provider.id,
    flag,
    env,
    cwd,
  });
  const fake = (id: string) => {
    const found = fakes.find((f) => f.provider.id === id);
    if (!found) throw new Error(`no fake provider ${id}`);
    return found;
  };
  return {
    ctx,
    fake,
    addOrigin: ({ repo }: { repo: string }) => createOrigin({ dir: join(originRoot, `${repo}.git`) }),
    cleanup: () => {
      for (const f of fakes) f.cleanup();
      rmSync(originRoot, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}
