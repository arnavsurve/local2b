import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema, loadConfig, resolveClone } from './config';

const dirs: string[] = [];

function writeConfig(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'l2b-config-'));
  dirs.push(dir);
  const path = join(dir, 'config.json');
  Bun.write(path, content);
  process.env.L2B_CONFIG = path;
  return path;
}

afterEach(() => {
  delete process.env.L2B_CONFIG;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('a missing config file yields working defaults', async () => {
  process.env.L2B_CONFIG = '/nonexistent/l2b.json';
  const config = await loadConfig();
  expect(config.provider).toBe('e2b');
  expect(config.secrets).toEqual([]);
  expect(config.e2b.apiKey).toEqual({ from: 'env', name: 'E2B_API_KEY' });
});

test('user config overrides defaults and keeps the rest', async () => {
  writeConfig(
    JSON.stringify({
      e2b: {
        apiKey: { from: 'doppler', project: 'p', config: 'dev', name: 'E2B_API_KEY' },
        cpuCount: 8,
      },
      repos: { 'o/r': { install: 'yarn install' } },
    })
  );
  const config = await loadConfig();
  expect(config.e2b.cpuCount).toBe(8);
  expect(config.e2b.memoryMB).toBe(8192);
  expect(config.repos['o/r']?.install).toBe('yarn install');
});

test('an invalid config names the file and the bad field', async () => {
  const path = writeConfig(JSON.stringify({ provider: 'nope' }));
  await expect(loadConfig()).rejects.toThrow(path);
});

test('e2b image features default to everything and reject unknown names', async () => {
  process.env.L2B_CONFIG = '/nonexistent/l2b.json';
  const defaults = await loadConfig();
  expect(defaults.e2b.features).toEqual(['node', 'gh', 'doppler', 'docker', 'postgres', 'redis', 'ripgrep', 'tmux']);
  expect(defaults.e2b.nodeMajor).toBe(24);

  writeConfig(JSON.stringify({ e2b: { features: ['docker', 'mysql'] } }));
  await expect(loadConfig()).rejects.toThrow(/features/);
});

test('npm globals need the node feature', async () => {
  writeConfig(JSON.stringify({ e2b: { features: ['gh'], npmGlobals: ['bun'] } }));
  await expect(loadConfig()).rejects.toThrow(/node/);
});

test('a provider is configured when it has a block or is the default', async () => {
  writeConfig(JSON.stringify({}));
  expect((await loadConfig()).configuredProviders).toEqual(['e2b']);
  writeConfig(JSON.stringify({ e2b: { cpuCount: 2 } }));
  expect((await loadConfig()).configuredProviders).toEqual(['e2b']);
});

test('a repo can name its provider', async () => {
  writeConfig(JSON.stringify({ repos: { 'o/r': { provider: 'e2b' }, 'o/s': {} } }));
  const config = await loadConfig();
  expect(config.repos['o/r']?.provider).toBe('e2b');
  expect(config.repos['o/s']?.provider).toBeNull();
});

test('clone options default to today\'s mirror behaviour', () => {
  const config = configSchema.parse({});
  expect(resolveClone({ config, repo: 'o/r' })).toEqual({
    strategy: 'mirror',
    depth: 50,
    filter: 'blob:limit=50m',
  });
});

test('cloneDepth remains an alias for the global depth, and clone.depth wins', () => {
  const alias = configSchema.parse({ cloneDepth: 10 });
  expect(resolveClone({ config: alias, repo: 'o/r' }).depth).toBe(10);
  const both = configSchema.parse({ cloneDepth: 10, clone: { depth: 5 } });
  expect(resolveClone({ config: both, repo: 'o/r' }).depth).toBe(5);
});

test('per-repo clone overrides inherit unset fields and allow null', () => {
  const config = configSchema.parse({
    clone: { depth: 20, filter: 'blob:none' },
    repos: {
      'o/small': { clone: { strategy: 'plain', depth: null } },
      'o/nofilter': { clone: { filter: null } },
    },
  });
  expect(resolveClone({ config, repo: 'o/small' })).toEqual({
    strategy: 'plain',
    depth: null,
    filter: 'blob:none',
  });
  expect(resolveClone({ config, repo: 'o/nofilter' })).toEqual({
    strategy: 'mirror',
    depth: 20,
    filter: null,
  });
  expect(resolveClone({ config, repo: 'o/other' }).depth).toBe(20);
});

test('a filter that could smuggle shell is rejected', () => {
  expect(configSchema.safeParse({ clone: { filter: '; rm -rf /' } }).success).toBe(false);
  expect(configSchema.safeParse({ repos: { 'o/r': { clone: { filter: '$(id)' } } } }).success).toBe(false);
  expect(configSchema.safeParse({ clone: { filter: 'combine:blob:none+tree:0' } }).success).toBe(true);
});
