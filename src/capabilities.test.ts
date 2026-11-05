import { beforeAll, expect, spyOn, test } from 'bun:test';
import { pause } from './commands/lifecycle';
import { shell } from './commands/shell';
import { configSchema } from './config';
import { provisionBox } from './provision';
import type { Capabilities } from './providers/types';
import { fakeContext } from './test/fake-provider';

const opts = { name: 'dev', repo: null, branch: null, full: false, install: null, doppler: null, image: null };

beforeAll(() => {
  process.env.GH_TOKEN = 'test-token';
});

function setup({ capabilities, idleAction }: { capabilities: Partial<Capabilities>; idleAction: 'kill' | 'pause' }) {
  const fake = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir: '/home/user' });
  fake.ctx.provider.capabilities = { ...fake.ctx.provider.capabilities, ...capabilities };
  fake.ctx.config = configSchema.parse({ idle: { action: idleAction } });
  return fake;
}

async function stderrOf(task: () => Promise<unknown>) {
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await task();
    return err.mock.calls.flat().map(String);
  } finally {
    err.mockRestore();
  }
}

test('idle.action "pause" on a provider that cannot pause fails before any box exists', async () => {
  const { ctx, alive } = setup({ capabilities: { pause: null }, idleAction: 'pause' });
  await expect(provisionBox({ ctx, opts })).rejects.toThrow('idle.action "pause" is not supported by provider fake');
  expect([...alive]).toEqual([]);
});

test('idle.action "kill" works on a provider that cannot pause', async () => {
  const { ctx, alive } = setup({ capabilities: { pause: null }, idleAction: 'kill' });
  await provisionBox({ ctx, opts });
  expect([...alive]).toEqual(['dev']);
});

test('a disk-only pause is explained once when idle.action is "pause"', async () => {
  const { ctx } = setup({ capabilities: { pause: 'disk' }, idleAction: 'pause' });
  const lines = await stderrOf(() => provisionBox({ ctx, opts }));
  expect(lines.filter((line) => line.includes('keep their disk but not memory or running processes'))).toHaveLength(1);
});

test('a memory pause says nothing extra', async () => {
  const { ctx } = setup({ capabilities: { pause: 'memory' }, idleAction: 'pause' });
  const lines = await stderrOf(() => provisionBox({ ctx, opts }));
  expect(lines.filter((line) => line.includes('provider fake'))).toEqual([]);
});

test('up warns when the provider caps box lifetime under a day', async () => {
  const { ctx } = setup({ capabilities: { maxLifetimeMs: 6 * 3_600_000 }, idleAction: 'kill' });
  const lines = await stderrOf(() => provisionBox({ ctx, opts }));
  expect(lines).toContain('l2b: provider fake ends every box after 6h, whatever its activity; push work you want to keep');
});

test.each([null, 48 * 3_600_000])('no lifetime warning for a cap of %p', async (maxLifetimeMs) => {
  const { ctx } = setup({ capabilities: { maxLifetimeMs }, idleAction: 'kill' });
  const lines = await stderrOf(() => provisionBox({ ctx, opts }));
  expect(lines.filter((line) => line.includes('ends every box'))).toEqual([]);
});

test('l2b pause on a provider that cannot pause fails and leaves the box alone', async () => {
  const { ctx, alive } = setup({ capabilities: { pause: null }, idleAction: 'kill' });
  await ctx.provider.create({ name: 'dev', image: 'i', workdir: '/w' });
  await expect(pause({ ctx, args: ['dev'] })).rejects.toThrow("provider fake can't pause boxes; use l2b down dev");
  expect([...alive]).toEqual(['dev']);
});

test('l2b shell on a provider without a shell suggests exec', async () => {
  const { ctx } = setup({ capabilities: { shell: null }, idleAction: 'kill' });
  await ctx.provider.create({ name: 'dev', image: 'i', workdir: '/w' });
  await expect(shell({ ctx, args: ['dev'] })).rejects.toThrow(
    "provider fake has no interactive shell; use l2b exec dev -- <cmd>"
  );
});
