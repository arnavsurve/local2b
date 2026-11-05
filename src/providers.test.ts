import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bake } from './commands/bake';
import { ls } from './commands/ls';
import { run } from './commands/run';
import { down } from './commands/lifecycle';
import { url } from './commands/url';
import { findBoxProvider } from './find-box';
import { lookupSnapshot } from './toolkit/bake-records';
import { snapshotName } from './toolkit/layout';
import { fakeMultiContext } from './test/fake-machine';

let stateDir = '';

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'l2b-state-'));
  process.env.XDG_STATE_HOME = stateDir;
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  delete process.env.XDG_STATE_HOME;
  rmSync(stateDir, { recursive: true, force: true });
});

const ok = { failure: null } as const;
const both = [
  { id: 'a', ...ok },
  { id: 'b', ...ok },
];
const context = (over: Partial<Parameters<typeof fakeMultiContext>[0]>) =>
  fakeMultiContext({ providers: both, configured: ['a', 'b'], flag: null, env: null, repos: {}, ...over });

test('run --provider b provisions and destroys on b only', async () => {
  const { ctx, fake } = context({ flag: 'b' });
  await run({ ctx, args: ['--', 'true'] });
  expect(fake('b').executed.length).toBeGreaterThan(0);
  expect(fake('a').executed).toEqual([]);
  expect([...fake('a').alive, ...fake('b').alive]).toEqual([]);
  expect(fake('a').files.size).toBe(0);
  expect(fake('b').files.size).toBeGreaterThan(0);
});

test('run follows L2B_PROVIDER and the repo override when no flag is given', async () => {
  const viaEnv = context({ env: 'b' });
  await run({ ctx: viaEnv.ctx, args: ['--', 'true'] });
  expect(viaEnv.fake('a').executed).toEqual([]);
  expect(viaEnv.fake('b').executed.length).toBeGreaterThan(0);

  const viaRepo = context({ repos: { 'o/r': 'b' } });
  await run({ ctx: viaRepo.ctx, args: ['--repo', 'o/r', '--', 'true'] });
  expect(viaRepo.fake('a').executed).toEqual([]);
  expect(viaRepo.fake('b').executed.length).toBeGreaterThan(0);
});

test('run with an unknown provider fails before touching any provider', async () => {
  expect(() => context({ flag: 'nope' })).toThrow('unknown provider "nope" (known: a, b)');
});

test('a bake on one provider leaves the other provider without a snapshot or bake record', async () => {
  const { ctx, fake } = context({ flag: 'b' });
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await bake({ ctx, args: ['o/r'] });
  log.mockRestore();
  expect(fake('b').snapshots.has(snapshotName('o/r'))).toBe(true);
  expect(fake('a').snapshots.size).toBe(0);
  expect(await lookupSnapshot({ provider: fake('a').provider, repo: 'o/r' })).toBeNull();
  const onB = await lookupSnapshot({ provider: fake('b').provider, repo: 'o/r' });
  expect(onB?.createdAt).not.toBeNull();
});

async function seedBox({ ctx, id, name }: { ctx: ReturnType<typeof context>['ctx']; id: string; name: string }) {
  const provider = ctx.providers.find((p) => p.id === id);
  await provider?.create({ name, image: 'i', workdir: '/w', idle: null });
}

test('a box on one provider is found without a flag', async () => {
  const { ctx } = context({});
  await seedBox({ ctx, id: 'b', name: 'dev' });
  expect((await findBoxProvider({ ctx, name: 'dev' })).id).toBe('b');
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await url({ ctx, args: ['dev', '3000'] });
  expect(log.mock.calls.flat()).toEqual(['https://b:3000/dev']);
  log.mockRestore();
});

test('a name on both providers is ambiguous until --provider picks one', async () => {
  const { ctx, fake } = context({});
  await seedBox({ ctx, id: 'a', name: 'dev' });
  await seedBox({ ctx, id: 'b', name: 'dev' });
  await expect(findBoxProvider({ ctx, name: 'dev' })).rejects.toThrow(
    'a sandbox named "dev" exists on a and b; pass --provider <a|b> to pick one'
  );

  const log = spyOn(console, 'log').mockImplementation(() => {});
  await down({ ctx: { ...ctx, flag: 'b' }, args: ['dev'] });
  log.mockRestore();
  expect([...fake('a').alive]).toEqual(['dev']);
  expect([...fake('b').alive]).toEqual([]);
  expect((await findBoxProvider({ ctx, name: 'dev' })).id).toBe('a');
});

test('a missing name gives the usual error', async () => {
  const { ctx } = context({});
  await expect(findBoxProvider({ ctx, name: 'ghost' })).rejects.toThrow('no sandbox named "ghost" (try: l2b ls)');
});

test('only configured providers are searched', async () => {
  const { ctx } = context({ configured: ['a'] });
  await seedBox({ ctx, id: 'b', name: 'dev' });
  await expect(findBoxProvider({ ctx, name: 'dev' })).rejects.toThrow('no sandbox named "dev"');
  expect((await findBoxProvider({ ctx: { ...ctx, flag: 'b' }, name: 'dev' })).id).toBe('b');
});

const withBroken = (failure: 'auth' | 'network') =>
  context({
    providers: [
      { id: 'a', failure: null },
      { id: 'b', failure },
    ],
  });

test('implicit lookup skips a provider that cannot authenticate', async () => {
  const { ctx } = withBroken('auth');
  await seedBox({ ctx, id: 'a', name: 'dev' });
  expect((await findBoxProvider({ ctx, name: 'dev' })).id).toBe('a');
  await expect(findBoxProvider({ ctx, name: 'ghost' })).rejects.toThrow(
    'no sandbox named "ghost" (try: l2b ls); skipped, cannot authenticate: b'
  );
});

test('lookup fails with the auth error when no provider can authenticate', async () => {
  const { ctx } = context({
    providers: [{ id: 'a', failure: 'auth' }],
    configured: ['a'],
  });
  await expect(findBoxProvider({ ctx, name: 'dev' })).rejects.toThrow('provider a cannot authenticate: set A_API_KEY');
});

test('an explicit --provider that cannot authenticate is an error naming the key', async () => {
  const { ctx } = withBroken('auth');
  await expect(down({ ctx: { ...ctx, flag: 'b' }, args: ['dev'] })).rejects.toThrow(
    'provider b cannot authenticate: set B_API_KEY'
  );
});

test('a network failure is not hidden by the implicit lookup', async () => {
  const { ctx } = withBroken('network');
  await expect(findBoxProvider({ ctx, name: 'dev' })).rejects.toThrow('b is unreachable');
});

test('ls shows every configured provider in a provider column', async () => {
  const { ctx } = context({});
  await seedBox({ ctx, id: 'a', name: 'one' });
  await seedBox({ ctx, id: 'b', name: 'two' });
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await ls({ ctx, args: [] });
  const rows = log.mock.calls.map((call) => String(call[0]).split('\t'));
  log.mockRestore();
  expect(rows.map((r) => [r[0], r[4]])).toEqual([
    ['one', 'a'],
    ['two', 'b'],
  ]);
});

test.each(['auth', 'network'] as const)('ls survives a provider failing with %s', async (failure) => {
  const { ctx } = withBroken(failure);
  await seedBox({ ctx, id: 'a', name: 'one' });
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const err = spyOn(console, 'error').mockImplementation(() => {});
  await ls({ ctx, args: [] });
  const rows = log.mock.calls.map((call) => String(call[0]).split('\t'));
  const warnings = err.mock.calls.map((call) => String(call[0]));
  log.mockRestore();
  err.mockRestore();
  expect(rows).toEqual([['one', 'running', 'id-one', 'fake-image', 'a']]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('could not list b');
});
