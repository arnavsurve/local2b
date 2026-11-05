import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { up } from './commands/up';
import { fakeClock, fakeContext } from './test/fake-provider';

const cleanups: (() => void)[] = [];
const saved = process.env.GIT_CONFIG_GLOBAL;

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = saved;
});

async function boxEmail({ config }: { config: Record<string, unknown> }) {
  const made = fakeContext({
    providers: [{ id: 'a', failure: null }],
    configured: ['a'],
    flag: null,
    env: null,
    config,
    clock: fakeClock({ start: Date.now() }),
  });
  cleanups.push(made.cleanup);
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await up({ ctx: made.ctx, args: ['b'] });
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  const box = await made.ctx.provider.connect({ name: 'b' });
  let out = '';
  await box.exec({ cmd: 'git config --global --get user.email', cwd: null, onOutput: (o) => (out += o.stream === 'stdout' ? o.data : '') });
  return out.trim();
}

test('up gives the box the local global git identity, and the config overrides it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l2b-ident-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const globalConfig = join(dir, 'gitconfig');
  await $`git config --file ${globalConfig} user.name Local`.quiet();
  await $`git config --file ${globalConfig} user.email local@example.com`.quiet();
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  expect(await boxEmail({ config: {} })).toBe('local@example.com');
  expect(await boxEmail({ config: { gitIdentity: { name: 'Cfg', email: 'cfg@example.com' } } })).toBe('cfg@example.com');
});
