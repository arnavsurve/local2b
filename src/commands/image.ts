import type { Command } from '../context';

export const image: Command = async ({ ctx, args }) => {
  if (args[0] !== 'build') throw new Error('usage: l2b image build');
  const ref = await ctx.provider.buildImage();
  console.log(`built image ${ref}`);
};
