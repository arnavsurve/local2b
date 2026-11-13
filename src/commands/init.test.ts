import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { findProjectConfig, PROJECT_FILE } from '../project-config';
import { fakeClock, fakeContext } from '../test/fake-provider';
import { init } from './init';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const made = fakeContext({
    providers: [{ id: 'fake', failure: null }],
    configured: ['fake'],
    flag: null,
    env: null,
    config: {},
    clock: fakeClock({ start: Date.now() }),
  });
  cleanups.push(made.cleanup);
  return made;
}

async function stdoutOf(task: () => Promise<void>) {
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    await task();
  } finally {
    log.mockRestore();
  }
  return lines.join('\n');
}

const STARTER = {
  repo: null,
  baseBranch: null,
  setup: [],
  install: null,
  warm: null,
  env: {},
  secrets: [],
  clone: {},
  provider: null,
  gitHost: null,
};

test('init writes a starter .l2b.json with every key, and refuses to overwrite it', async () => {
  const { ctx } = await setup();
  const path = join(ctx.cwd, PROJECT_FILE);
  const out = await stdoutOf(() => init({ ctx, args: [] }));
  expect(out).toContain(path);
  expect(out).toContain('#project-config');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(STARTER);
  expect((await findProjectConfig({ cwd: ctx.cwd }))?.config.install).toBeNull();
  await expect(init({ ctx, args: [] })).rejects.toThrow(`${path} already exists`);
});

test('init in a checkout fills in the repo and its default branch', async () => {
  const { ctx, addOrigin } = await setup();
  await addOrigin({ repo: 'o/r' });
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'l2b-init-')));
  cleanups.push(() => rmSync(work, { recursive: true, force: true }));
  await $`git clone --quiet ${`${ctx.config.gitHost.baseUrl}/o/r.git`} ${work}/r`.quiet();
  await $`git checkout -q feature/contract`.cwd(join(work, 'r')).quiet();
  await stdoutOf(() => init({ ctx: { ...ctx, cwd: join(work, 'r') }, args: [] }));
  expect(JSON.parse(readFileSync(join(work, 'r', PROJECT_FILE), 'utf8'))).toEqual({ ...STARTER, repo: 'o/r', baseBranch: 'main' });
});
