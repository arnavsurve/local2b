import { lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { Command } from '../context';
import { COMPILED } from '../runtime';
import { SKILL_FILES } from '../skill-files';

const ROOT = resolve(import.meta.dir, '../..');
const SKILL_SOURCE = join(ROOT, 'skills/l2b');
const BIN_SOURCE = join(ROOT, 'src/cli.ts');
const SKILL_HOMES = ['.agents/skills', '.claude/skills'];

function link({ source, target }: { source: string; target: string }) {
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`${target} exists and is not a symlink; move it aside first`);
    }
    if (readlinkSync(target) === source) return 'already linked';
    rmSync(target);
  }
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target);
  return 'linked';
}

function readOrNull(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isL2bSkillDir(dir: string) {
  return /^---\n(?:.*\n)*?name: l2b\n/.test(readOrNull(join(dir, 'SKILL.md')) ?? '');
}

/** Writes the skill files into `target`, replacing a symlink or an older copy of the l2b skill. */
export function writeSkill({ target, files }: { target: string; files: Record<string, string> }) {
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    rmSync(target);
  } else if (existing) {
    if (!existing.isDirectory() || !isL2bSkillDir(target)) {
      throw new Error(`${target} exists and is not the l2b skill; move it aside first`);
    }
    if (Object.entries(files).every(([name, content]) => readOrNull(join(target, name)) === content)) {
      return 'up to date';
    }
    rmSync(target, { recursive: true });
  }
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(target, name)), { recursive: true });
    writeFileSync(join(target, name), content);
  }
  return existing ? 'updated' : 'written';
}

function pathNote(dir: string) {
  if ((process.env.PATH ?? '').split(delimiter).includes(dir)) return;
  console.log(`note: ${dir} is not on your PATH; add it to use \`l2b\` directly`);
}

/** Puts the agent skill where coding agents look for skills, and `l2b` on the PATH when running from a checkout. */
export function installInto({ home, compiled }: { home: string; compiled: boolean }) {
  if (compiled) {
    console.log(`binary: ${process.execPath}`);
    pathNote(dirname(process.execPath));
  } else {
    const binDir = join(home, '.local', 'bin');
    const bin = join(binDir, 'l2b');
    console.log(`${bin}: ${link({ source: BIN_SOURCE, target: bin })}`);
    pathNote(binDir);
  }
  for (const skillHome of SKILL_HOMES) {
    const target = join(home, skillHome, 'l2b');
    const result = compiled ? writeSkill({ target, files: SKILL_FILES }) : link({ source: SKILL_SOURCE, target });
    console.log(`${target}: ${result}`);
  }
}

export const install: Command = async () => {
  installInto({ home: homedir(), compiled: COMPILED });
};
