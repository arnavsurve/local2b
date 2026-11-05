import { beforeAll, expect, test } from 'bun:test';
import { generatedBoxName, runOnce } from './run-once';
import { fakeContext } from './test/fake-machine';

const opts = {
  name: 'run-test',
  repo: null,
  branch: null,
  full: false,
  install: null,
  doppler: null,
  image: null,
};

beforeAll(() => {
  process.env.GH_TOKEN = 'test-token';
});

test('returns the command exit code and leaves no box behind', async () => {
  const { ctx, alive } = fakeContext({ execExitCode: 3, failExecWhen: null, homeDir: '/home/user' });
  const exitCode = await runOnce({ ctx, opts, cmd: 'yarn test', label: 'yarn test', keep: false });
  expect(exitCode).toBe(3);
  expect([...alive]).toEqual([]);
});

test('destroys the box even when the command blows up', async () => {
  const { ctx, alive } = fakeContext({ execExitCode: 0, failExecWhen: 'explode', homeDir: '/home/user' });
  await expect(runOnce({ ctx, opts, cmd: 'explode', label: 'explode', keep: false })).rejects.toThrow('exec blew up');
  expect([...alive]).toEqual([]);
});

test('destroys the box when setup fails after it was created', async () => {
  const { ctx, alive } = fakeContext({ execExitCode: 1, failExecWhen: null, homeDir: '/home/user' });
  await expect(
    runOnce({ ctx, opts: { ...opts, repo: 'o/r' }, cmd: 'true', label: 'true', keep: false })
  ).rejects.toThrow('git clone failed');
  expect([...alive]).toEqual([]);
});

test('keep leaves the box alive for follow-up commands', async () => {
  const { ctx, alive } = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/home/user' });
  await runOnce({ ctx, opts, cmd: 'true', label: 'true', keep: true });
  expect([...alive]).toEqual(['run-test']);
});

test('generated names are unique and carry the repo name', () => {
  const a = generatedBoxName({ repo: 'o/escher' });
  const b = generatedBoxName({ repo: 'o/escher' });
  expect(a).toMatch(/^run-escher-[0-9a-f]{6}$/);
  expect(a).not.toBe(b);
});
