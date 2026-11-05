import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { COMMAND_HELP } from '../help';
import type { Command } from '../context';
import { resolveCredentials } from '../credentials';
import { connectBox } from '../find-box';

export const creds: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { doppler: { type: 'string' }, repo: { type: 'string' } },
  });
  const name = requirePositional({ positionals, index: 0, usage: COMMAND_HELP.creds.usage });
  const credentials = await resolveCredentials({
    config: ctx.config,
    repo: values.repo ?? null,
    doppler: values.doppler ?? null,
  });
  await (await connectBox({ ctx, name })).refreshCredentials({ credentials });
  console.log('credentials refreshed');
};
