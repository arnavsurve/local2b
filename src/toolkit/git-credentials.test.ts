import { expect, test } from 'bun:test';
import { $ } from 'bun';
import { gitHostSchema, resolveGitHost } from '../git-host';
import { credentialHelperCommand } from './git-credentials';

const github = resolveGitHost(gitHostSchema.parse({ type: 'github' }));
const gitlab = resolveGitHost(gitHostSchema.parse({ type: 'gitlab', baseUrl: 'https://gitlab.example.com' }));
const generic = resolveGitHost(
  gitHostSchema.parse({
    type: 'generic',
    baseUrl: 'https://git.example.com/scm',
    username: 'bot',
    token: { from: 'env', name: 'L2B_TEST_GENERIC_TOKEN' },
  })
);

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


test('a generic tokenEnvVar is the variable the helper reads', () => {
  const host = resolveGitHost(
    gitHostSchema.parse({ type: 'generic', baseUrl: 'https://x.example', username: 'u', token: { from: 'env', name: 'X' }, tokenEnvVar: 'BB_TOKEN' })
  );
  expect(credentialHelperCommand(host)).toContain('password=$BB_TOKEN;');
});

test('GitHub Enterprise Server scopes the helper to its own origin', () => {
  const ghes = resolveGitHost(gitHostSchema.parse({ type: 'github', baseUrl: 'https://ghe.example.com/' }));
  expect(credentialHelperCommand(ghes)).toBe(
    `git config --global 'credential.https://ghe.example.com.helper' '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f'`
  );
});
