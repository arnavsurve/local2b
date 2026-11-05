import { beforeAll, expect, test } from 'bun:test';
import { configSchema } from './config';
import { provisionBox } from './provision';
import { plainEnvFile } from './toolkit/session';
import { snapshotName } from './toolkit/layout';
import { fakeContext } from './test/fake-machine';

const opts = {
  name: 'home-test',
  repo: 'o/widgets',
  branch: 'main',
  full: false,
  install: null,
  doppler: null,
  image: null,
};

beforeAll(() => {
  process.env.GH_TOKEN = 'test-token';
});

test('a provider home dir drives the env file, mirror and checkout paths', async () => {
  const homeDir = '/srv/alice';
  const { ctx, executed, files } = fakeContext({
    execExitCode: 0,
    failExecWhen: null,
    homeDir,
  });
  const baker = await ctx.provider.create({ name: 'baker', image: 'i', workdir: '/w', idle: null });
  await baker.snapshot({ name: snapshotName('o/widgets') });
  executed.length = 0;
  const box = await provisionBox({ ctx, opts });

  expect(box.workdir).toBe('/srv/alice/widgets');
  expect([...files.keys()]).toContain('/srv/alice/.l2b-env');
  expect(plainEnvFile({ homeDir })).toBe('/srv/alice/.l2b-env');
  const checkout = executed.find((cmd) => cmd.includes('checkout --quiet'));
  expect(checkout).toContain('/srv/alice/mirrors/o/widgets.git');
  expect(checkout).toContain('/srv/alice/widgets');
  expect(executed.join('\n')).not.toContain('/home/user');
});

test('cloning without a snapshot lands in the provider home dir', async () => {
  const { ctx, executed } = fakeContext({
    execExitCode: 0,
    failExecWhen: null,
    homeDir: '/srv/bob',
  });
  await provisionBox({ ctx, opts });
  expect(executed.some((cmd) => cmd.includes('/srv/bob/widgets'))).toBe(true);
  expect(executed.join('\n')).not.toContain('/home/user');
});

test('without a repo the workdir is the home dir', async () => {
  const { ctx } = fakeContext({
    execExitCode: 0,
    failExecWhen: null,
    homeDir: '/srv/carol',
  });
  const box = await provisionBox({ ctx, opts: { ...opts, repo: null } });
  expect(box.workdir).toBe('/srv/carol');
});

test('the fallback clone uses the configured depth and filter, and --full drops only the depth', async () => {
  const { ctx, executed } = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/srv/c' });
  ctx.config = configSchema.parse({ clone: { depth: 7, filter: 'blob:none' } });
  await provisionBox({ ctx, opts });
  expect(executed.find((cmd) => cmd.includes('git clone'))).toContain('--depth=7 --filter=blob:none');
  executed.length = 0;
  await provisionBox({ ctx, opts: { ...opts, name: 'full', full: true } });
  const full = executed.find((cmd) => cmd.includes('git clone'));
  expect(full).not.toContain('--depth');
  expect(full).toContain('--filter=blob:none');
});

const installRuns = ({ executed }: { executed: string[] }) =>
  executed.filter((cmd) => /yarn|bun install|npm|pnpm/.test(cmd) && !cmd.includes('git '));

async function context({ snapshot }: { snapshot: boolean }) {
  const fake = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/srv/dan' });
  fake.rootFiles.push('package.json', 'yarn.lock', '.yarnrc.yml', 'src');
  if (snapshot) {
    const baker = await fake.ctx.provider.create({ name: 'baker', image: 'i', workdir: '/w', idle: null });
    await baker.snapshot({ name: snapshotName('o/widgets') });
  }
  fake.executed.length = 0;
  return fake;
}

test.each([
  { path: 'snapshot', snapshot: true },
  { path: 'clone', snapshot: false },
])('detects and runs the install command on the $path path', async ({ snapshot }) => {
  const { ctx, executed } = await context({ snapshot });
  await provisionBox({ ctx, opts });
  expect(installRuns({ executed })).toContain('for f in /srv/dan/.l2b-env /dev/shm/l2b.env; do [ -f $f ] && . $f; done; yarn install --immutable');
});

test.each([
  { path: 'snapshot', snapshot: true },
  { path: 'clone', snapshot: false },
])('a configured install overrides detection on the $path path', async ({ snapshot }) => {
  const { ctx, executed } = await context({ snapshot });
  await provisionBox({ ctx, opts: { ...opts, install: 'make deps' } });
  expect(executed.some((cmd) => cmd.endsWith('; make deps'))).toBe(true);
  expect(executed.join('\n')).not.toContain('yarn install');
});

test.each([
  { path: 'snapshot', snapshot: true },
  { path: 'clone', snapshot: false },
])('an empty install runs nothing on the $path path', async ({ snapshot }) => {
  const { ctx, executed } = await context({ snapshot });
  await provisionBox({ ctx, opts: { ...opts, install: '' } });
  expect(executed).not.toContain('ls -A');
  expect(installRuns({ executed })).toEqual([]);
});

test('an unrecognised checkout installs nothing and still provisions', async () => {
  const { ctx, executed, rootFiles } = await context({ snapshot: false });
  rootFiles.length = 0;
  rootFiles.push('go.mod');
  await provisionBox({ ctx, opts });
  expect(installRuns({ executed })).toEqual([]);
});
