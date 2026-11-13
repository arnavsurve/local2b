import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { recordBakeConfig } from './bake-config';
import { bake } from './commands/bake';
import { up } from './commands/up';
import { repoSpecFor } from './repo';
import { fakeClock, fakeContext, type FakeClock } from './test/fake-provider';

const HOUR = 3_600_000;
const cleanups: (() => void)[] = [];

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A fake provider whose clock reads `ageHours` ago when the repo is baked, then catches up to now. */
async function setup({ ageHours, config }: { ageHours: number | null; config: Record<string, unknown> }) {
  const clock: FakeClock = fakeClock({ start: Date.now() - (ageHours ?? 0) * HOUR });
  const made = fakeContext({ providers: [{ id: 'fake', failure: null }], configured: ['fake'], flag: null, env: null, config, clock, background: 'inert' });
  cleanups.push(made.cleanup);
  await made.addOrigin({ repo: 'o/r' });
  const fake = made.fake('fake');
  const spec = repoSpecFor({ config: made.ctx.config, repo: 'o/r', install: null, warm: null, baseBranch: null });
  if (ageHours !== null) {
    await fake.provider.bake({ repo: spec, credentials: { variables: {}, git: null }, image: null });
    await recordBakeConfig({ provider: 'fake', repo: spec });
    clock.advance({ ms: ageHours * HOUR });
  }
  return { ...made, provider: fake.provider, history: fake.history, spec };
}

const captured = async (task: () => Promise<void>) => {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await task();
    return { out: log.mock.calls.flat().map(String), err: err.mock.calls.flat().map(String) };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
};

test('bake --if-older-than skips a bake that is fresh enough', async () => {
  const { ctx, history } = await setup({ ageHours: 2, config: {} });
  const ran = history.length;
  const { out } = await captured(() => bake({ ctx, args: ['o/r', '--if-older-than', '12h'] }));
  expect(out.join('\n')).toContain('snapshot for o/r is 2h old, newer than 12h; skipping bake');
  expect(history.length).toBe(ran);
});

test('bake --if-older-than re-bakes an older bake and reports what it made', async () => {
  const { ctx, provider, spec } = await setup({ ageHours: 30, config: {} });
  const { out } = await captured(() => bake({ ctx, args: ['o/r', '--if-older-than', '12h'] }));
  expect(out).toContain('baked fake:o/r');
  expect(Date.now() - ((await provider.bakedAt({ repo: spec }))?.getTime() ?? 0)).toBeLessThan(60_000);
});

test('bake --if-older-than bakes when there is no bake yet', async () => {
  const { ctx, provider, spec } = await setup({ ageHours: null, config: {} });
  await captured(() => bake({ ctx, args: ['o/r', '--if-older-than', '12h'] }));
  expect(await provider.bakedAt({ repo: spec })).not.toBeNull();
});

test('bake rejects a malformed --if-older-than before doing any work', async () => {
  const { ctx, history } = await setup({ ageHours: null, config: {} });
  await expect(bake({ ctx, args: ['o/r', '--if-older-than', 'soon'] })).rejects.toThrow('bad duration');
  expect(history).toEqual([]);
});

async function rebakes({ ageHours, staleSnapshotHours }: { ageHours: number | null; staleSnapshotHours: number | null }) {
  const { ctx } = await setup({ ageHours, config: staleSnapshotHours === null ? {} : { staleSnapshotHours } });
  const { err } = await captured(() => up({ ctx, args: ['b', '--repo', 'o/r'] }));
  return err.filter((line) => line.includes('Baking in the background'));
}

test('up re-bakes in the background when the bake is older than the default 72h', async () => {
  const lines = await rebakes({ ageHours: 100, staleSnapshotHours: null });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('the bake of o/r is 4d old; this box starts from it');
});

test('up bakes in the background when there is no bake, and not for a fresh one', async () => {
  expect(await rebakes({ ageHours: 10, staleSnapshotHours: null })).toEqual([]);
  expect(await rebakes({ ageHours: null, staleSnapshotHours: null })).toHaveLength(1);
});

test('staleSnapshotHours is configurable', async () => {
  expect(await rebakes({ ageHours: 10, staleSnapshotHours: 5 })).toHaveLength(1);
  expect(await rebakes({ ageHours: 100, staleSnapshotHours: 200 })).toEqual([]);
});

test('up --full ignores the bake and clones the full history', async () => {
  const { ctx, history } = await setup({ ageHours: 1, config: {} });
  const ran = history.length;
  const { out } = await captured(() => up({ ctx, args: ['b', '--repo', 'o/r', '--full', '--branch', 'feature/contract'] }));
  expect(history.slice(ran).some((cmd) => cmd.includes('git clone'))).toBe(true);
  expect(out.join('\n')).toContain('b ready');
});
