import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Command } from '../context';

const SKILL_SOURCE = resolve(import.meta.dir, '../../skills/l2b');
const SKILL_HOMES = ['.agents/skills', '.claude/skills'];

function link({ target }: { target: string }) {
  if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
    const stat = lstatSync(target);
    if (!stat.isSymbolicLink()) {
      throw new Error(`${target} exists and is not a symlink; move it aside first`);
    }
    if (readlinkSync(target) === SKILL_SOURCE) return 'already linked';
    rmSync(target);
  }
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(SKILL_SOURCE, target);
  return 'linked';
}

export const installSkill: Command = async () => {
  for (const home of SKILL_HOMES) {
    const target = join(homedir(), home, 'l2b');
    console.log(`${target}: ${link({ target })}`);
  }
};
