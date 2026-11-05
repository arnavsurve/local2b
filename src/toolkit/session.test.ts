import { expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIdentityCommand } from './session';

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
