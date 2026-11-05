import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import type { Credentials, RepoSpec, StartOpts } from '../providers/types';
import { fakeMachineHost } from '../test/fake-machine';
import { snapshotName } from './layout';
import { ENV_FILE, plainEnvFile } from './session';
import { machineWorkflow } from './workflow';

let stateDir = '';

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'l2b-state-'));
  process.env.XDG_STATE_HOME = stateDir;
});

afterEach(() => {
  delete process.env.XDG_STATE_HOME;
  rmSync(stateDir, { recursive: true, force: true });
});

const credentials: Credentials = {
  variables: { L2B_TEST_SECRET: 'from-source', GH_TOKEN: 'gh-test-token' },
  git: { baseUrl: 'https://github.com', username: 'x-access-token', tokenEnvVar: 'GH_TOKEN' },
};

const repo: RepoSpec = {
  owner: 'o',
  name: 'widgets',
  remoteUrl: 'https://github.com/o/widgets.git',
  baseBranch: null,
  clone: { strategy: 'mirror', depth: 50, filter: 'blob:limit=50m' },
  install: null,
  warm: null,
  env: {},
};

const startOpts: StartOpts = {
  name: 'home-test',
  repo,
  branch: 'main',
  source: 'bake',
  image: null,
  idle: { minutes: 15 },
  credentials,
  gitIdentity: null,
};

function setup({ homeDir, execExitCode }: { homeDir: string; execExitCode: number }) {
  const fake = fakeMachineHost({ id: 'fake', execExitCode, homeDir, failure: null });
  return { ...fake, workflow: machineWorkflow({ host: fake.provider }) };
}

async function seedSnapshot({ host }: { host: ReturnType<typeof setup>['provider'] }) {
  const baker = await host.create({ name: 'baker', image: 'i', workdir: '/w', idle: null });
  await baker.snapshot({ name: snapshotName('o/widgets') });
  await baker.destroy();
}

const quiet = () => {
  const err = spyOn(console, 'error').mockImplementation(() => {});
  const log = spyOn(console, 'log').mockImplementation(() => {});
  return () => {
    err.mockRestore();
    log.mockRestore();
  };
};

test('a provider home dir drives the env file, mirror and checkout paths', async () => {
  const { provider, workflow, executed, files } = setup({ homeDir: '/srv/alice', execExitCode: 0 });
  await seedSnapshot({ host: provider });
  executed.length = 0;
  const box = await workflow.start(startOpts);

  expect(box.workdir).toBe('/srv/alice/widgets');
  expect([...files.keys()]).toContain('/srv/alice/.l2b-env');
  expect(plainEnvFile({ homeDir: '/srv/alice' })).toBe('/srv/alice/.l2b-env');
  const checkout = executed.find((cmd) => cmd.includes('checkout --quiet'));
  expect(checkout).toContain('/srv/alice/mirrors/o/widgets.git');
  expect(checkout).toContain('/srv/alice/widgets');
  expect(executed.join('\n')).not.toContain('/home/user');
});

test('cloning without a snapshot lands in the provider home dir', async () => {
  const { workflow, executed } = setup({ homeDir: '/srv/bob', execExitCode: 0 });
  await workflow.start(startOpts);
  expect(executed.some((cmd) => cmd.includes('/srv/bob/widgets'))).toBe(true);
  expect(executed.join('\n')).not.toContain('/home/user');
});

test('without a repo the workdir is the home dir', async () => {
  const { workflow } = setup({ homeDir: '/srv/carol', execExitCode: 0 });
  const box = await workflow.start({ ...startOpts, repo: null });
  expect(box.workdir).toBe('/srv/carol');
});

test('the fallback clone uses the clone depth and filter; a fresh start with no depth keeps the filter', async () => {
  const { provider, workflow, executed } = setup({ homeDir: '/srv/c', execExitCode: 0 });
  const shallow: RepoSpec = { ...repo, clone: { strategy: 'mirror', depth: 7, filter: 'blob:none' } };
  await workflow.start({ ...startOpts, repo: shallow });
  expect(executed.find((cmd) => cmd.includes('git clone'))).toContain('--depth=7 --filter=blob:none');
  await seedSnapshot({ host: provider });
  executed.length = 0;
  await workflow.start({ ...startOpts, name: 'full', source: 'fresh', repo: { ...shallow, clone: { ...shallow.clone, depth: null } } });
  const full = executed.find((cmd) => cmd.includes('git clone'));
  expect(full).not.toContain('--depth');
  expect(full).toContain('--filter=blob:none');
});

test('a failed setup destroys the machine it created', async () => {
  const { workflow, alive } = setup({ homeDir: '/home/user', execExitCode: 1 });
  await expect(workflow.start(startOpts)).rejects.toThrow('git clone failed');
  expect([...alive]).toEqual([]);
});

const installRuns = ({ executed }: { executed: string[] }) =>
  executed.filter((cmd) => /yarn|bun install|npm|pnpm/.test(cmd) && !cmd.includes('git '));

async function withLockfiles({ snapshot }: { snapshot: boolean }) {
  const fake = setup({ homeDir: '/srv/dan', execExitCode: 0 });
  fake.rootFiles.push('package.json', 'yarn.lock', '.yarnrc.yml', 'src');
  if (snapshot) await seedSnapshot({ host: fake.provider });
  fake.executed.length = 0;
  return fake;
}

test.each([
  { path: 'snapshot', snapshot: true },
  { path: 'clone', snapshot: false },
])('detects and runs the install command on the $path path', async ({ snapshot }) => {
  const { workflow, executed } = await withLockfiles({ snapshot });
  await workflow.start(startOpts);
  expect(installRuns({ executed })).toContain(
    'for f in /srv/dan/.l2b-env /dev/shm/l2b.env; do [ -f $f ] && . $f; done; yarn install --immutable'
  );
});

test.each([
  { path: 'snapshot', snapshot: true },
  { path: 'clone', snapshot: false },
])('a configured install overrides detection on the $path path', async ({ snapshot }) => {
  const { workflow, executed } = await withLockfiles({ snapshot });
  await workflow.start({ ...startOpts, repo: { ...repo, install: 'make deps' } });
  expect(executed.some((cmd) => cmd.endsWith('; make deps'))).toBe(true);
  expect(executed.join('\n')).not.toContain('yarn install');
});

test.each([
  { path: 'snapshot', snapshot: true },
  { path: 'clone', snapshot: false },
])('an empty install runs nothing on the $path path', async ({ snapshot }) => {
  const { workflow, executed } = await withLockfiles({ snapshot });
  await workflow.start({ ...startOpts, repo: { ...repo, install: '' } });
  expect(executed).not.toContain('ls -A');
  expect(installRuns({ executed })).toEqual([]);
});

test('an unrecognised checkout installs nothing and still starts', async () => {
  const { workflow, executed, rootFiles } = await withLockfiles({ snapshot: false });
  rootFiles.length = 0;
  rootFiles.push('go.mod');
  await workflow.start(startOpts);
  expect(installRuns({ executed })).toEqual([]);
});

async function sourcedEnv({ content, name }: { content: string; name: string }) {
  const script = `${content}printf %s "$${name}"`;
  return (await $`bash -c ${script}`.quiet()).text();
}

test('credentials go to the tmpfs env file only, and repo env is exported under them', async () => {
  const { workflow, files, executed } = setup({ homeDir: '/home/user', execExitCode: 0 });
  await workflow.start({ ...startOpts, repo: { ...repo, env: { NO_DOPPLER_WRAP: '1', L2B_TEST_SECRET: 'plain' } } });
  const content = `${files.get(plainEnvFile({ homeDir: '/home/user' })) ?? ''}${files.get(ENV_FILE) ?? ''}`;
  expect(await sourcedEnv({ content, name: 'NO_DOPPLER_WRAP' })).toBe('1');
  expect(await sourcedEnv({ content, name: 'L2B_TEST_SECRET' })).toBe('from-source');
  expect(await sourcedEnv({ content, name: 'GH_TOKEN' })).toBe('gh-test-token');
  expect(files.get(plainEnvFile({ homeDir: '/home/user' }))).not.toContain('from-source');
  expect(executed.join('\n')).not.toContain('gh-test-token');
  expect(executed).toContain(
    `for f in /home/user/.l2b-env /dev/shm/l2b.env; do [ -f $f ] && . $f; done; git config --global 'credential.https://github.com.helper' '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f'`
  );
});

test('box exec loads the env files and defaults to the workdir; a refresh rewrites the secrets', async () => {
  const { workflow, executed, files } = setup({ homeDir: '/home/user', execExitCode: 4 });
  const box = await workflow.start({ ...startOpts, repo: null });
  executed.length = 0;
  expect(await box.exec({ cmd: 'yarn test', cwd: null, onOutput: () => {} })).toBe(4);
  expect(executed).toEqual(['for f in /home/user/.l2b-env /dev/shm/l2b.env; do [ -f $f ] && . $f; done; yarn test']);
  await box.refreshCredentials({ credentials: { ...credentials, variables: { GH_TOKEN: 'rotated' } } });
  expect(await sourcedEnv({ content: files.get(ENV_FILE) ?? '', name: 'GH_TOKEN' })).toBe('rotated');
});

test('bake scrubs credentials before the snapshot and records when it happened', async () => {
  const { workflow, executed, snapshots, alive } = setup({ homeDir: '/home/user', execExitCode: 0 });
  expect(await workflow.bakedAt({ repo })).toBeNull();
  const restore = quiet();
  const result = await workflow.bake({ repo, credentials, image: null });
  restore();
  expect(result.summary).toBe('snap');
  expect(snapshots.has(snapshotName('o/widgets'))).toBe(true);
  expect(executed.at(-1)).toBe('rm -f /dev/shm/l2b.env');
  expect([...alive]).toEqual([]);
  expect((await workflow.bakedAt({ repo }))?.getTime()).toBe(result.bakedAt.getTime());
});

test('bake refuses to run while a stale bake box exists', async () => {
  const { provider, workflow } = setup({ homeDir: '/home/user', execExitCode: 0 });
  await provider.create({ name: 'bake-widgets', image: 'i', workdir: '/w', idle: null });
  await expect(workflow.bake({ repo, credentials, image: null })).rejects.toThrow(
    'stale bake sandbox "bake-widgets" exists; run: l2b down bake-widgets'
  );
});

test('prepare builds the base image', async () => {
  const { workflow } = setup({ homeDir: '/home/user', execExitCode: 0 });
  expect(await workflow.prepare()).toBe('built image fake-image');
});

test('a start sets the git identity, and bake never does', async () => {
  const { workflow, executed } = setup({ homeDir: '/home/user', execExitCode: 0 });
  await workflow.start({ ...startOpts, repo: null, gitIdentity: { name: "Ada O'Neil", email: 'ada@example.com' } });
  expect(executed.some((cmd) => cmd.endsWith(`git config --global user.name 'Ada O'\\''Neil' && git config --global user.email 'ada@example.com'`))).toBe(true);
  executed.length = 0;
  const restore = quiet();
  await workflow.bake({ repo, credentials, image: null });
  restore();
  expect(executed.join('\n')).not.toContain('user.name');
});

test('box put resolves the path against the workdir and writes through the file API', async () => {
  const { workflow, files } = setup({ homeDir: '/home/user', execExitCode: 0 });
  const box = await workflow.start(startOpts);
  expect(await box.put({ path: 'notes/a.txt', content: 'hi\n', executable: false })).toBe('/home/user/widgets/notes/a.txt');
  expect(files.get('/home/user/widgets/notes/a.txt')).toBe('hi\n');
  expect(await box.put({ path: '~/b', content: 'x', executable: false })).toBe('/home/user/b');
});
