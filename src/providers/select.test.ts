import { expect, test } from 'bun:test';
import { extractProviderFlag, resolveProviderId } from './select';

const knownIds = ['a', 'b', 'c'];
const base = { flag: null, env: null, repoOverride: null, configDefault: 'a', knownIds };

test.each([
  { name: 'config default alone', input: {}, expected: 'a' },
  { name: 'repo override beats the default', input: { repoOverride: 'b' }, expected: 'b' },
  { name: 'env beats repo override', input: { repoOverride: 'b', env: 'c' }, expected: 'c' },
  { name: 'flag beats env', input: { repoOverride: 'b', env: 'c', flag: 'a' }, expected: 'a' },
  { name: 'flag beats everything else', input: { env: 'c', flag: 'b' }, expected: 'b' },
])('precedence: $name', ({ input, expected }) => {
  expect(resolveProviderId({ ...base, ...input })).toBe(expected);
});

test.each([{ flag: 'zzz' }, { env: 'zzz' }, { repoOverride: 'zzz' }, { configDefault: 'zzz' }])(
  'an unknown id lists the known ones (%o)',
  (input) => {
    expect(() => resolveProviderId({ ...base, ...input })).toThrow('unknown provider "zzz" (known: a, b, c)');
  }
);

test('extractProviderFlag finds the flag before, between and after other args', () => {
  expect(extractProviderFlag({ args: ['--provider', 'b', 'up', 'x'] })).toEqual({ providerId: 'b', args: ['up', 'x'] });
  expect(extractProviderFlag({ args: ['up', 'x', '--provider=b', '--full'] })).toEqual({
    providerId: 'b',
    args: ['up', 'x', '--full'],
  });
});

test('extractProviderFlag leaves everything after -- alone', () => {
  expect(extractProviderFlag({ args: ['run', '--', 'tool', '--provider', 'b'] })).toEqual({
    providerId: null,
    args: ['run', '--', 'tool', '--provider', 'b'],
  });
  expect(extractProviderFlag({ args: ['run', '--provider', 'a', '--', 'x', '--provider', 'b'] })).toEqual({
    providerId: 'a',
    args: ['run', '--', 'x', '--provider', 'b'],
  });
});

test('extractProviderFlag rejects a missing value', () => {
  expect(() => extractProviderFlag({ args: ['up', '--provider'] })).toThrow('--provider needs a provider id');
});
