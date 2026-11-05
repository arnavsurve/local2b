import { beforeAll, expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitHostSchema, resolveGitHost } from '../git-host';
import { ENV_FILE, plainEnvFile, gitIdentityCommand, pushCreds, pushEnv } from './session';
import { fakeContext } from '../test/fake-machine';

beforeAll(() => {
  process.env.GH_TOKEN = 'gh-test-token';
  process.env.L2B_TEST_SECRET = 'from-source';
});

async function sourcedEnv({ content, name }: { content: string; name: string }) {
  const script = `${content}printf %s "$${name}"`;
  return (await $`bash -c ${script}`.quiet()).text();
}

test('repo env vars are exported alongside the credentials', async () => {
  const { ctx, files } = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/home/user' });
  const box = await ctx.provider.create({ name: 'b', image: 'i', workdir: '/w' });
  await pushEnv({ box, env: { NO_DOPPLER_WRAP: '1' } });
  await pushCreds({ box, host: resolveGitHost(gitHostSchema.parse({ type: 'github' })), sources: [{ type: 'env', names: ['L2B_TEST_SECRET'] }] });
  const content = `${files.get(plainEnvFile({ homeDir: '/home/user' })) ?? ''}${files.get(ENV_FILE) ?? ''}`;
  expect(await sourcedEnv({ content, name: 'NO_DOPPLER_WRAP' })).toBe('1');
  expect(await sourcedEnv({ content, name: 'L2B_TEST_SECRET' })).toBe('from-source');
  expect(await sourcedEnv({ content, name: 'GH_TOKEN' })).toBe('gh-test-token');
});

test('a secret source wins over a plain env var of the same name', async () => {
  const { ctx, files } = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/home/user' });
  const box = await ctx.provider.create({ name: 'b', image: 'i', workdir: '/w' });
  await pushEnv({ box, env: { L2B_TEST_SECRET: 'plain' } });
  await pushCreds({ box, host: resolveGitHost(gitHostSchema.parse({ type: 'github' })), sources: [{ type: 'env', names: ['L2B_TEST_SECRET'] }] });
  const content = `${files.get(plainEnvFile({ homeDir: '/home/user' })) ?? ''}${files.get(ENV_FILE) ?? ''}`;
  expect(await sourcedEnv({ content, name: 'L2B_TEST_SECRET' })).toBe('from-source');
});

test('the identity command sets a global author that git commits with', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l2b-ident-'));
  const home = join(dir, 'home');
  const repo = join(dir, 'repo');
  await $`mkdir -p ${home} ${repo}`.quiet();
  const env = { PATH: process.env.PATH ?? '', HOME: home };
  await $`bash -c ${gitIdentityCommand({ identity: { name: "Ada O'Neil", email: 'ada@example.com' } })}`.env(env).quiet();
  await $`git init -q ${repo}`.env(env).quiet();
  await $`git -C ${repo} commit -q --allow-empty -m x`.env(env).quiet();
  expect((await $`git -C ${repo} log -1 --format=%an,%ae`.env(env).quiet()).text().trim()).toBe("Ada O'Neil,ada@example.com");
});
