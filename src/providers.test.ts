import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { bake } from './commands/bake';
import { ls } from './commands/ls';
import { run } from './commands/run';
import { down } from './commands/lifecycle';
import { url } from './commands/url';
import { configSchema } from './config';
import { configuredProviders } from './context';
import { findBoxProvider } from './find-box';
import type { Provider } from './providers/types';
import { repoSpecFor } from './repo';
import { fakeClock, fakeContext, type FakeFailure } from './test/fake-provider';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const both: { id: string; failure: FakeFailure }[] = [
  { id: 'a', failure: null },
  { id: 'b', failure: null },
];

function context(over: Partial<Omit<Parameters<typeof fakeContext>[0], 'clock'>>) {
  const made = fakeContext({
    providers: both,
    configured: ['a', 'b'],
    flag: null,
    env: null,
    config: {},
    clock: fakeClock({ start: Date.now() }),
    background: 'inert',
    ...over,
  });
  cleanups.push(made.cleanup);
  return made;
}

const silenced = async (task: () => Promise<void>) => {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await task();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
};

test('run --provider b starts and destroys on b only', async () => {
  const { ctx, fake } = context({ flag: 'b' });
  await silenced(() => run({ ctx, args: ['--', 'true'] }));
  expect(fake('b').history).toContain("'true'");
  expect(fake('a').history).toEqual([]);
  expect([...fake('a').alive(), ...fake('b').alive()]).toEqual([]);
});

test('run follows L2B_PROVIDER and the repo override when no flag is given', async () => {
  const viaEnv = context({ env: 'b' });
  await silenced(() => run({ ctx: viaEnv.ctx, args: ['--', 'true'] }));
  expect(viaEnv.fake('a').history).toEqual([]);
  expect(viaEnv.fake('b').history.length).toBeGreaterThan(0);

  const viaRepo = context({ config: { repos: { 'o/r': { provider: 'b' } } } });
  await viaRepo.addOrigin({ repo: 'o/r' });
  await silenced(() => run({ ctx: viaRepo.ctx, args: ['--repo', 'o/r', '--', 'true'] }));
  expect(viaRepo.fake('a').history).toEqual([]);
  expect(viaRepo.fake('b').history.length).toBeGreaterThan(0);
});

test('run with an unknown provider fails before touching any provider', async () => {
  expect(() => context({ flag: 'nope' })).toThrow('unknown provider "nope" (known: a, b)');
});

test('a bake on one provider leaves the other provider without a bake', async () => {
  const { ctx, fake, addOrigin } = context({ flag: 'b' });
  await addOrigin({ repo: 'o/r' });
  await silenced(() => bake({ ctx, args: ['o/r'] }));
  const spec = repoSpecFor({ config: ctx.config, repo: 'o/r', install: null, warm: null, baseBranch: null });
  expect(await fake('a').provider.bakedAt({ repo: spec })).toBeNull();
  expect(await fake('b').provider.bakedAt({ repo: spec })).not.toBeNull();
});

async function seedBox({ ctx, id, name }: { ctx: { providers: Provider[] }; id: string; name: string }) {
  const provider = ctx.providers.find((p) => p.id === id);
  await provider?.start({
    name,
    repo: null,
    branch: null,
    source: 'fresh',
    image: null,
    idle: { minutes: 15 },
    credentials: { variables: {}, git: null },
    gitIdentity: null,
  });
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

  await silenced(() => down({ ctx: { ...ctx, flag: 'b' }, args: ['dev'] }));
  expect(fake('a').alive()).toEqual(['dev']);
  expect(fake('b').alive()).toEqual([]);
  expect((await findBoxProvider({ ctx, name: 'dev' })).id).toBe('a');
});

test('a missing name gives the usual error', async () => {
  const { ctx } = context({});
  await expect(findBoxProvider({ ctx, name: 'ghost' })).rejects.toThrow('no sandbox named "ghost" on a, b (try: l2b ls)');
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
    'no sandbox named "ghost" on a, b (try: l2b ls); skipped, cannot authenticate: b'
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

test('a provider without a block counts as configured when its API key resolves', async () => {
  const config = configSchema.parse({});
  expect(await configuredProviders({ config, env: {} })).toEqual(['e2b']);
  expect(await configuredProviders({ config, env: { BOAT_API_KEY: 'k' } })).toEqual(['e2b', 'boat']);
  expect(await configuredProviders({ config: configSchema.parse({ provider: 'boat' }), env: { E2B_API_KEY: 'k' } })).toEqual(['e2b', 'boat']);
  expect(await configuredProviders({ config: configSchema.parse({ provider: 'boat' }), env: { E2B_API_KEY: '' } })).toEqual(['boat']);
});

const realIds = (configured: string[]) =>
  context({
    providers: [
      { id: 'e2b', failure: null },
      { id: 'boat', failure: null },
    ],
    configured,
  });

test('a provider whose key is available is searched by name and listed by ls', async () => {
  const configured = await configuredProviders({ config: configSchema.parse({}), env: { BOAT_API_KEY: 'k' } });
  const { ctx } = realIds(configured);
  await seedBox({ ctx, id: 'boat', name: 'box' });
  expect((await findBoxProvider({ ctx, name: 'box' })).id).toBe('boat');
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await ls({ ctx, args: [] });
  const rows = log.mock.calls.map((call) => String(call[0]).split('\t'));
  log.mockRestore();
  expect(rows.map((r) => [r[0], r[4]])).toEqual([['box', 'boat']]);
});

test('a provider with neither a block nor a key is not searched, but --provider still reaches it', async () => {
  const configured = await configuredProviders({ config: configSchema.parse({}), env: {} });
  const { ctx } = realIds(configured);
  await seedBox({ ctx, id: 'boat', name: 'box' });
  await expect(findBoxProvider({ ctx, name: 'box' })).rejects.toThrow('no sandbox named "box" on e2b (try: l2b ls)');
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await ls({ ctx, args: [] });
  const rows = log.mock.calls.length;
  log.mockRestore();
  expect(rows).toBe(0);
  expect((await findBoxProvider({ ctx: { ...ctx, flag: 'boat' }, name: 'box' })).id).toBe('boat');
});
