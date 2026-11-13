import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeNeed } from './auto-bake';
import { recordBakeConfig } from './bake-config';
import { bakeLockHolder } from './bake-lock';
import { bakeLogPath } from './background-bake';
import { run } from './commands/run';
import { up } from './commands/up';
import { PROJECT_FILE } from './project-config';
import { repoSpecFor } from './repo';
import { resolveTarget } from './target';
import { fakeClock, fakeContext } from './test/fake-provider';

const HOUR = 3_600_000;
const cleanups: (() => void | Promise<void>)[] = [];
const target = { provider: 'fake', repo: 'o/r' };

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}, 30_000);

/** Polls until no bake holds the lock, so a background bake has finished. */
async function bakeFinished() {
  const deadline = Date.now() + 30_000;
  while (await bakeLockHolder(target)) {
    if (Date.now() > deadline) throw new Error('background bake still running after 30s');
    await Bun.sleep(50);
  }
}

/**
 * A repo whose bake leaves `warmed` in the checkout, so a box shows whether
 * it started from a bake. It sleeps first, so a background bake is still
 * running when the test looks at it.
 */
async function setup({ bakeAgeHours }: { bakeAgeHours: number | null }) {
  const clock = fakeClock({ start: Date.now() - (bakeAgeHours ?? 0) * HOUR });
  const made = fakeContext({
    providers: [{ id: 'fake', failure: null }],
    configured: ['fake'],
    flag: null,
    env: null,
    config: {},
    clock,
    background: 'bake',
  });
  cleanups.push(made.cleanup, bakeFinished);
  await made.addOrigin({ repo: 'o/r' });
  const project = (content: Record<string, unknown>) =>
    writeFileSync(join(made.ctx.cwd, PROJECT_FILE), JSON.stringify({ repo: 'o/r', warm: 'sleep 2 && touch warmed', ...content }));
  project({});
  const spec = async () => {
    const { ctx } = await resolveTarget({ ctx: made.ctx, repo: null });
    return repoSpecFor({ config: ctx.config, repo: 'o/r', install: null, warm: null, baseBranch: null });
  };
  if (bakeAgeHours !== null) {
    const repo = await spec();
    await made.ctx.provider.bake({ repo, credentials: { variables: {}, git: null }, image: null });
    await recordBakeConfig({ provider: 'fake', repo });
    clock.advance({ ms: bakeAgeHours * HOUR });
  }
  const bakedAt = async () => (await made.ctx.provider.bakedAt({ repo: await spec() }))?.getTime() ?? null;
  return { ...made, project, bakedAt };
}

async function stderrOf(task: () => Promise<void>) {
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const err = spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    await task();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.join('\n');
}

async function startedFromBake({ ctx, name }: { ctx: Parameters<typeof up>[0]['ctx']; name: string }) {
  const box = await ctx.provider.connect({ name });
  return box.exec({ cmd: 'test -e warmed', cwd: null, onOutput: () => {} }).then((code) => code === 0);
}

test('the first start of a repo without a bake starts fresh and leaves a bake running in the background', async () => {
  const { ctx, bakedAt } = await setup({ bakeAgeHours: null });
  const said = await stderrOf(() => up({ ctx, args: ['first'] }));
  expect(await startedFromBake({ ctx, name: 'first' })).toBe(false);
  expect(said).toContain(`no current bake of o/r. Baking in the background for later boxes (log: ${bakeLogPath(target)})`);
  const holder = await bakeLockHolder(target);
  expect(holder?.pid).not.toBe(process.pid);
  expect(holder?.log).toBe(bakeLogPath(target));

  await bakeFinished();
  expect(await bakedAt()).not.toBeNull();
  expect(await stderrOf(() => up({ ctx, args: ['second'] }))).not.toContain('Baking in the background');
  expect(await startedFromBake({ ctx, name: 'second' })).toBe(true);
}, 30_000);

test('starts while a background bake runs do not start a second one', async () => {
  const { ctx } = await setup({ bakeAgeHours: null });
  const said = await stderrOf(async () => {
    await Promise.all([up({ ctx, args: ['a'] }), run({ ctx, args: ['--', 'true'] })]);
  });
  const holder = await bakeLockHolder(target);
  expect(said.split('Baking in the background')).toHaveLength(2);
  expect(said.split('A bake is already running for later boxes (pid ')).toHaveLength(2);
  expect(await stderrOf(() => up({ ctx, args: ['c'] }))).toContain('A bake is already running');
  expect((await bakeLockHolder(target))?.pid).toBe(holder?.pid ?? -1);
}, 30_000);

test('a bake past the staleness threshold is used now and re-baked in the background', async () => {
  const { ctx, bakedAt } = await setup({ bakeAgeHours: 100 });
  const before = await bakedAt();
  const said = await stderrOf(() => up({ ctx, args: ['b'] }));
  expect(said).toContain('the bake of o/r is 4d old; this box starts from it. Baking in the background');
  expect(await startedFromBake({ ctx, name: 'b' })).toBe(true);
  await bakeFinished();
  expect(await bakedAt()).toBeGreaterThan(before ?? Infinity);
}, 30_000);

test('a fresh bake with unchanged settings starts no bake', async () => {
  const { ctx } = await setup({ bakeAgeHours: 1 });
  expect(await stderrOf(() => up({ ctx, args: ['b'] }))).not.toContain('bake');
  expect(await bakeLockHolder(target)).toBeNull();
  expect(existsSync(bakeLogPath(target))).toBe(false);
}, 30_000);

test('an install change uses the old bake now and re-bakes', async () => {
  const { ctx, project, bakedAt } = await setup({ bakeAgeHours: 1 });
  const before = await bakedAt();
  project({ install: 'true' });
  const said = await stderrOf(() => up({ ctx, args: ['b'] }));
  expect(said).toContain('.l2b.json changed since the bake of o/r; this box starts from the bake and applies the change. Baking in the background');
  expect(await startedFromBake({ ctx, name: 'b' })).toBe(true);
  await bakeFinished();
  expect(await bakedAt()).toBeGreaterThan(before ?? Infinity);
}, 30_000);

test('a setup change starts without the old bake, which lacks it, and re-bakes', async () => {
  const { ctx, project, bakedAt } = await setup({ bakeAgeHours: 1 });
  const before = await bakedAt();
  project({ setup: ['touch ~/tool'] });
  const said = await stderrOf(() => up({ ctx, args: ['b'] }));
  expect(said).toContain('setup or warm changed since the bake of o/r; this box starts without the bake. Baking in the background');
  expect(await startedFromBake({ ctx, name: 'b' })).toBe(false);
  await bakeFinished();
  expect(await bakedAt()).toBeGreaterThan(before ?? Infinity);
  expect(await stderrOf(() => up({ ctx, args: ['c'] }))).not.toContain('bake');
  expect(await startedFromBake({ ctx, name: 'c' })).toBe(true);
}, 30_000);

test('a failed background bake is not retried with the same settings, and a settings change retries it', async () => {
  const { ctx, project } = await setup({ bakeAgeHours: null });
  project({ warm: 'exit 3' });
  await stderrOf(() => up({ ctx, args: ['a'] }));
  await bakeFinished();
  const said = await stderrOf(() => up({ ctx, args: ['b'] }));
  expect(said).toContain(`The last bake with these settings failed (log: ${bakeLogPath(target)}); fix setup, install or warm in .l2b.json`);
  expect(await bakeLockHolder(target)).toBeNull();
  project({ warm: 'touch warmed again' });
  expect(await stderrOf(() => up({ ctx, args: ['c'] }))).toContain('Baking in the background');
}, 30_000);

test('--full never waits on or starts a bake', async () => {
  const { ctx } = await setup({ bakeAgeHours: null });
  expect(await stderrOf(() => up({ ctx, args: ['b', '--full'] }))).not.toContain('bake');
  expect(await bakeLockHolder(target)).toBeNull();
}, 30_000);

test('bakeNeed', () => {
  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
  const need = (bakedAt: Date | null, configState: Parameters<typeof bakeNeed>[0]['configState']) =>
    bakeNeed({ bakedAt, configState, now, thresholdHours: 72 });
  expect(need(null, 'unknown')).toBe('missing');
  expect(need(ago(1), 'same')).toBeNull();
  expect(need(ago(73), 'same')).toBe('stale');
  expect(need(ago(1), 'changed')).toBe('changed');
  expect(need(ago(1), 'toolchain-changed')).toBe('toolchain-changed');
  expect(need(ago(1), 'unknown')).toBe('unrecorded');
});
