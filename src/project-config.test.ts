import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema } from './config';
import { hostFor } from './git-host';
import { findProjectConfig, PROJECT_FILE, projectConfigSchema, withProjectConfig } from './project-config';
import { repoSpecFor } from './repo';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'l2b-project-')));
  dirs.push(root);
  const deep = join(root, 'a', 'b', 'c');
  mkdirSync(deep, { recursive: true });
  return { root, deep };
}

const write = (dir: string, content: unknown) => writeFileSync(join(dir, PROJECT_FILE), JSON.stringify(content));

test('the nearest .l2b.json walking up from cwd wins', async () => {
  const { root, deep } = tree();
  write(root, { install: 'outer' });
  write(join(root, 'a', 'b'), { install: 'inner' });
  const found = await findProjectConfig({ cwd: deep });
  expect(found?.path).toBe(join(root, 'a', 'b', PROJECT_FILE));
  expect(found?.config.install).toBe('inner');
  expect((await findProjectConfig({ cwd: join(root, 'a') }))?.config.install).toBe('outer');
});

test('no .l2b.json up to the filesystem root yields null', async () => {
  const { deep } = tree();
  expect(await findProjectConfig({ cwd: deep })).toBeNull();
});

test('unknown keys and bad JSON are rejected naming the file', async () => {
  const { root, deep } = tree();
  write(root, { instal: 'typo' });
  await expect(findProjectConfig({ cwd: deep })).rejects.toThrow(join(root, PROJECT_FILE));
  await expect(findProjectConfig({ cwd: deep })).rejects.toThrow(/instal/);
  writeFileSync(join(root, PROJECT_FILE), '{ nope');
  await expect(findProjectConfig({ cwd: deep })).rejects.toThrow(join(root, PROJECT_FILE));
});

test('a malformed repo is rejected', () => {
  expect(projectConfigSchema.safeParse({ repo: 'not-a-repo' }).success).toBe(false);
  expect(projectConfigSchema.safeParse({ repo: 'o/r' }).success).toBe(true);
});

test('the project file wins over repos.<o/r>, which wins over globals; unset keys inherit', () => {
  const config = configSchema.parse({
    clone: { depth: 20 },
    secrets: [{ type: 'env', names: ['USER_SECRET'] }],
    repos: {
      'o/r': {
        install: 'user install',
        warm: 'user warm',
        baseBranch: 'develop',
        env: { A: 'user', B: 'user' },
        clone: { strategy: 'plain' },
        provider: 'p1',
        setup: ['user setup'],
      },
    },
  });
  const project = projectConfigSchema.parse({
    install: 'project install',
    setup: ['project setup'],
    warm: null,
    env: { B: 'project' },
    clone: { filter: null },
    provider: 'p2',
    gitHost: { type: 'gitlab' },
    secrets: [{ type: 'env', names: ['PROJECT_SECRET'] }],
  });
  const merged = withProjectConfig({ config, repo: 'o/r', project });
  expect(repoSpecFor({ config: merged, repo: 'o/r', install: null, warm: null, baseBranch: null })).toEqual({
    owner: 'o',
    name: 'r',
    remoteUrl: 'https://gitlab.com/o/r.git',
    baseBranch: 'develop',
    clone: { strategy: 'plain', depth: 20, filter: null },
    setup: ['project setup'],
    install: 'project install',
    warm: 'user warm',
    env: { A: 'user', B: 'project' },
  });
  expect(merged.repos['o/r']?.provider).toBe('p2');
  expect(hostFor({ config: merged, repo: 'o/r' }).tokenEnvVar).toBe('GITLAB_TOKEN');
  expect(merged.secrets).toEqual([
    { type: 'env', names: ['USER_SECRET'] },
    { type: 'env', names: ['PROJECT_SECRET'] },
  ]);
  const inherited = withProjectConfig({ config, repo: 'o/r', project: projectConfigSchema.parse({ setup: [] }) });
  expect(repoSpecFor({ config: inherited, repo: 'o/r', install: null, warm: null, baseBranch: null }).setup).toEqual(['user setup']);
  const flags = repoSpecFor({ config: merged, repo: 'o/r', install: 'flag', warm: null, baseBranch: 'main' });
  expect([flags.install, flags.baseBranch]).toEqual(['flag', 'main']);
});

test('a project file applies to a repo with no repos entry', () => {
  const config = configSchema.parse({});
  const merged = withProjectConfig({ config, repo: 'x/y', project: projectConfigSchema.parse({ install: 'make deps' }) });
  expect(repoSpecFor({ config: merged, repo: 'x/y', install: null, warm: null, baseBranch: null }).install).toBe('make deps');
  expect(config.repos['x/y']).toBeUndefined();
});
