import { requirePositional } from '../args';
import type { Command } from '../context';
import { requirePause } from '../capabilities';
import { connectBox, findBoxProvider } from '../find-box';

export const pause: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: 'l2b pause <name>' });
  const provider = await findBoxProvider({ ctx, name });
  requirePause({ provider, name });
  await (await provider.connect({ name })).pause();
  console.log(`${name}: paused`);
};

export const down: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: 'l2b down <name>' });
  await (await connectBox({ ctx, name })).destroy();
  console.log(`${name}: destroyed`);
};
