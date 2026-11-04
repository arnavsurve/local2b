import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bake } from './commands/bake';
import { provisionBox } from './provision';
import { lookupSnapshot, recordBake } from './snapshots';
import { fakeContext } from './test/fake-provider';

const HOUR = 3_600_000;
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

const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

function seedSnapshot({ snapshots, ageHours }: { snapshots: Set<string>; ageHours: number | null }) {
  snapshots.add('l2b-r');
  if (ageHours === null) return Promise.resolve();
  return recordBake({ provider: 'fake', repo: 'o/r', at: hoursAgo(ageHours) });
}

test('lookupSnapshot has no snapshot until one exists, and no age until a bake is recorded', async () => {
  const { ctx, snapshots } = fakeContext({ execExitCode: 0, failExecWhen: null });
  expect(await lookupSnapshot({ provider: ctx.provider, repo: 'o/r' })).toBeNull();
  await seedSnapshot({ snapshots, ageHours: null });
  expect((await lookupSnapshot({ provider: ctx.provider, repo: 'o/r' }))?.createdAt).toBeNull();
  await recordBake({ provider: 'fake', repo: 'o/r', at: hoursAgo(1) });
  const found = await lookupSnapshot({ provider: ctx.provider, repo: 'o/r' });
  expect(found?.createdAt?.getTime()).toBeCloseTo(hoursAgo(1).getTime(), -4);
});

test('bake --if-older-than skips a snapshot that is fresh enough', async () => {
  const { ctx, snapshots, executed, alive } = fakeContext({ execExitCode: 0, failExecWhen: null });
  await seedSnapshot({ snapshots, ageHours: 2 });
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await bake({ ctx, args: ['o/r', '--if-older-than', '12h'] });
  expect(log.mock.calls.flat().join('\n')).toContain('skipping');
  log.mockRestore();
  expect(executed).toEqual([]);
  expect([...alive]).toEqual([]);
});

test('bake --if-older-than re-bakes an older snapshot and records the new bake time', async () => {
  const { ctx, snapshots, executed } = fakeContext({ execExitCode: 0, failExecWhen: null });
  await seedSnapshot({ snapshots, ageHours: 30 });
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await bake({ ctx, args: ['o/r', '--if-older-than', '12h'] });
  log.mockRestore();
  expect(executed.length).toBeGreaterThan(0);
  const found = await lookupSnapshot({ provider: ctx.provider, repo: 'o/r' });
  expect(Date.now() - (found?.createdAt?.getTime() ?? 0)).toBeLessThan(60_000);
});

test.each([false, true])('bake --if-older-than re-bakes when the age is unknown (snapshot exists: %p)', async (exists) => {
  const { ctx, snapshots, executed } = fakeContext({ execExitCode: 0, failExecWhen: null });
  if (exists) await seedSnapshot({ snapshots, ageHours: null });
  const log = spyOn(console, 'log').mockImplementation(() => {});
  await bake({ ctx, args: ['o/r', '--if-older-than', '12h'] });
  log.mockRestore();
  expect(executed.length).toBeGreaterThan(0);
});

test('bake rejects a malformed --if-older-than before doing any work', async () => {
  const { ctx, executed } = fakeContext({ execExitCode: 0, failExecWhen: null });
  await expect(bake({ ctx, args: ['o/r', '--if-older-than', 'soon'] })).rejects.toThrow('bad duration');
  expect(executed).toEqual([]);
});

async function provisionHints({ ageHours, staleSnapshotHours }: { ageHours: number | null; staleSnapshotHours: number | null }) {
  const { ctx, snapshots } = fakeContext({ execExitCode: 0, failExecWhen: null });
  if (staleSnapshotHours !== null) ctx.config.staleSnapshotHours = staleSnapshotHours;
  await seedSnapshot({ snapshots, ageHours });
  const err = spyOn(console, 'error').mockImplementation(() => {});
  await provisionBox({
    ctx,
    opts: { name: 'b', repo: 'o/r', branch: null, full: false, install: null, doppler: null, image: null },
  });
  const lines = err.mock.calls.flat().map(String);
  err.mockRestore();
  return lines.filter((line) => line.includes('l2b bake'));
}

test('up hints to re-bake when the snapshot is older than the default 72h', async () => {
  const hints = await provisionHints({ ageHours: 100, staleSnapshotHours: null });
  expect(hints).toHaveLength(1);
  expect(hints[0]).toContain('l2b bake o/r');
});

test('up stays quiet for a fresh snapshot or an unknown age', async () => {
  expect(await provisionHints({ ageHours: 10, staleSnapshotHours: null })).toEqual([]);
  expect(await provisionHints({ ageHours: null, staleSnapshotHours: null })).toEqual([]);
});

test('staleSnapshotHours is configurable', async () => {
  expect(await provisionHints({ ageHours: 10, staleSnapshotHours: 5 })).toHaveLength(1);
  expect(await provisionHints({ ageHours: 100, staleSnapshotHours: 200 })).toEqual([]);
});
