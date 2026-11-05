import { expect, test } from 'bun:test';
import { checkoutDir, mirrorDir, snapshotName } from './layout';

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
});
