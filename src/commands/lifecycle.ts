import { requirePositional } from '../args';
import type { Command } from '../context';
import { connectBox } from '../find-box';
import { COMMAND_HELP } from '../help';

export const pause: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: COMMAND_HELP.pause.usage });
  await (await connectBox({ ctx, name })).pause();
  console.log(`${name}: paused`);
};

export const down: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: COMMAND_HELP.down.usage });
  await (await connectBox({ ctx, name })).destroy();
  console.log(`${name}: destroyed`);
};
