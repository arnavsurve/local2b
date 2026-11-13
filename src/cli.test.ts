import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { COMMAND_HELP } from './help';

const CLI = resolve(import.meta.dir, 'cli.ts');

async function l2b(...args: string[]) {
  const proc = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

test('every subcommand answers --help and -h with its usage line', async () => {
  const cases = Object.entries(COMMAND_HELP).flatMap(([name, help]) =>
    ['--help', '-h'].map(async (flag) => ({ help, res: await l2b(name, flag) })),
  );
  for (const { help, res } of await Promise.all(cases)) {
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(help.usage);
    expect(res.stderr).toBe('');
  }
}, 30_000);

test('exec --help lists its flags', async () => {
  const res = await l2b('exec', '--help');
  expect(res.stdout).toContain('--cwd dir');
  expect(res.stdout).toContain('--provider id');
});

test('--help after -- belongs to the remote command', async () => {
  const res = await l2b('exec', '--', 'tool', '--help');
  expect(res.stdout).not.toContain('flags:');
});

test('bare l2b and --help list every command', async () => {
  for (const args of [[], ['--help'], ['-h']]) {
    const res = await l2b(...args);
    expect(res.code).toBe(0);
    for (const help of Object.values(COMMAND_HELP)) expect(res.stdout).toContain(help.usage);
  }
});

test('unknown command fails and lists commands', async () => {
  const res = await l2b('nope');
  expect(res.code).toBe(1);
  expect(res.stderr).toContain("unknown command 'nope'");
  expect(res.stderr).toContain(COMMAND_HELP.exec.usage);
});

test('--version and -v print the package version', async () => {
  const { version } = await Bun.file(resolve(import.meta.dir, '../package.json')).json();
  for (const flag of ['--version', '-v']) {
    const res = await l2b(flag);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(`${version}\n`);
  }
});
