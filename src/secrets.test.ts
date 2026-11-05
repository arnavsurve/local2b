import { expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dopplerArgv,
  loadSecrets,
  parseDopplerTarget,
  parseVariables,
  resolveValue,
  secretSourceSchema,
  toEnvFile,
  valueRefSchema,
} from './secrets';

test('env file round-trips awkward values through a real shell', async () => {
  const vars = {
    PLAIN: 'abc',
    DOLLAR: 'cost $HOME `id` $(id)',
    QUOTES: `it's "quoted"`,
    NEWLINE: 'line1\nline2',
  };
  for (const [key, value] of Object.entries(vars)) {
    const script = `${toEnvFile(vars)}printf %s "$${key}"`;
    const out = await $`bash -c ${script}`.quiet();
    expect(out.text()).toBe(value);
  }
});

test('doppler target parses project/config and rejects anything else', () => {
  expect(parseDopplerTarget('proj/dev')).toEqual({
    type: 'doppler',
    project: 'proj',
    config: 'dev',
  });
  expect(() => parseDopplerTarget('proj')).toThrow('<project>/<config>');
});

test('env sources read named variables and fail loudly when one is missing', async () => {
  process.env.L2B_TEST_A = 'one';
  expect(await loadSecrets({ type: 'env', names: ['L2B_TEST_A'] })).toEqual({
    L2B_TEST_A: 'one',
  });
  await expect(loadSecrets({ type: 'env', names: ['L2B_TEST_MISSING'] })).rejects.toThrow(
    'L2B_TEST_MISSING'
  );
  expect(await resolveValue({ from: 'env', name: 'L2B_TEST_A' })).toBe('one');
});

const sh = (script: string) => ['sh', '-c', script];

test('json output parses into variables', async () => {
  const vars = await loadSecrets({
    type: 'command',
    argv: ['printf', '%s', '{"A":"1","B":"two words"}'],
    format: 'json',
    timeoutMs: 5000,
  });
  expect(vars).toEqual({ A: '1', B: 'two words' });
});

test('dotenv output handles quotes, comments and export prefix', async () => {
  const text = '# comment\nexport A=1\nB="two words"\nC=\'single\'\n';
  expect(parseVariables({ text, format: 'dotenv', origin: 'test' })).toEqual({
    A: '1',
    B: 'two words',
    C: 'single',
  });
});

test('json with a non-string value is rejected without leaking the value', () => {
  const run = () =>
    parseVariables({ text: '{"TOKEN":{"x":"hunter2"}}', format: 'json', origin: 'test' });
  expect(run).toThrow('TOKEN');
  try {
    run();
  } catch (error) {
    expect(String(error)).not.toContain('hunter2');
  }
  expect(() => parseVariables({ text: '["hunter2"]', format: 'json', origin: 'test' })).toThrow(
    'object'
  );
  expect(() => parseVariables({ text: 'not json hunter2', format: 'json', origin: 'test' })).toThrow(
    /not valid JSON/
  );
});

test('failing command surfaces exit code and stderr but never stdout', async () => {
  const run = loadSecrets({
    type: 'command',
    argv: sh('echo SECRETOUT; echo boom >&2; exit 3'),
    format: 'json',
    timeoutMs: 5000,
  });
  await expect(run).rejects.toThrow('sh exited with code 3: boom');
  await expect(run).rejects.not.toThrow('SECRETOUT');
});

test('stderr in errors is capped', async () => {
  const run = loadSecrets({
    type: 'command',
    argv: sh('head -c 5000 /dev/zero | tr "\\0" x >&2; exit 1'),
    format: 'json',
    timeoutMs: 5000,
  });
  const error = await run.catch((e: unknown) => String(e));
  expect(error.length).toBeLessThan(700);
});

test('timeout kills a hung command', async () => {
  const started = Date.now();
  await expect(
    loadSecrets({ type: 'command', argv: ['sleep', '30'], format: 'json', timeoutMs: 200 })
  ).rejects.toThrow('timed out');
  expect(Date.now() - started).toBeLessThan(5000);
});

test('missing binary names the binary', async () => {
  await expect(
    loadSecrets({
      type: 'command',
      argv: ['l2b-no-such-binary'],
      format: 'json',
      timeoutMs: 5000,
    })
  ).rejects.toThrow('l2b-no-such-binary not found on PATH');
});

test('file sources expand ~ and read dotenv or json', async () => {
  const dir = mkdtempSync(join(homedir(), '.l2b-test-'));
  try {
    writeFileSync(join(dir, 'a.env'), 'A=1\nexport B=2\n');
    writeFileSync(join(dir, 'a.json'), '{"C":"3"}');
    const rel = `~/${dir.slice(homedir().length + 1)}`;
    expect(await loadSecrets({ type: 'file', path: `${rel}/a.env`, format: 'dotenv' })).toEqual({
      A: '1',
      B: '2',
    });
    expect(await loadSecrets({ type: 'file', path: `${rel}/a.json`, format: 'json' })).toEqual({
      C: '3',
    });
    expect(await resolveValue({ from: 'file', path: `${rel}/a.json` })).toBe('{"C":"3"}');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing secrets file is a clear error', async () => {
  await expect(
    loadSecrets({ type: 'file', path: '/nonexistent/l2b.env', format: 'dotenv' })
  ).rejects.toThrow('/nonexistent/l2b.env');
});

test('command value refs trim one trailing newline and reject empty output', async () => {
  expect(
    await resolveValue({ from: 'command', argv: ['printf', 'tok\n\n'], timeoutMs: 5000 })
  ).toBe('tok\n');
  expect(await resolveValue({ from: 'command', argv: ['printf', 'tok\n'], timeoutMs: 5000 })).toBe(
    'tok'
  );
  await expect(
    resolveValue({ from: 'command', argv: ['printf', '\n'], timeoutMs: 5000 })
  ).rejects.toThrow('empty');
});

test('file value refs trim one trailing newline and reject empty files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l2b-'));
  try {
    writeFileSync(join(dir, 'tok'), 'abc\n');
    writeFileSync(join(dir, 'empty'), '\n');
    expect(await resolveValue({ from: 'file', path: join(dir, 'tok') })).toBe('abc');
    await expect(resolveValue({ from: 'file', path: join(dir, 'empty') })).rejects.toThrow('empty');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('existing env and doppler configs still parse; new kinds apply defaults', () => {
  expect(secretSourceSchema.parse({ type: 'doppler', project: 'p', config: 'c' })).toEqual({
    type: 'doppler',
    project: 'p',
    config: 'c',
  });
  expect(secretSourceSchema.parse({ type: 'env', names: ['A'] })).toEqual({
    type: 'env',
    names: ['A'],
  });
  expect(valueRefSchema.parse({ from: 'doppler', project: 'p', config: 'c', name: 'N' })).toEqual({
    from: 'doppler',
    project: 'p',
    config: 'c',
    name: 'N',
  });
  expect(valueRefSchema.parse({ from: 'env', name: 'N' })).toEqual({ from: 'env', name: 'N' });
  expect(secretSourceSchema.parse({ type: 'command', argv: ['x'], format: 'json' })).toEqual({
    type: 'command',
    argv: ['x'],
    format: 'json',
    timeoutMs: 30000,
  });
  expect(() => secretSourceSchema.parse({ type: 'command', argv: [], format: 'json' })).toThrow();
});

test('doppler preset builds the documented argv', () => {
  expect(dopplerArgv({ project: 'p', config: 'c' })).toEqual([
    'doppler', 'secrets', 'download', '--no-file', '--format', 'json',
    '--project', 'p', '--config', 'c',
  ]);
});

test('firstOf returns the first ref that resolves, in order', async () => {
  process.env.L2B_TEST_FIRST = '';
  process.env.L2B_TEST_SECOND = 'two';
  process.env.L2B_TEST_THIRD = 'three';
  try {
    const ref = valueRefSchema.parse({
      from: 'firstOf',
      refs: [
        { from: 'env', name: 'L2B_TEST_MISSING' },
        { from: 'env', name: 'L2B_TEST_FIRST' },
        { from: 'env', name: 'L2B_TEST_SECOND' },
        { from: 'env', name: 'L2B_TEST_THIRD' },
      ],
    });
    expect(await resolveValue(ref)).toBe('two');
  } finally {
    delete process.env.L2B_TEST_FIRST;
    delete process.env.L2B_TEST_SECOND;
    delete process.env.L2B_TEST_THIRD;
  }
});

test('firstOf falls through failing commands and nests', async () => {
  const ref = valueRefSchema.parse({
    from: 'firstOf',
    refs: [
      { from: 'command', argv: ['false'] },
      { from: 'firstOf', refs: [{ from: 'command', argv: ['printf', 'tok\n'] }] },
    ],
  });
  expect(await resolveValue(ref)).toBe('tok');
});

test('firstOf with nothing resolving lists what was tried and never a value', async () => {
  process.env.L2B_TEST_EMPTY = '';
  try {
    const error = await resolveValue({
      from: 'firstOf',
      refs: [
        { from: 'env', name: 'L2B_TEST_EMPTY' },
        { from: 'command', argv: ['sh', '-c', 'echo leaked-stdout; echo oops >&2; exit 3'], timeoutMs: 5000 },
      ],
    }).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e))
    );
    expect(error).toContain('L2B_TEST_EMPTY');
    expect(error).toContain('sh');
    expect(error).not.toContain('leaked-stdout');
  } finally {
    delete process.env.L2B_TEST_EMPTY;
  }
});

test('firstOf needs at least one ref', () => {
  expect(() => valueRefSchema.parse({ from: 'firstOf', refs: [] })).toThrow();
});
