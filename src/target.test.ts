import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { readBoxRecord } from './box-records';
import { run } from './commands/run';
import { up } from './commands/up';
import { repoFromRemote } from './local-checkout';
import { PROJECT_FILE } from './project-config';
import { fakeClock, fakeContext } from './test/fake-provider';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

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
    background: 'inert',
  });
  cleanups.push(made.cleanup);
  await made.addOrigin({ repo: 'o/r' });
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'l2b-work-')));
  cleanups.push(() => rmSync(work, { recursive: true, force: true }));
  const clone = join(work, 'r');
  await $`git clone --quiet ${`${made.ctx.config.gitHost.baseUrl}/o/r.git`} ${clone}`.quiet();
  const git = (args: string[]) => $`git -c user.name=t -c user.email=t@t ${args}`.cwd(clone).quiet();
  return { ...made, work, clone, git };
}

/** Runs a command and returns what it printed to stderr. */
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

async function boxFile({ made, name, path }: { made: Awaited<ReturnType<typeof setup>>; name: string; path: string }) {
  const box = await made.ctx.provider.connect({ name });
  let out = '';
  await box.exec({ cmd: `cat ${path}`, cwd: null, onOutput: (o) => (out += o.stream === 'stdout' ? o.data : '') });
  return out.trim();
}

test('origin remotes on the git host map to owner/name; others do not', () => {
  const base = 'https://github.com';
  expect(repoFromRemote({ remote: 'https://github.com/o/r.git', baseUrl: base })).toBe('o/r');
  expect(repoFromRemote({ remote: 'https://x-access-token:secret@github.com/o/r', baseUrl: base })).toBe('o/r');
  expect(repoFromRemote({ remote: 'git@github.com:o/r.git', baseUrl: base })).toBe('o/r');
  expect(repoFromRemote({ remote: 'ssh://git@github.com/o/r.git', baseUrl: base })).toBe('o/r');
  expect(repoFromRemote({ remote: 'https://gitlab.com/o/r.git', baseUrl: base })).toBeNull();
  expect(repoFromRemote({ remote: 'https://github.com/o/r/extra.git', baseUrl: base })).toBeNull();
  expect(repoFromRemote({ remote: 'https://ghe.example.com/git/o/r.git', baseUrl: 'https://ghe.example.com/git/' })).toBe('o/r');
  expect(repoFromRemote({ remote: 'file:///srv/origins/o/r.git', baseUrl: 'file:///srv/origins' })).toBe('o/r');
});

test('up infers --repo and --branch from the checkout in cwd', async () => {
  const made = await setup();
  await made.git(['checkout', '-q', 'feature/contract']);
  const ctx = { ...made.ctx, cwd: join(made.clone) };
  const err = await stderrOf(() => up({ ctx, args: ['b'] }));
  expect(err).not.toContain('unpushed');
  expect(await boxFile({ made, name: 'b', path: 'a.txt' })).toBe('feature');
  expect((await readBoxRecord({ name: 'b', providers: ['fake'] }))?.repo).toBe('o/r');
  expect((await readBoxRecord({ name: 'b', providers: ['fake'] }))?.branch).toBe('feature/contract');
});

test('flags win over inference, and a flagged other repo does not take the local branch', async () => {
  const made = await setup();
  await made.addOrigin({ repo: 'o/other' });
  await made.git(['checkout', '-q', 'feature/contract']);
  const ctx = { ...made.ctx, cwd: made.clone };
  await stderrOf(() => up({ ctx, args: ['b', '--branch', 'main'] }));
  expect(await boxFile({ made, name: 'b', path: 'a.txt' })).toBe('main');
  await stderrOf(() => up({ ctx, args: ['c', '--repo', 'o/other'] }));
  expect((await readBoxRecord({ name: 'c', providers: ['fake'] }))?.branch).toBeNull();
});

test('unpushed commits and a branch missing on origin each warn on one line', async () => {
  const made = await setup();
  writeFileSync(join(made.clone, 'b.txt'), 'local\n');
  await made.git(['add', '.']);
  await made.git(['commit', '-qm', 'local work']);
  const ctx = { ...made.ctx, cwd: made.clone };
  const ahead = await stderrOf(() => run({ ctx, args: ['--', 'true'] }));
  expect(ahead).toContain('l2b: branch main has 1 unpushed commit');

  await made.git(['checkout', '-qb', 'feat/local-only']);
  const missing = await stderrOf(() => run({ ctx, args: ['--', 'true'] }));
  expect(missing).toContain('l2b: branch feat/local-only is not on origin');
});

test('a .l2b.json in a parent dir applies to every checkout under it', async () => {
  const made = await setup();
  writeFileSync(join(made.work, PROJECT_FILE), JSON.stringify({ install: 'echo project > installed.txt', env: { FROM: 'project' } }));
  const ctx = { ...made.ctx, cwd: made.clone };
  await stderrOf(() => up({ ctx, args: ['b'] }));
  expect(await boxFile({ made, name: 'b', path: 'installed.txt' })).toBe('project');
});

test('a .l2b.json naming another repo fails when it is the nearest', async () => {
  const made = await setup();
  writeFileSync(join(made.work, PROJECT_FILE), JSON.stringify({ repo: 'o/elsewhere' }));
  const ctx = { ...made.ctx, cwd: made.clone };
  await expect(stderrOf(() => up({ ctx, args: ['b'] }))).rejects.toThrow(
    `${join(made.work, PROJECT_FILE)} is for o/elsewhere, not o/r`
  );
  await expect(stderrOf(() => up({ ctx: made.ctx, args: ['c', '--repo', 'o/r'] }))).resolves.not.toContain('is for');
});

test('a .l2b.json with a repo supplies --repo outside a checkout', async () => {
  const made = await setup();
  const dir = join(made.work, 'notes');
  mkdirSync(dir);
  writeFileSync(join(dir, PROJECT_FILE), JSON.stringify({ repo: 'o/r', install: 'echo yes > installed.txt' }));
  await stderrOf(() => up({ ctx: { ...made.ctx, cwd: dir }, args: ['b'] }));
  expect(await boxFile({ made, name: 'b', path: 'installed.txt' })).toBe('yes');
});

test('a checkout whose origin is on another host needs --repo', async () => {
  const made = await setup();
  await made.git(['remote', 'set-url', 'origin', 'https://elsewhere.example.com/o/r.git']);
  const ctx = { ...made.ctx, cwd: made.clone };
  await expect(stderrOf(() => up({ ctx, args: ['b'] }))).rejects.toThrow(/origin remote is not on .*; pass --repo/);
});
