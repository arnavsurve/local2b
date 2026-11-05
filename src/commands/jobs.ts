import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import type { Command } from '../context';
import { connectBox } from '../find-box';
import { COMMAND_HELP } from '../help';
import { followLog, jobStatus, listJobs, readLog } from '../jobs';

const formatState = (s: { state: 'running' } | { state: 'exited'; exitCode: number }) =>
  s.state === 'running' ? 'running' : `exited ${s.exitCode}`;

export const logs: Command = async ({ ctx, args }) => {
  const usage = COMMAND_HELP.logs.usage;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { follow: { type: 'boolean', short: 'f' } },
  });
  const name = requirePositional({ positionals, index: 0, usage });
  const id = requirePositional({ positionals, index: 1, usage });
  const box = await connectBox({ ctx, name });
  if (values.follow) {
    process.exitCode = await followLog({ box, id });
    return;
  }
  process.stdout.write(await readLog({ box, id }));
  console.error(`[l2b] job ${id}: ${formatState(await jobStatus({ box, id }))}`);
};

export const jobs: Command = async ({ ctx, args }) => {
  const name = requirePositional({ positionals: args, index: 0, usage: COMMAND_HELP.jobs.usage });
  const box = await connectBox({ ctx, name });
  for (const job of await listJobs({ box })) console.log(`${job.id}\t${formatState(job)}\t${job.cmd}`);
};
