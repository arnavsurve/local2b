import { requirePositional } from '../args';
import type { Command } from '../context';
import { forgetBox } from '../box-records';
import { connectBox, findBoxProvider } from '../find-box';
import { COMMAND_HELP } from '../help';

export const pause: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: COMMAND_HELP.pause.usage });
  await (await connectBox({ ctx, name })).pause();
  console.log(`${name}: paused`);
};

export const down: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: COMMAND_HELP.down.usage });
  const provider = await findBoxProvider({ ctx, name });
  await (await provider.connect({ name })).destroy();
  await forgetBox({ provider: provider.id, name });
  console.log(`${name}: destroyed`);
};
