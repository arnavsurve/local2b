import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { bakeConfigState } from '../bake-config';
import { recentBakeFailure } from '../bake-failures';
import { acquireBakeLock } from '../bake-lock';
import { repoSpecFor } from '../repo';
import { fakeClock, fakeContext } from '../test/fake-provider';
import { bake } from './bake';
import { bakes } from './bakes';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  /** Bakes made through this clock are three hours old by the wall clock `bakes` measures age with. */
  const clock = fakeClock({ start: Date.now() - 3 * 3_600_000 });
  const made = fakeContext({
    providers: [
      { id: 'a', failure: null },
      { id: 'b', failure: null },
    ],
    configured: ['a', 'b'],
    flag: null,
    env: null,
    config: {},
    clock, background: 'inert',
  });
  cleanups.push(made.cleanup);
  await made.addOrigin({ repo: 'o/r' });
  await made.addOrigin({ repo: 'o/other' });
  return made;
}

/** Runs a command and returns what it printed to stdout. */
async function stdoutOf(task: () => Promise<void>) {
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await task();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.join('\n');
}

test('bakes lists the bakes on every configured provider with repo, provider, id and age', async () => {
  const { ctx } = await setup();
  await stdoutOf(() => bake({ ctx, args: ['o/r'] }));
  await stdoutOf(() => bake({ ctx: { ...ctx, flag: 'b' }, args: ['o/other'] }));
  expect(await stdoutOf(() => bakes({ ctx, args: [] }))).toBe(['o/r\ta\ta:o/r\t3h', 'o/other\tb\tb:o/other\t3h'].join('\n'));
  expect(await stdoutOf(() => bakes({ ctx: { ...ctx, flag: 'b' }, args: [] }))).toBe('o/other\tb\tb:o/other\t3h');
});

test('bake --delete removes the checkout repo bake on the selected provider and its local records', async () => {
  const { ctx, fake } = await setup();
  await stdoutOf(() => bake({ ctx, args: ['o/r'] }));
  await stdoutOf(() => bake({ ctx: { ...ctx, flag: 'b' }, args: ['o/r'] }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'l2b-bake-delete-')));
  cleanups.push(() => rmSync(work, { recursive: true, force: true }));
  await $`git clone --quiet ${`${ctx.config.gitHost.baseUrl}/o/r.git`} ${work}/r`.quiet();
  const inCheckout = { ...ctx, cwd: join(work, 'r') };

  expect(await stdoutOf(() => bake({ ctx: inCheckout, args: ['--delete'] }))).toBe('deleted the bake of o/r on a');
  const spec = repoSpecFor({ config: ctx.config, repo: 'o/r', install: null, warm: null, baseBranch: null });
  expect(await fake('a').provider.bakedAt({ repo: spec })).toBeNull();
  expect(await fake('b').provider.bakedAt({ repo: spec })).not.toBeNull();
  expect(await bakeConfigState({ provider: 'a', repo: spec })).toBe('unknown');
  expect(await bakeConfigState({ provider: 'b', repo: spec })).toBe('same');
  expect(await stdoutOf(() => bakes({ ctx, args: [] }))).not.toContain('\ta\t');

  await expect(stdoutOf(() => bake({ ctx: inCheckout, args: ['--delete'] }))).rejects.toThrow('no bake of o/r on a');
});

test('bake refuses to start while another bake of the repo runs, and says where its log is', async () => {
  const { ctx } = await setup();
  const other = Bun.spawn(['sleep', '30']);
  cleanups.push(() => other.kill());
  await acquireBakeLock({ provider: 'a', repo: 'o/r', pid: other.pid, log: '/tmp/bake.log' });
  await expect(bake({ ctx, args: ['o/r'] })).rejects.toThrow(
    `a bake of o/r on a is already running (pid ${other.pid}, log: /tmp/bake.log); boxes start from it once it finishes, so do not bake again`
  );
  expect(await stdoutOf(() => bake({ ctx, args: ['o/other'] }))).toContain('baked a:o/other');
});

test('a bake whose repo command fails is recorded as failed; a provider failure is not, so it is retried', async () => {
  const made = fakeContext({
    providers: [
      { id: 'a', failure: null },
      { id: 'down', failure: 'network' },
    ],
    configured: ['a', 'down'],
    flag: null,
    env: null,
    config: { repos: { 'o/r': { warm: 'exit 3' } } },
    clock: fakeClock({ start: Date.now() }),
    background: 'inert',
  });
  cleanups.push(made.cleanup);
  await made.addOrigin({ repo: 'o/r' });
  const spec = repoSpecFor({ config: made.ctx.config, repo: 'o/r', install: null, warm: null, baseBranch: null });
  const now = new Date();
  await expect(stdoutOf(() => bake({ ctx: made.ctx, args: ['o/r'] }))).rejects.toThrow('exit 3');
  expect(await recentBakeFailure({ provider: 'a', repo: spec, now })).not.toBeNull();
  await expect(stdoutOf(() => bake({ ctx: { ...made.ctx, flag: 'down' }, args: ['o/r'] }))).rejects.toThrow('unreachable');
  expect(await recentBakeFailure({ provider: 'down', repo: spec, now })).toBeNull();
});
