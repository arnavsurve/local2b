import { parseArgs } from 'node:util';
import { requirePositional } from '../args';
import type { Command } from '../context';
import { ENV_FILE } from '../session';
import { HOME, shellQuote } from '../shell';

/** Interactive terminal in the box. Needs a real TTY on both stdin and stdout. */
export const shell: Command = async ({ ctx, args }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { cwd: { type: 'string', default: HOME } },
  });
  const name = requirePositional({
    positionals,
    index: 0,
    usage: 'l2b shell <name> [--cwd dir]',
  });
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('l2b shell needs an interactive terminal; use `l2b exec` from scripts and agents');
  }

  const box = await ctx.provider.connect({ name });
  const session = await box.shell({
    cols: process.stdout.columns,
    rows: process.stdout.rows,
    cwd: values.cwd,
    onData: (data) => {
      process.stdout.write(data);
    },
  });

  const onResize = () => {
    void session
      .resize({ cols: process.stdout.columns, rows: process.stdout.rows })
      .catch(() => {});
  };
  process.stdout.on('resize', onResize);
  process.stdin.setRawMode(true);
  process.stdin.on('data', (chunk: Buffer) => {
    void session.sendInput(new Uint8Array(chunk)).catch(() => {});
  });
  process.stdin.resume();

  const loadEnv = `[ -f ${shellQuote(ENV_FILE)} ] && . ${shellQuote(ENV_FILE)}; clear\n`;
  await session.sendInput(new TextEncoder().encode(loadEnv));

  try {
    process.exitCode = await session.wait();
  } finally {
    process.stdout.off('resize', onResize);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
};
