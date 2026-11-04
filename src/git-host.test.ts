import { afterEach, expect, test } from 'bun:test';
import { $ } from 'bun';
import {
  credentialHelperCommand,
  credentialUsername,
  gitHostSchema,
  hostFor,
  remoteUrl,
  resolveHostToken,
  tokenEnvVar,
  type GitHost,
} from './git-host';
import { configSchema } from './config';

const github: GitHost = { type: 'github' };
const gitlab: GitHost = { type: 'gitlab', baseUrl: 'https://gitlab.example.com' };
const generic: GitHost = {
  type: 'generic',
  baseUrl: 'https://git.example.com/scm',
  username: 'bot',
  token: { from: 'env', name: 'L2B_TEST_GENERIC_TOKEN' },
};

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
    remoteUrl({ host: { ...gitlab, baseUrl: 'https://gl.test/' }, repo: 'o/r' })
  ).toBe('https://gl.test/o/r.git');
});

test('gitlab defaults to gitlab.com', () => {
  expect(gitHostSchema.parse({ type: 'gitlab' })).toEqual({
    type: 'gitlab',
    baseUrl: 'https://gitlab.com',
  });
});

test('credential username and token env var per host', () => {
  expect(credentialUsername(github)).toBe('x-access-token');
  expect(credentialUsername(gitlab)).toBe('oauth2');
  expect(credentialUsername(generic)).toBe('bot');
  expect(tokenEnvVar(github)).toBe('GH_TOKEN');
  expect(tokenEnvVar(gitlab)).toBe('GITLAB_TOKEN');
  expect(tokenEnvVar(generic)).toBe('L2B_GIT_TOKEN');
});

test('github credential helper is scoped to github.com with the original helper body', () => {
  expect(credentialHelperCommand(github)).toBe(
    `git config --global 'credential.https://github.com.helper' '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f'`
  );
});

test('credential helper for other hosts is scoped to their base URL', () => {
  expect(credentialHelperCommand(gitlab)).toBe(
    `git config --global 'credential.https://gitlab.example.com.helper' '!f() { echo username=oauth2; echo password=$GITLAB_TOKEN; }; f'`
  );
  expect(credentialHelperCommand(generic)).toBe(
    `git config --global 'credential.https://git.example.com.helper' '!f() { echo username=bot; echo password=$L2B_GIT_TOKEN; }; f'`
  );
});

test('the credential helper really answers git with the exported token', async () => {
  const cmd = credentialHelperCommand(gitlab).replace('--global', '--local');
  const dir = (await $`mktemp -d`.text()).trim();
  const script = `cd ${dir} && git init -q && ${cmd} && export GITLAB_TOKEN=glpat-1 && printf 'protocol=https\nhost=gitlab.example.com\n\n' | git credential fill`;
  const out = (await $`bash -c ${script}`.quiet()).text();
  expect(out).toContain('username=oauth2');
  expect(out).toContain('password=glpat-1');
  await $`rm -rf ${dir}`.quiet();
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
  expect(hostFor({ config, repo: 'o/s' }).type).toBe('gitlab');
  expect(hostFor({ config, repo: null }).type).toBe('gitlab');
  expect(hostFor({ config: configSchema.parse({}), repo: 'x/y' })).toEqual(github);
});
