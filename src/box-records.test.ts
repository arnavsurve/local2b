import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { exec } from './commands/exec';
import { down } from './commands/lifecycle';
import { up } from './commands/up';
import { readBoxRecord, recordBoxStart } from './box-records';
import { fakeClock, fakeContext, type FakeClock } from './test/fake-provider';

const MINUTE = 60_000;
const cleanups: (() => void)[] = [];

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const clock: FakeClock = fakeClock({ start: Date.now() });
  const made = fakeContext({
    providers: [{ id: 'fake', failure: null }],
    configured: ['fake'],
    flag: null,
    env: null,
    config: { idle: { minutes: 15 } },
    clock, background: 'inert',
  });
  cleanups.push(made.cleanup);
  await made.addOrigin({ repo: 'o/r' });
  return { ...made, clock };
}

const quiet = async (task: () => Promise<void>) => {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await task();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
};

test('a box l2b started that has since expired says so and how to start it again', async () => {
  const { ctx, clock } = await setup();
  await quiet(() => up({ ctx, args: ['dev', '--repo', 'o/r', '--branch', 'feat/x'] }));
  clock.advance({ ms: 16 * MINUTE });
  const error = await exec({ ctx, args: ['dev', '--', 'true'] }).catch((err: Error) => err);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toMatch(
    /^box "dev" expired: no l2b activity for 15 min since \d\d:\d\d \(idle\.minutes in the l2b config\)\. Start it again: l2b up dev --repo o\/r --branch feat\/x$/
  );
});

test('a name l2b never started keeps the generic error', async () => {
  const { ctx } = await setup();
  await expect(exec({ ctx, args: ['ghost', '--', 'true'] })).rejects.toThrow(
    'no sandbox named "ghost" on fake; start one with `l2b up ghost`, or list running boxes with `l2b ls`'
  );
});

test('down forgets the box', async () => {
  const { ctx } = await setup();
  await quiet(() => up({ ctx, args: ['dev', '--repo', 'o/r'] }));
  expect(await readBoxRecord({ name: 'dev' })).not.toBeNull();
  await quiet(() => down({ ctx, args: ['dev'] }));
  expect(await readBoxRecord({ name: 'dev' })).toBeNull();
  await expect(exec({ ctx, args: ['dev', '--', 'true'] })).rejects.toThrow('no sandbox named "dev"');
});

test('using a box moves its last-used time forward', async () => {
  const { ctx } = await setup();
  await quiet(() => up({ ctx, args: ['dev'] }));
  const old = new Date(Date.now() - 10 * MINUTE);
  await recordBoxStart({ provider: 'fake', name: 'dev', repo: null, branch: null, idleMinutes: 15, at: old });
  await quiet(() => exec({ ctx, args: ['dev', '--', 'true'] }));
  const record = await readBoxRecord({ name: 'dev' });
  expect(new Date(record?.lastUsedAt ?? 0).getTime()).toBeGreaterThan(old.getTime());
  expect(record?.startedAt).toBe(old.toISOString());
});

test('records older than a few days are pruned', async () => {
  await recordBoxStart({
    provider: 'fake',
    name: 'stale',
    repo: null,
    branch: null,
    idleMinutes: 15,
    at: new Date(Date.now() - 4 * 24 * 60 * MINUTE),
  });
  await recordBoxStart({ provider: 'fake', name: 'fresh', repo: null, branch: null, idleMinutes: 15, at: new Date() });
  expect(await readBoxRecord({ name: 'stale' })).toBeNull();
  expect(await readBoxRecord({ name: 'fresh' })).not.toBeNull();
});
