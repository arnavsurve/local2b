import { parseArgs } from 'node:util';
import { joinCommand, splitOnDoubleDash } from '../args';
import type { Command } from '../context';
import { generatedBoxName, runOnce } from '../run-once';

const USAGE =
  'l2b run [--repo owner/repo] [--branch b] [--keep] [--name n] -- <cmd...>';

/** One call for one-off work: box up, run, box gone. Exits with the command's exit code. */
export const run: Command = async ({ ctx, args }) => {
  const { head, tail } = splitOnDoubleDash(args);
  if (tail.length === 0) throw new Error(`usage: ${USAGE}`);
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
  const repo = values.repo ?? null;
  const name = values.name ?? generatedBoxName({ repo });

  process.exitCode = await runOnce({
    ctx,
    keep: values.keep,
    cmd: joinCommand(tail),
    label: tail.join(' '),
    opts: {
      name,
      repo,
      branch: values.branch ?? null,
      full: values.full,
      install: values.install ?? null,
      doppler: values.doppler ?? null,
      image: values.image ?? null,
    },
  });
  if (values.keep) console.error(`l2b: box kept: ${name} (l2b exec ${name} -- <cmd>, l2b down ${name})`);
};
