import { parseArgs } from 'node:util';
import { recordBoxStart } from '../box-records';
import { joinCommand, splitOnDoubleDash } from '../args';
import type { Command } from '../context';
import { usageError } from '../help';
import { hintOnExit, warnIfUnconfigured } from '../hints';
import { generatedBoxName, runOnce } from '../run-once';
import { startOptsFor, toProcess, warnIfStale } from '../start';
import { branchFor, resolveTarget } from '../target';

/** One call for one-off work: box up, run, box gone. Exits with the command's exit code. */
export const run: Command = async ({ ctx: base, args }) => {
  const { head, tail } = splitOnDoubleDash(args);
  if (tail.length === 0) throw usageError('run');
  const { values } = parseArgs({
    args: head,
    options: {
      repo: { type: 'string' },
      branch: { type: 'string' },
      name: { type: 'string' },
      keep: { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
      doppler: { type: 'string' },
      image: { type: 'string' },
      install: { type: 'string' },
    },
  });
  const target = await resolveTarget({ ctx: base, repo: values.repo ?? null });
  const { ctx, repo } = target;
  const branch = branchFor({ target, flag: values.branch ?? null });
  const name = values.name ?? generatedBoxName({ repo });
  const start = await startOptsFor({
    ctx,
    name,
    repo,
    branch,
    source: values.full ? 'fresh' : 'bake',
    install: values.install ?? null,
    doppler: values.doppler ?? null,
    image: values.image ?? null,
  });
  warnIfUnconfigured({ target, repo: start.repo });
  await warnIfStale({ ctx, start });

  const exitCode = await runOnce({
    provider: ctx.provider,
    start,
    cmd: joinCommand(tail),
    label: tail.join(' '),
    after: values.keep ? 'keep' : 'destroy',
    onOutput: toProcess,
  });
  process.exitCode = exitCode;
  hintOnExit({ exitCode });
  if (!values.keep) return;
  await recordBoxStart({
    provider: ctx.provider.id,
    name,
    repo,
    branch,
    idleMinutes: ctx.config.idle.minutes,
    at: new Date(),
  });
  console.error(`l2b: box kept: ${name} (l2b exec ${name} -- <cmd>, l2b down ${name})`);
};
