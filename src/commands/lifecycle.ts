import { requirePositional } from '../args';
import type { Command } from '../context';

export const pause: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: 'l2b pause <name>' });
  await (await ctx.provider.connect({ name })).pause();
  console.log(`${name}: paused`);
};

export const down: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: 'l2b down <name>' });
  await (await ctx.provider.connect({ name })).destroy();
  console.log(`${name}: destroyed`);
};
