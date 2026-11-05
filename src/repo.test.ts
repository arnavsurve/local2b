import { expect, test } from 'bun:test';
import { checkoutDir, mirrorDir, parseRepo, repoName, snapshotName } from './repo';

test('snapshot names include the owner so same-named repos do not collide', () => {
  expect(snapshotName('acme/api')).toBe('l2b-acme-api');
  expect(snapshotName('other/api')).toBe('l2b-other-api');
});

test('snapshot names are lowercased and sanitized to letters, digits and hyphens', () => {
  expect(snapshotName('Acme-Inc/My.Repo_2')).toBe('l2b-acme-inc-my-repo-2');
});

test('mirror directories are unique per owner', () => {
  expect(mirrorDir({ homeDir: '/h', repo: 'acme/api' })).not.toBe(mirrorDir({ homeDir: '/h', repo: 'other/api' }));
  expect(mirrorDir({ homeDir: '/h', repo: 'acme/api' })).toBe('/h/mirrors/acme/api.git');
});

test('the checkout path depends only on the repo name', () => {
  expect(checkoutDir({ homeDir: '/h', repo: 'acme/api' })).toBe('/h/api');
  expect(checkoutDir({ homeDir: '/h', repo: 'acme/api' })).toBe(checkoutDir({ homeDir: '/h', repo: 'other/api' }));
  expect(repoName('acme/api')).toBe('api');
});

test('malformed repos are rejected with a clear error', () => {
  for (const bad of ['api', '', 'a/b/c', '/api', 'acme/', 'acme/..', '../x', 'a b/c', 'acme/a;b']) {
    expect(() => parseRepo(bad)).toThrow(/expected owner\/name/);
  }
});

test('valid repos parse into owner and name', () => {
  expect(parseRepo('acme/my.repo_x-1')).toEqual({ owner: 'acme', name: 'my.repo_x-1' });
});
