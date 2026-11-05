import type { Command } from '../context';
import { usageError } from '../help';

export const image: Command = async ({ ctx, args }) => {
  if (args[0] !== 'build') throw usageError('image');
  const ref = await ctx.provider.buildImage();
  console.log(`built image ${ref}`);
};
