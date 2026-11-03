import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { Command } from '../context';

const ROOT = resolve(import.meta.dir, '../..');
const SKILL_SOURCE = join(ROOT, 'skills/l2b');
const BIN_SOURCE = join(ROOT, 'src/cli.ts');
const SKILL_HOMES = ['.agents/skills', '.claude/skills'];
const BIN_DIR = join(homedir(), '.local', 'bin');

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

/** Puts `l2b` on the PATH and the agent skill where coding agents look for skills. */
export const install: Command = async () => {
  const bin = join(BIN_DIR, 'l2b');
  console.log(`${bin}: ${link({ source: BIN_SOURCE, target: bin })}`);
  if (!(process.env.PATH ?? '').split(delimiter).includes(BIN_DIR)) {
    console.log(`note: ${BIN_DIR} is not on your PATH; add it to use \`l2b\` directly`);
  }
  for (const home of SKILL_HOMES) {
    const target = join(homedir(), home, 'l2b');
    console.log(`${target}: ${link({ source: SKILL_SOURCE, target })}`);
  }
};
