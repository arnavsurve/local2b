import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SKILL_FILES } from '../skill-files';
import { installInto, writeSkill } from './install';

const ROOT = resolve(import.meta.dir, '../..');
const SKILL_TARGETS = ['.agents/skills/l2b', '.claude/skills/l2b'];
let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'l2b-install-home-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

test('the embedded skill matches skills/l2b on disk', () => {
  expect(SKILL_FILES['SKILL.md']).toBe(readFileSync(join(ROOT, 'skills/l2b/SKILL.md'), 'utf8'));
});

test('from source, install links the checkout into a fresh HOME', async () => {
  const proc = Bun.spawn(['bun', join(ROOT, 'src/cli.ts'), 'install'], {
    env: { ...process.env, HOME: home },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await proc.exited).toBe(0);
  expect(readlinkSync(join(home, '.local/bin/l2b'))).toBe(join(ROOT, 'src/cli.ts'));
  for (const target of SKILL_TARGETS) expect(readlinkSync(join(home, target))).toBe(join(ROOT, 'skills/l2b'));
});

test('compiled, install writes the skill files and places no binary', () => {
  installInto({ home, compiled: true });
  for (const target of SKILL_TARGETS) {
    const dir = join(home, target);
    expect(lstatSync(dir).isDirectory()).toBe(true);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(SKILL_FILES['SKILL.md']!);
  }
  expect(existsSync(join(home, '.local/bin/l2b'))).toBe(false);
});

test('compiled, install replaces a symlink and an older copy, and is idempotent', () => {
  const linked = join(home, SKILL_TARGETS[0]!);
  mkdirSync(join(linked, '..'), { recursive: true });
  symlinkSync(join(ROOT, 'skills/l2b'), linked);
  const older = join(home, SKILL_TARGETS[1]!);
  mkdirSync(older, { recursive: true });
  writeFileSync(join(older, 'SKILL.md'), '---\nname: l2b\ndescription: old\n---\nold body\n');
  writeFileSync(join(older, 'stale.md'), 'stale');

  installInto({ home, compiled: true });
  for (const target of SKILL_TARGETS) {
    const dir = join(home, target);
    expect(lstatSync(dir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(SKILL_FILES['SKILL.md']!);
  }
  expect(existsSync(join(older, 'stale.md'))).toBe(false);
  expect(writeSkill({ target: older, files: SKILL_FILES })).toBe('up to date');
});

test('compiled, install refuses to clobber a directory that is not the l2b skill', () => {
  const other = join(home, SKILL_TARGETS[0]!);
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'SKILL.md'), '---\nname: something-else\n---\n');
  expect(() => installInto({ home, compiled: true })).toThrow('is not the l2b skill');
  expect(readFileSync(join(other, 'SKILL.md'), 'utf8')).toContain('something-else');
});
