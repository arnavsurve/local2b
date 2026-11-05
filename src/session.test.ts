import { beforeAll, expect, test } from 'bun:test';
import { $ } from 'bun';
import { ENV_FILE, plainEnvFile, pushCreds, pushEnv } from './session';
import { fakeContext } from './test/fake-provider';

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
  await pushCreds({ box, host: { type: 'github' }, sources: [{ type: 'env', names: ['L2B_TEST_SECRET'] }] });
  const content = `${files.get(plainEnvFile({ homeDir: '/home/user' })) ?? ''}${files.get(ENV_FILE) ?? ''}`;
  expect(await sourcedEnv({ content, name: 'NO_DOPPLER_WRAP' })).toBe('1');
  expect(await sourcedEnv({ content, name: 'L2B_TEST_SECRET' })).toBe('from-source');
  expect(await sourcedEnv({ content, name: 'GH_TOKEN' })).toBe('gh-test-token');
});

test('a secret source wins over a plain env var of the same name', async () => {
  const { ctx, files } = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/home/user' });
  const box = await ctx.provider.create({ name: 'b', image: 'i', workdir: '/w' });
  await pushEnv({ box, env: { L2B_TEST_SECRET: 'plain' } });
  await pushCreds({ box, host: { type: 'github' }, sources: [{ type: 'env', names: ['L2B_TEST_SECRET'] }] });
  const content = `${files.get(plainEnvFile({ homeDir: '/home/user' })) ?? ''}${files.get(ENV_FILE) ?? ''}`;
  expect(await sourcedEnv({ content, name: 'L2B_TEST_SECRET' })).toBe('from-source');
});
