import type { Command } from '../context';
import { usageError } from '../help';

export const image: Command = async ({ ctx, args }) => {
  if (args[0] !== 'build') throw usageError('image');
  console.log(await ctx.provider.prepare());
};
