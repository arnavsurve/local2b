#!/usr/bin/env bun
import { touchConnectedBoxes } from './box-records';
import { commands } from './commands';
import { createContext } from './context';
import { commandHelp, isCommandName, rootHelp, wantsHelp } from './help';
import { extractProviderFlag } from './providers/select';
import { CommandFailedError } from './providers/types';
import { VERSION } from './version';

async function main() {
  const { providerId, args: argv } = extractProviderFlag({ args: process.argv.slice(2) });
  const [name, ...args] = argv;
  if (!name || name === '--help' || name === '-h') {
    console.log(rootHelp());
    return;
  }
  if (name === '--version' || name === '-v') {
    console.log(VERSION);
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
  try {
    await commands[name]({ ctx: await createContext({ flag: providerId }), args });
  } finally {
    await touchConnectedBoxes({ at: new Date() });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = err instanceof CommandFailedError ? err.exitCode : 1;
});
