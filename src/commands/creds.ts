import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { COMMAND_HELP } from '../help';
import type { Command } from '../context';
import { resolveCredentials } from '../credentials';
import { connectBox } from '../find-box';
import { resolveTarget } from '../target';

export const creds: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { doppler: { type: 'string' }, repo: { type: 'string' } },
  });
  const name = requirePositional({ positionals, index: 0, usage: COMMAND_HELP.creds.usage });
  const target = await resolveTarget({ ctx, repo: values.repo ?? null });
  const credentials = await resolveCredentials({
    config: target.ctx.config,
    repo: target.repo,
    doppler: values.doppler ?? null,
  });
  await (await connectBox({ ctx, name })).refreshCredentials({ credentials });
  console.log('credentials refreshed');
};
