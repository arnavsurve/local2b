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
  expect(mirrorDir('acme/api')).not.toBe(mirrorDir('other/api'));
  expect(mirrorDir('acme/api')).toEndWith('/mirrors/acme/api.git');
});

test('the checkout path depends only on the repo name', () => {
  expect(checkoutDir('acme/api')).toEndWith('/api');
  expect(checkoutDir('acme/api')).toBe(checkoutDir('other/api'));
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
