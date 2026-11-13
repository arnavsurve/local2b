import { parseArgs } from 'node:util';
import { recordBoxStart } from '../box-records';
import { requirePositional } from '../args';
import { keepBakeCurrent } from '../auto-bake';
import type { Command } from '../context';
import { COMMAND_HELP } from '../help';
import { warnIfUnconfigured } from '../hints';
import { startOptsFor } from '../start';
import { branchFor, resolveTarget } from '../target';

export const up: Command = async ({ ctx: base, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      branch: { type: 'string' },
      full: { type: 'boolean', default: false },
      doppler: { type: 'string' },
      image: { type: 'string' },
      install: { type: 'string' },
    },
  });
  const name = requirePositional({ positionals, index: 0, usage: COMMAND_HELP.up.usage });
  const target = await resolveTarget({ ctx: base, repo: values.repo ?? null });
  const { ctx, repo } = target;
  const branch = branchFor({ target, flag: values.branch ?? null });
  const requested = await startOptsFor({
    ctx,
    name,
    repo,
    branch,
    source: values.full ? 'fresh' : 'bake',
    install: values.install ?? null,
    doppler: values.doppler ?? null,
    image: values.image ?? null,
  });
  warnIfUnconfigured({ target, repo: requested.repo });
  const start = await keepBakeCurrent({ ctx, start: requested, doppler: values.doppler ?? null });
  const box = await ctx.provider.start(start);
  await recordBoxStart({
    provider: ctx.provider.id,
    name,
    repo,
    branch,
    idleMinutes: ctx.config.idle.minutes,
    at: new Date(),
  });
  console.log(
    [
      `${name} ready`,
      `workdir: ${box.workdir}`,
      `run:     l2b exec ${name} -- <command>`,
      `stop:    l2b down ${name}  (it also expires after ${ctx.config.idle.minutes} min idle)`,
    ].join('\n')
  );
};
