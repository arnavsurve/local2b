import { afterEach, expect, test } from 'bun:test';
import { configSchema } from './config';
import { resolveCredentials } from './credentials';

afterEach(() => {
  delete process.env.GH_TOKEN;
  delete process.env.L2B_TEST_SECRET;
  delete process.env.GITLAB_TOKEN;
});

test('secret sources and the git host token become variables, and the token wins a name clash', async () => {
  process.env.GH_TOKEN = 'gh-test-token';
  process.env.L2B_TEST_SECRET = 'from-source';
  const config = configSchema.parse({ secrets: [{ type: 'env', names: ['L2B_TEST_SECRET', 'GH_TOKEN'] }] });
  const credentials = await resolveCredentials({ config, repo: null, doppler: null });
  expect(credentials).toEqual({
    variables: { L2B_TEST_SECRET: 'from-source', GH_TOKEN: 'gh-test-token' },
    git: { baseUrl: 'https://github.com', username: 'x-access-token', tokenEnvVar: 'GH_TOKEN' },
  });
});

test('the repo picks its own git host', async () => {
  process.env.GITLAB_TOKEN = 'glpat';
  const config = configSchema.parse({ repos: { 'o/r': { gitHost: { type: 'gitlab' } } } });
  const credentials = await resolveCredentials({ config, repo: 'o/r', doppler: null });
  expect(credentials.variables).toEqual({ GITLAB_TOKEN: 'glpat' });
  expect(credentials.git?.username).toBe('oauth2');
});
