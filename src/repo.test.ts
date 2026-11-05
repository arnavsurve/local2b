import { expect, test } from 'bun:test';
import { parseRepo, repoName } from './repo';

test('malformed repos are rejected with a clear error', () => {
  for (const bad of ['api', '', 'a/b/c', '/api', 'acme/', 'acme/..', '../x', 'a b/c', 'acme/a;b']) {
    expect(() => parseRepo(bad)).toThrow(/expected owner\/name/);
  }
});

test('valid repos parse into owner and name', () => {
  expect(parseRepo('acme/my.repo_x-1')).toEqual({ owner: 'acme', name: 'my.repo_x-1' });
  expect(repoName('acme/api')).toBe('api');
});
