import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from './commands/exec';
import { run } from './commands/run';
import { PROJECT_FILE } from './project-config';
import { fakeClock, fakeContext } from './test/fake-provider';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  process.env.GH_TOKEN = 'test-token';
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  process.exitCode = 0;
});

async function setup({ config }: { config: Record<string, unknown> }) {
  const made = fakeContext({
    providers: [{ id: 'fake', failure: null }],
    configured: ['fake'],
    flag: null,
    env: null,
    config,
    clock: fakeClock({ start: Date.now() }),
    background: 'inert',
  });
  cleanups.push(made.cleanup);
  await made.addOrigin({ repo: 'o/r' });
  return made;
}

async function stderrOf(task: () => Promise<void>) {
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const err = spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const write = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await task();
  } finally {
    log.mockRestore();
    err.mockRestore();
    write.mockRestore();
  }
  return lines;
}

test('a repo run with no .l2b.json says nothing is set up or installed', async () => {
  const { ctx } = await setup({ config: {} });
  const lines = await stderrOf(() => run({ ctx, args: ['--repo', 'o/r', '--', 'true'] }));
  expect(lines).toContain(`l2b: no .l2b.json found from ${ctx.cwd}; nothing set up or installed (see l2b init)`);
});

test('the hint stays quiet with a .l2b.json, with repos.<o/r> install, or without a repo', async () => {
  const configured = await setup({ config: { repos: { 'o/r': { install: 'true' } } } });
  const fromUser = await stderrOf(() => run({ ctx: configured.ctx, args: ['--repo', 'o/r', '--', 'true'] }));
  expect(fromUser.join('\n')).not.toContain('.l2b.json');

  const { ctx } = await setup({ config: {} });
  expect((await stderrOf(() => run({ ctx, args: ['--', 'true'] }))).join('\n')).not.toContain('.l2b.json');
  writeFileSync(join(ctx.cwd, PROJECT_FILE), JSON.stringify({ repo: 'o/r' }));
  expect((await stderrOf(() => run({ ctx, args: ['--', 'true'] }))).join('\n')).not.toContain('no .l2b.json');
});

const NOT_FOUND = 'l2b: exit 127: a command was not found in the box; install it with "setup" in .l2b.json';

test('run and exec point at setup when the command is not found', async () => {
  const { ctx } = await setup({ config: {} });
  const ran = await stderrOf(() => run({ ctx, args: ['--keep', '--name', 'k', '--', 'l2b-no-such-tool'] }));
  expect(process.exitCode).toBe(127);
  expect(ran).toContain(NOT_FOUND);

  const execed = await stderrOf(() => exec({ ctx, args: ['k', '--', 'l2b-no-such-tool'] }));
  expect(process.exitCode).toBe(127);
  expect(execed).toContain(NOT_FOUND);

  expect(await stderrOf(() => exec({ ctx, args: ['k', '--', 'bash', '-c', 'exit 3'] }))).not.toContain(NOT_FOUND);
});
