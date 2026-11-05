#!/usr/bin/env bun
import { bake } from './commands/bake';
import { creds } from './commands/creds';
import { exec } from './commands/exec';
import { down, pause } from './commands/lifecycle';
import { image } from './commands/image';
import { ls } from './commands/ls';
import { run } from './commands/run';
import { shell } from './commands/shell';
import { install } from './commands/install';
import { up } from './commands/up';
import { url } from './commands/url';
import { createContext, type Command } from './context';
import { commandHelp, isCommandName, rootHelp, wantsHelp, type CommandName } from './help';
import { extractProviderFlag } from './providers/select';
import { CommandFailedError } from './session';

const commands: Record<CommandName, Command> = {
  run,
  up,
  image,
  bake,
  exec,
  shell,
  install,
  creds,
  url,
  ls,
  pause,
  down,
};

async function main() {
  const { providerId, args: argv } = extractProviderFlag({ args: process.argv.slice(2) });
  const [name, ...args] = argv;
  if (!name || name === '--help' || name === '-h') {
    console.log(rootHelp());
    return;
  }
  if (!isCommandName(name)) {
    console.error(`l2b: unknown command '${name}'\n`);
    console.error(rootHelp());
    process.exitCode = 1;
    return;
  }
  if (wantsHelp({ args })) {
    console.log(commandHelp(name));
    return;
  }
  await commands[name]({ ctx: await createContext({ flag: providerId }), args });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = err instanceof CommandFailedError ? err.exitCode : 1;
});
