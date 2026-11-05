import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { bakeScript, cloneCommand, switchScript } from './git-scripts';

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

test('bake script clones the base branch and chains install then warm-up', () => {
  const base = { remote: 'https://github.com/o/r.git', mirror: '/m/r.git', checkout: '/seed', depth: 50, filter: 'blob:limit=50m' };
  const none = bakeScript({ ...base, install: null, warm: null, branch: null });
  expect(none).not.toContain('/seed &&');
  expect(none).not.toContain('--branch');

  const full = bakeScript({
    ...base,
    install: 'yarn install',
    warm: 'yarn gen',
    branch: 'trunk',
  });
  expect(full).toContain("--branch 'trunk'");
  expect(full).toContain(" 'https://github.com/o/r.git' '/m/r.git'");
  expect(full).toContain("cd '/seed' && yarn install && yarn gen");
});

test('default mirror scripts are byte-identical to the pre-configurable output', () => {
  const base = {
    remote: 'https://github.com/o/r.git',
    mirror: '/m/o/r.git',
    checkout: '/h/r',
    depth: 50,
    filter: 'blob:limit=50m',
  };
  expect(bakeScript({ ...base, install: 'yarn install', warm: 'yarn gen', branch: 'trunk' })).toBe(
    "set -e\nmkdir -p '/m/o'\ngit clone --quiet --bare --depth=50 --filter=blob:limit=50m --branch 'trunk' 'https://github.com/o/r.git' '/m/o/r.git'\ngit -C '/m/o/r.git' config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'\ngit -C '/m/o/r.git' worktree add --quiet --detach '/h/r' HEAD\ncd '/h/r' && yarn install && yarn gen"
  );
  expect(bakeScript({ ...base, install: null, warm: null, branch: null })).toBe(
    "set -e\nmkdir -p '/m/o'\ngit clone --quiet --bare --depth=50 --filter=blob:limit=50m  'https://github.com/o/r.git' '/m/o/r.git'\ngit -C '/m/o/r.git' config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'\ngit -C '/m/o/r.git' worktree add --quiet --detach '/h/r' HEAD"
  );
  expect(switchScript({ mirror: '/m/o/r.git', dir: '/h/r', branch: 'feat/x', depth: 50 })).toBe(
    "set -e\nbase=$(git -C '/m/o/r.git' fetch --quiet --depth=50 origin HEAD && git -C '/m/o/r.git' rev-parse FETCH_HEAD)\nbranch='feat/x'\nif git -C '/m/o/r.git' fetch --quiet --depth=50 origin \"refs/heads/$branch:refs/remotes/origin/$branch\"; then start=\"origin/$branch\"; else start=\"$base\"; fi\ngit -C '/h/r' checkout --quiet -B \"$branch\" \"$start\""
  );
  expect(switchScript({ mirror: '/m/o/r.git', dir: '/h/r', branch: null, depth: 50 })).toBe(
    "set -e\nbase=$(git -C '/m/o/r.git' fetch --quiet --depth=50 origin HEAD && git -C '/m/o/r.git' rev-parse FETCH_HEAD)\ngit -C '/h/r' checkout --quiet --detach \"$base\""
  );
});

test('a null filter omits the flag and a null depth omits --depth', () => {
  const none = cloneCommand({ remote: 'r', dir: '/d', branch: null, depth: null, filter: null });
  expect(none).not.toContain('--filter');
  expect(none).not.toContain('--depth');
  const tree = cloneCommand({ remote: 'r', dir: '/d', branch: 'b', depth: 3, filter: 'blob:none' });
  expect(tree).toContain('--depth=3 --filter=blob:none');
});

test('a filter with shell metacharacters is quoted rather than interpreted', async () => {
  const marker = join(root, 'pwned');
  const cmd = cloneCommand({
    remote: `file://${origin}`,
    dir: join(root, 'x'),
    branch: null,
    depth: null,
    filter: `blob:none; touch ${marker}`,
  });
  await expect(runScript(cmd)).rejects.toThrow();
  expect(await Bun.file(marker).exists()).toBe(false);
});

async function addCommits(n: number) {
  for (let i = 1; i <= n; i++) {
    await Bun.write(join(origin, `c${i}.txt`), `${i}\n`);
    await git({ cwd: origin, args: ['add', '.'] });
    await git({ cwd: origin, args: ['commit', '-qm', `c${i}`] });
  }
}

async function bakePlain({ depth, filter }: { depth: number | null; filter: string | null }) {
  const dir = join(root, 'plain');
  await runScript(
    bakeScript({
      remote: `file://${origin}`,
      mirror: null,
      checkout: dir,
      install: null,
      warm: null,
      branch: null,
      depth,
      filter,
    })
  );
  return dir;
}

test('plain bake makes an ordinary clone with no mirror or worktree', async () => {
  const dir = await bakePlain({ depth: 50, filter: null });
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('main\n');
  expect(await git({ cwd: dir, args: ['rev-parse', '--git-dir'] })).toBe('.git');
  expect(await git({ cwd: dir, args: ['rev-parse', '--is-bare-repository'] })).toBe('false');
});

test('plain strategy switches to an existing remote branch in place', async () => {
  const dir = await bakePlain({ depth: 50, filter: null });
  await runScript(switchScript({ mirror: null, dir, branch: 'feature/x', depth: 50 }));
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('feature\n');
  expect(await git({ cwd: dir, args: ['branch', '--show-current'] })).toBe('feature/x');
});

test('plain strategy creates a new branch from the default branch', async () => {
  const dir = await bakePlain({ depth: 50, filter: null });
  await runScript(switchScript({ mirror: null, dir, branch: 'brand-new', depth: 50 }));
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('main\n');
  expect(await git({ cwd: dir, args: ['branch', '--show-current'] })).toBe('brand-new');
});

test('plain strategy without a branch detaches at the latest default tip', async () => {
  const dir = await bakePlain({ depth: 50, filter: null });
  await addCommits(1);
  await runScript(switchScript({ mirror: null, dir, branch: null, depth: 50 }));
  expect(await Bun.file(join(dir, 'c1.txt')).text()).toBe('1\n');
  expect(await git({ cwd: dir, args: ['branch', '--show-current'] })).toBe('');
});

test('depth null keeps full history and a number keeps it shallow', async () => {
  await addCommits(4);
  const full = await bakePlain({ depth: null, filter: null });
  expect(await git({ cwd: full, args: ['rev-list', '--count', 'HEAD'] })).toBe('5');
  rmSync(full, { recursive: true, force: true });
  const shallow = await bakePlain({ depth: 2, filter: null });
  expect(await git({ cwd: shallow, args: ['rev-list', '--count', 'HEAD'] })).toBe('2');
});

test('a partial-clone filter still lets a plain checkout switch branches', async () => {
  await git({ cwd: origin, args: ['config', 'uploadpack.allowFilter', 'true'] });
  const dir = await bakePlain({ depth: null, filter: 'blob:none' });
  await runScript(switchScript({ mirror: null, dir, branch: 'feature/x', depth: null }));
  expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('feature\n');
});
