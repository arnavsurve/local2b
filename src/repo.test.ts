import { expect, test } from 'bun:test';
import { configSchema } from './config';
import { parseRepo, repoName, repoSpecFor } from './repo';

test('malformed repos are rejected with a clear error', () => {
  for (const bad of ['api', '', 'a/b/c', '/api', 'acme/', 'acme/..', '../x', 'a b/c', 'acme/a;b']) {
    expect(() => parseRepo(bad)).toThrow(/expected owner\/name/);
  }
});

test('valid repos parse into owner and name', () => {
  expect(parseRepo('acme/my.repo_x-1')).toEqual({ owner: 'acme', name: 'my.repo_x-1' });
  expect(repoName('acme/api')).toBe('api');
});

test('a repo spec merges config with command-line overrides', () => {
  const config = configSchema.parse({
    cloneDepth: 10,
    repos: { 'o/r': { install: 'yarn', warm: 'make gen', baseBranch: 'develop', env: { A: '1' }, clone: { filter: null } } },
  });
  expect(repoSpecFor({ config, repo: 'o/r', install: null, warm: null, baseBranch: null })).toEqual({
    owner: 'o',
    name: 'r',
    remoteUrl: 'https://github.com/o/r.git',
    baseBranch: 'develop',
    clone: { strategy: 'mirror', depth: 10, filter: null },
    install: 'yarn',
    warm: 'make gen',
    env: { A: '1' },
  });
  const flags = repoSpecFor({ config, repo: 'o/r', install: '', warm: 'true', baseBranch: 'main' });
  expect([flags.install, flags.warm, flags.baseBranch]).toEqual(['', 'true', 'main']);
  expect(repoSpecFor({ config, repo: 'x/y', install: null, warm: null, baseBranch: null }).install).toBeNull();
});
