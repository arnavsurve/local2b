import { parseArgs } from 'node:util';
import { joinCommand, requirePositional, splitOnDoubleDash } from '../args';
import type { Command } from '../context';
import { run } from '../session';

const USAGE = 'l2b exec <name> [--cwd dir] -- <cmd...>  (default cwd: the repo checkout)';

export const exec: Command = async ({ ctx, args }) => {
  const { head, tail } = splitOnDoubleDash(args);
  const { values, positionals } = parseArgs({
    args: head,
    allowPositionals: true,
    options: { cwd: { type: 'string' } },
  });
  const name = requirePositional({ positionals, index: 0, usage: USAGE });
  if (tail.length === 0) throw new Error(`usage: ${USAGE}`);

  const box = await ctx.provider.connect({ name });
  const exitCode = await run({
    box,
    cwd: values.cwd ?? box.workdir,
    cmd: joinCommand(tail),
  });
  process.exitCode = exitCode;
};
