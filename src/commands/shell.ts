import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import type { Command } from '../context';
import { COMMAND_HELP } from '../help';
import { connectBox } from '../find-box';
import type { Terminal } from '../providers/types';

const size = () => ({ cols: process.stdout.columns, rows: process.stdout.rows });

/** This process's TTY, handed to the provider's `attach`. */
const processTerminal: Terminal = {
  size,
  onInput(listener) {
    const handler = (chunk: Buffer) => listener(new Uint8Array(chunk));
    process.stdin.on('data', handler);
    return () => process.stdin.off('data', handler);
  },
  onResize(listener) {
    const handler = () => listener(size());
    process.stdout.on('resize', handler);
    return () => process.stdout.off('resize', handler);
  },
  write(data) {
    process.stdout.write(data);
  },
};

/** Interactive terminal in the box. Needs a real TTY on both stdin and stdout. */
export const shell: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { cwd: { type: 'string' } },
  });
  const name = requirePositional({
    positionals,
    index: 0,
    usage: COMMAND_HELP.shell.usage,
  });
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('l2b shell needs an interactive terminal; use `l2b exec` from scripts and agents');
  }

  const box = await connectBox({ ctx, name });
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    const exitCode = await box.attach({ terminal: processTerminal, cwd: values.cwd ?? null });
    if (exitCode !== null) process.exitCode = exitCode;
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
};
