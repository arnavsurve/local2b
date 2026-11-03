import type { Command } from '../context';

export const ls: Command = async ({ ctx }) => {
  for (const box of await ctx.provider.list()) {
    console.log([box.name, box.state, box.id, box.image].join('\t'));
  }
};
