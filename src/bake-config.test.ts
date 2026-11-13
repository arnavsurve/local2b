import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bake } from './commands/bake';
import { run } from './commands/run';
import { up } from './commands/up';
import { PROJECT_FILE } from './project-config';
import { repoSpecFor } from './repo';
import { fakeClock, fakeContext } from './test/fake-provider';

const cleanups: (() => void)[] = [];
const CHANGED = 'project config changed since the bake';

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const clock = fakeClock({ start: Date.now() });
  const made = fakeContext({
    providers: [{ id: 'fake', failure: null }],
    configured: ['fake'],
    flag: null,
    env: null,
    config: {},
    clock,
  });
  cleanups.push(made.cleanup);
  await made.addOrigin({ repo: 'o/r' });
  const project = (content: unknown) => writeFileSync(join(made.ctx.cwd, PROJECT_FILE), JSON.stringify(content));
  return { ...made, clock, project };
}

async function output(task: () => Promise<void>) {
  const lines: string[] = [];
  const keep = (line: unknown) => {
    lines.push(String(line));
  };
  const log = spyOn(console, 'log').mockImplementation(keep);
  const err = spyOn(console, 'error').mockImplementation(keep);
  try {
    await task();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.join('\n');
}

test('up and run say so when the settings a bake used have changed since', async () => {
  const { ctx, project } = await setup();
  project({ repo: 'o/r', install: 'true' });
  await output(() => bake({ ctx, args: [] }));
  expect(await output(() => up({ ctx, args: ['same'] }))).not.toContain(CHANGED);

  project({ repo: 'o/r', install: 'true', setup: ['echo tool'] });
  const changed = await output(() => run({ ctx, args: ['--', 'true'] }));
  expect(changed).toContain(`l2b: ${CHANGED}; run l2b bake o/r`);
  expect(await output(() => up({ ctx, args: ['fresh', '--full'] }))).not.toContain(CHANGED);
});

test('bake --if-older-than skips a recent bake unless the settings changed', async () => {
  const { ctx, project, clock } = await setup();
  const bakedAt = async () =>
    (await ctx.provider.bakedAt({ repo: repoSpecFor({ config: ctx.config, repo: 'o/r', install: null, warm: null, baseBranch: null }) }))?.getTime();
  project({ repo: 'o/r', install: 'true' });
  await output(() => bake({ ctx, args: [] }));
  const first = await bakedAt();

  clock.advance({ ms: 60_000 });
  expect(await output(() => bake({ ctx, args: ['--if-older-than', '12h'] }))).toContain('skipping bake');
  expect(await bakedAt()).toBe(first);

  project({ repo: 'o/r', install: 'true', warm: 'echo warm' });
  expect(await output(() => bake({ ctx, args: ['--if-older-than', '12h'] }))).toContain(`${CHANGED}; baking`);
  expect(await bakedAt()).toBe((first ?? 0) + 60_000);
  expect(await output(() => up({ ctx, args: ['b'] }))).not.toContain(CHANGED);
});
