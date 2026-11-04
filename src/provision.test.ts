import { beforeAll, expect, test } from 'bun:test';
import { provisionBox } from './provision';
import { plainEnvFile } from './session';
import { snapshotName } from './repo';
import { fakeContext } from './test/fake-provider';

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
  const baker = await ctx.provider.create({ name: 'baker', image: 'i', workdir: '/w' });
  await baker.snapshot({ name: snapshotName('o/widgets') });
  executed.length = 0;
  const box = await provisionBox({ ctx, opts });

  expect(box.workdir).toBe('/srv/alice/widgets');
  expect([...files.keys()]).toContain('/srv/alice/.l2b-env');
  expect(plainEnvFile({ homeDir })).toBe('/srv/alice/.l2b-env');
  const checkout = executed.find((cmd) => cmd.includes('/srv/alice/mirrors/o/widgets.git'));
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
