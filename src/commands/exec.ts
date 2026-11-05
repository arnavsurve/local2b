import { parseArgs } from 'node:util';
import { joinCommand, requirePositional, splitOnDoubleDash } from '../args';
import type { Command } from '../context';
import { connectBox } from '../find-box';
import { COMMAND_HELP, usageError } from '../help';
import { startJob } from '../jobs';
import { toProcess } from '../start';

export const exec: Command = async ({ ctx, args }) => {
  const { head, tail } = splitOnDoubleDash(args);
  const { values, positionals } = parseArgs({
    args: head,
    allowPositionals: true,
    options: { cwd: { type: 'string' }, detach: { type: 'boolean' } },
  });
  const name = requirePositional({ positionals, index: 0, usage: COMMAND_HELP.exec.usage });
  if (tail.length === 0) throw usageError('exec');

  const box = await connectBox({ ctx, name });
  if (values.detach) {
    const id = await startJob({ box, cwd: values.cwd ?? null, cmd: joinCommand(tail) });
    console.log(id);
    console.error(`started; check with: l2b logs ${name} ${id}`);
    return;
  }
  process.exitCode = await box.exec({ cmd: joinCommand(tail), cwd: values.cwd ?? null, onOutput: toProcess });
};
