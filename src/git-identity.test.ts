import { expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGitIdentity } from './git-identity';

test('the git identity comes from the local global git config unless the config overrides it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l2b-ident-'));
  const globalConfig = join(dir, 'gitconfig');
  await $`git config --file ${globalConfig} user.name ${"Ada O'Neil"}`.quiet();
  await $`git config --file ${globalConfig} user.email ada@example.com`.quiet();
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    expect(await resolveGitIdentity({ override: null })).toEqual({ name: "Ada O'Neil", email: 'ada@example.com' });
    process.env.GIT_CONFIG_GLOBAL = join(dir, 'missing');
    expect(await resolveGitIdentity({ override: null })).toBeNull();
    expect(await resolveGitIdentity({ override: { name: 'o', email: 'o@x' } })).toEqual({ name: 'o', email: 'o@x' });
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  }
});
