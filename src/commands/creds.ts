import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { hostFor } from '../git-host';
import { COMMAND_HELP } from '../help';
import type { Command } from '../context';
import { connectBox } from '../find-box';
import { pushCreds } from '../session';
import { secretSourcesFor } from '../sources';

export const creds: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { doppler: { type: 'string' }, repo: { type: 'string' } },
  });
  const name = requirePositional({ positionals, index: 0, usage: COMMAND_HELP.creds.usage });
  await pushCreds({
    host: hostFor({ config: ctx.config, repo: values.repo ?? null }),
    box: await connectBox({ ctx, name }),
    sources: secretSourcesFor({ ctx, doppler: values.doppler ?? null }),
  });
  console.log('credentials refreshed');
};
