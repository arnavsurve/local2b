import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import type { Command } from '../context';
import { pushCreds } from '../session';
import { secretSourcesFor } from '../sources';

export const creds: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { doppler: { type: 'string' } },
  });
  const name = requirePositional({ positionals, index: 0, usage: 'l2b creds <name>' });
  await pushCreds({
    box: await ctx.provider.connect({ name }),
    sources: secretSourcesFor({ ctx, doppler: values.doppler ?? null }),
  });
  console.log('credentials refreshed');
};
