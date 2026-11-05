import { parseArgs } from 'node:util';
import { joinCommand, requirePositional, splitOnDoubleDash } from '../args';
import type { Command } from '../context';
import { connectBox } from '../find-box';
import { COMMAND_HELP, usageError } from '../help';
import { run } from '../session';

export const exec: Command = async ({ ctx, args }) => {
  const { head, tail } = splitOnDoubleDash(args);
  const { values, positionals } = parseArgs({
    args: head,
    allowPositionals: true,
    options: { cwd: { type: 'string' } },
  });
  const name = requirePositional({ positionals, index: 0, usage: COMMAND_HELP.exec.usage });
  if (tail.length === 0) throw usageError('exec');

  const box = await connectBox({ ctx, name });
  const exitCode = await run({
    box,
    cwd: values.cwd ?? box.workdir,
    cmd: joinCommand(tail),
  });
  process.exitCode = exitCode;
};
