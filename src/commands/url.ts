import { requirePositional } from '../args';
import type { Command } from '../context';
import { connectBox } from '../find-box';
import { COMMAND_HELP } from '../help';

export const url: Command = async ({ ctx, args }) => {
  const usage = COMMAND_HELP.url.usage;
  const name = requirePositional({ positionals: args, index: 0, usage });
  const port = Number(requirePositional({ positionals: args, index: 1, usage }));
  if (!Number.isInteger(port)) throw new Error(`port must be a number, got "${args[1]}"`);
  const box = await connectBox({ ctx, name });
  const result = await box.url({ port });
  console.log(result.url);
  if (result.note) console.error(`l2b: ${result.note}`);
};
