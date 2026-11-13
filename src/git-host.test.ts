import { afterEach, expect, test } from 'bun:test';
import {
  gitHostSchema,
  hostFor,
  remoteUrl,
  resolveGitHost,
  resolveHostToken,
} from './git-host';
import { configSchema } from './config';
import type { ValueRef } from './secrets';

const githubConfig = gitHostSchema.parse({ type: 'github' });
const gitlabConfig = gitHostSchema.parse({ type: 'gitlab', baseUrl: 'https://gitlab.example.com' });
const genericConfig = gitHostSchema.parse({
  type: 'generic',
  baseUrl: 'https://git.example.com/scm',
  username: 'bot',
  token: { from: 'env', name: 'L2B_TEST_GENERIC_TOKEN' },
});
const github = resolveGitHost(githubConfig);
const gitlab = resolveGitHost(gitlabConfig);
const generic = resolveGitHost(genericConfig);

afterEach(() => {
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITLAB_TOKEN;
  delete process.env.L2B_TEST_GENERIC_TOKEN;
});

test('remote URLs per host', () => {
  expect(remoteUrl({ host: github, repo: 'o/r' })).toBe('https://github.com/o/r.git');
  expect(remoteUrl({ host: gitlab, repo: 'g/sub/r' })).toBe(
    'https://gitlab.example.com/g/sub/r.git'
  );
  expect(remoteUrl({ host: generic, repo: 'o/r' })).toBe(
    'https://git.example.com/scm/o/r.git'
  );
  expect(
    remoteUrl({ host: resolveGitHost({ ...gitlabConfig, baseUrl: 'https://gl.test/' }), repo: 'o/r' })
  ).toBe('https://gl.test/o/r.git');
});

test('presets default their base URL; generic defaults its token variable', () => {
  expect(gitHostSchema.parse({ type: 'gitlab' })).toEqual({
    type: 'gitlab',
    baseUrl: 'https://gitlab.com',
  });
  expect(gitHostSchema.parse({ type: 'github' })).toEqual({
    type: 'github',
    baseUrl: 'https://github.com',
  });
  expect(genericConfig).toMatchObject({ tokenEnvVar: 'L2B_GIT_TOKEN' });
});

test('generic rejects a token variable name that is not a shell identifier', () => {
  expect(() =>
    gitHostSchema.parse({ ...genericConfig, tokenEnvVar: 'X; rm -rf /' })
  ).toThrow();
});

test('credential username and token env var per host', () => {
  expect(github.username).toBe('x-access-token');
  expect(gitlab.username).toBe('oauth2');
  expect(generic.username).toBe('bot');
  expect(github.tokenEnvVar).toBe('GH_TOKEN');
  expect(gitlab.tokenEnvVar).toBe('GITLAB_TOKEN');
  expect(generic.tokenEnvVar).toBe('L2B_GIT_TOKEN');
});

test('github token comes from GH_TOKEN, then GITHUB_TOKEN', async () => {
  process.env.GITHUB_TOKEN = 'b';
  expect(await resolveHostToken(github)).toBe('b');
  process.env.GH_TOKEN = 'a';
  expect(await resolveHostToken(github)).toBe('a');
});

test('gitlab token comes from GITLAB_TOKEN', async () => {
  process.env.GITLAB_TOKEN = 'glpat';
  expect(await resolveHostToken(gitlab)).toBe('glpat');
});

test('generic token resolves its value reference', async () => {
  process.env.L2B_TEST_GENERIC_TOKEN = 'tok';
  expect(await resolveHostToken(generic)).toBe('tok');
});

test('a per-repo host overrides the global one; the default is github', () => {
  const config = configSchema.parse({
    gitHost: { type: 'gitlab' },
    repos: { 'o/r': { gitHost: { type: 'github' } }, 'o/s': {} },
  });
  expect(hostFor({ config, repo: 'o/r' })).toEqual(github);
  expect(hostFor({ config, repo: 'o/s' }).tokenEnvVar).toBe('GITLAB_TOKEN');
  expect(hostFor({ config, repo: null }).tokenEnvVar).toBe('GITLAB_TOKEN');
  expect(hostFor({ config: configSchema.parse({}), repo: 'x/y' })).toEqual(github);
});

const ghes = resolveGitHost(
  gitHostSchema.parse({ type: 'github', baseUrl: 'https://ghe.example.com/' })
);

test('GitHub Enterprise Server uses its base URL for the remote', () => {
  expect(remoteUrl({ host: ghes, repo: 'o/r' })).toBe('https://ghe.example.com/o/r.git');
});

test('the CLI fallback names the host only when it is not the default', () => {
  expect(github.token).toEqual({
    from: 'firstOf',
    refs: [
      { from: 'env', name: 'GH_TOKEN' },
      { from: 'env', name: 'GITHUB_TOKEN' },
      { from: 'command', argv: ['gh', 'auth', 'token'], timeoutMs: 30_000 },
    ],
  });
  expect(ghes.token).toMatchObject({
    refs: [
      { name: 'GH_TOKEN' },
      { name: 'GITHUB_TOKEN' },
      { argv: ['gh', 'auth', 'token', '--hostname', 'ghe.example.com'] },
    ],
  });
  expect(gitlab.token).toMatchObject({
    refs: [
      { name: 'GITLAB_TOKEN' },
      { argv: ['glab', 'auth', 'token', '--hostname', 'gitlab.example.com'] },
    ],
  });
  expect(resolveGitHost(gitHostSchema.parse({ type: 'gitlab' })).token).toMatchObject({
    refs: [{}, { argv: ['glab', 'auth', 'token'] }],
  });
});

test('generic tokenEnvVar is exported name and helper variable', () => {
  const host = resolveGitHost(gitHostSchema.parse({ ...genericConfig, tokenEnvVar: 'BB_TOKEN' }));
  expect(host.tokenEnvVar).toBe('BB_TOKEN');
});

test('presets are fully described by the resolved shape', () => {
  const rows = [
    { host: githubConfig, baseUrl: 'https://github.com', username: 'x-access-token', tokenEnvVar: 'GH_TOKEN' },
    { host: gitlabConfig, baseUrl: 'https://gitlab.example.com', username: 'oauth2', tokenEnvVar: 'GITLAB_TOKEN' },
    { host: genericConfig, baseUrl: 'https://git.example.com/scm', username: 'bot', tokenEnvVar: 'L2B_GIT_TOKEN' },
  ];
  for (const row of rows) {
    const resolved = resolveGitHost(row.host);
    expect(resolved).toMatchObject({
      baseUrl: row.baseUrl,
      username: row.username,
      tokenEnvVar: row.tokenEnvVar,
    });
    expect(remoteUrl({ host: resolved, repo: 'o/r' })).toBe(`${row.baseUrl}/o/r.git`);
  }
});

test('a failed token chain gives the preset hint and no values', async () => {
  const failing: ValueRef = {
    from: 'firstOf',
    refs: [
      { from: 'env', name: 'L2B_TEST_UNSET' },
      { from: 'command', argv: ['l2b-test-no-such-binary'], timeoutMs: 5000 },
    ],
  };
  await expect(resolveHostToken({ ...github, token: failing })).rejects.toThrow(
    'no GitHub token: GH_TOKEN and GITHUB_TOKEN are not set and `gh auth token` printed none. Only the user can fix this: tell them to run `gh auth login` once'
  );
  await expect(resolveHostToken({ ...gitlab, token: failing })).rejects.toThrow(
    'no GitLab token: GITLAB_TOKEN is not set and `glab auth token` printed none. Only the user can fix this: tell them to run `glab auth login` once'
  );
  await expect(resolveHostToken({ ...generic, token: failing })).rejects.toThrow(
    'L2B_TEST_UNSET'
  );
});
