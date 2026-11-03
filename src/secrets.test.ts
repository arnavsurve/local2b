import { expect, test } from 'bun:test';
import { $ } from 'bun';
import { loadSecrets, parseDopplerTarget, resolveValue, toEnvFile } from './secrets';

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
