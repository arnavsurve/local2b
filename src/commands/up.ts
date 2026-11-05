import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import { selectForRepo, type Command } from '../context';
import { provisionBox } from '../provision';

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
  const name = requirePositional({ positionals, index: 0, usage: 'l2b up <name>' });
  const ctx = selectForRepo({ ctx: base, repo: values.repo ?? null });
  const box = await provisionBox({
    ctx,
    opts: {
      name,
      repo: values.repo ?? null,
      branch: values.branch ?? null,
      full: values.full,
      install: values.install ?? null,
      doppler: values.doppler ?? null,
      image: values.image ?? null,
    },
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
