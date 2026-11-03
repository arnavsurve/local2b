import { requirePositional } from '../args';
import type { Command } from '../context';

export const url: Command = async ({ ctx, args }) => {
  const usage = 'l2b url <name> <port>';
  const name = requirePositional({ positionals: args, index: 0, usage });
  const port = Number(requirePositional({ positionals: args, index: 1, usage }));
  if (!Number.isInteger(port)) throw new Error(`port must be a number, got "${args[1]}"`);
  const box = await ctx.provider.connect({ name });
  console.log(box.publicUrl({ port }));
};
