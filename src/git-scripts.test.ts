import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { bakeScript, switchScript } from './git-scripts';

let root: string;
let origin: string;
let mirror: string;
let checkout: string;

async function git({ cwd, args }: { cwd: string; args: string[] }) {
  const out = await $`git -c user.name=t -c user.email=t@t ${args}`
    .cwd(cwd)
    .quiet();
  return out.text().trim();
}

async function runScript(script: string) {
  const out = await $`bash -c ${script}`.nothrow().quiet();
  if (out.exitCode !== 0) throw new Error(out.stderr.toString());
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'l2b-'));
  origin = join(root, 'origin');
  mirror = join(root, 'mirrors', 'origin.git');
  await $`git init -q -b main ${origin}`.quiet();
  await Bun.write(join(origin, 'a.txt'), 'main\n');
  await git({ cwd: origin, args: ['add', '.'] });
  await git({ cwd: origin, args: ['commit', '-qm', 'init'] });
  await git({ cwd: origin, args: ['checkout', '-qb', 'feature/x'] });
  await Bun.write(join(origin, 'a.txt'), 'feature\n');
  await git({ cwd: origin, args: ['commit', '-qam', 'feature work'] });
  await git({ cwd: origin, args: ['checkout', '-q', 'main'] });
  await $`git clone -q --bare ${origin} ${mirror}`.quiet();
  await git({ cwd: mirror, args: ['remote', 'set-url', 'origin', `file://${origin}`] });
  checkout = join(root, 'checkout');
  await git({ cwd: mirror, args: ['worktree', 'add', '-q', '--detach', checkout, 'HEAD'] });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test('switch to an existing remote branch checks out that branch', async () => {
  const dir = checkout;
  await runScript(switchScript({ depth: 50, mirror, dir, branch: 'feature/x' }));
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('feature\n');
  expect(await git({ cwd: dir, args: ['branch', '--show-current'] })).toBe('feature/x');
});

test('switch to a new branch starts from the default branch', async () => {
  const dir = checkout;
  await runScript(switchScript({ depth: 50, mirror, dir, branch: 'brand-new' }));
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('main\n');
  expect(await git({ cwd: dir, args: ['branch', '--show-current'] })).toBe('brand-new');
});

test('switch without a branch is a detached checkout of the default branch', async () => {
  const dir = checkout;
  await runScript(switchScript({ depth: 50, mirror, dir, branch: null }));
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('main\n');
  expect(await git({ cwd: dir, args: ['branch', '--show-current'] })).toBe('');
});

test('switch picks up commits pushed to the remote after the mirror was made', async () => {
  await Bun.write(join(origin, 'b.txt'), 'later\n');
  await git({ cwd: origin, args: ['add', '.'] });
  await git({ cwd: origin, args: ['commit', '-qm', 'later'] });
  const dir = checkout;
  await runScript(switchScript({ depth: 50, mirror, dir, branch: null }));
  expect(await Bun.file(join(dir, 'b.txt')).text()).toBe('later\n');
});

test('branch names with shell metacharacters are not interpreted', async () => {
  const dir = checkout;
  const marker = join(root, 'pwned');
  const script = switchScript({ depth: 50, mirror, dir, branch: `x'; touch ${marker}; '` });
  await expect(runScript(script)).rejects.toThrow();
  expect(await Bun.file(marker).exists()).toBe(false);
});

test('untracked files such as node_modules survive a switch', async () => {
  await Bun.write(join(checkout, 'node_modules', 'pkg', 'index.js'), 'x');
  await runScript(switchScript({ depth: 50, mirror, dir: checkout, branch: 'feature/x' }));
  expect(await Bun.file(join(checkout, 'node_modules', 'pkg', 'index.js')).text()).toBe('x');
});

test('a shallow mirror stays shallow but still switches to branches', async () => {
  for (const n of [1, 2, 3, 4]) {
    await Bun.write(join(origin, `c${n}.txt`), `${n}\n`);
    await git({ cwd: origin, args: ['add', '.'] });
    await git({ cwd: origin, args: ['commit', '-qm', `c${n}`] });
  }
  const shallow = join(root, 'shallow.git');
  await $`git clone -q --bare --depth=2 file://${origin} ${shallow}`.quiet();
  const dir = join(root, 'shallow-checkout');
  await git({ cwd: shallow, args: ['worktree', 'add', '-q', '--detach', dir, 'HEAD'] });
  await runScript(switchScript({ depth: 2, mirror: shallow, dir, branch: 'feature/x' }));
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('feature\n');
  const commits = await git({ cwd: shallow, args: ['rev-list', '--count', '--all'] });
  expect(Number(commits)).toBeLessThanOrEqual(4);
});

test('bake script only runs an install step when one is configured', () => {
  const base = { repo: 'o/r', mirror: '/m/r.git', checkout: '/seed', depth: 50 };
  expect(bakeScript({ ...base, install: null })).not.toContain('/seed &&');
  expect(bakeScript({ ...base, install: 'yarn install' })).toContain(
    "cd '/seed' && yarn install"
  );
});
