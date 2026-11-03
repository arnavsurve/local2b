import { parseArgs } from 'node:util';
import { requirePositional, splitOnDoubleDash } from '../args';
import type { Command } from '../context';
import { run } from '../session';
import { HOME, shellQuote } from '../shell';

const USAGE = 'l2b exec <name> [--cwd dir] -- <cmd...>';

export const exec: Command = async ({ ctx, args }) => {
  const { head, tail } = splitOnDoubleDash(args);
  const { values, positionals } = parseArgs({
    args: head,
    allowPositionals: true,
    options: { cwd: { type: 'string', default: HOME } },
  });
  const name = requirePositional({ positionals, index: 0, usage: USAGE });
  if (tail.length === 0) throw new Error(`usage: ${USAGE}`);

  const box = await ctx.provider.connect({ name });
  const exitCode = await run({
    box,
    cwd: values.cwd,
    cmd: tail.map(shellQuote).join(' '),
  });
  process.exitCode = exitCode;
};
