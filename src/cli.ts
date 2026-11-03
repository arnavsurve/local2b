#!/usr/bin/env bun
import { bake } from './commands/bake';
import { creds } from './commands/creds';
import { exec } from './commands/exec';
import { down, pause } from './commands/lifecycle';
import { image } from './commands/image';
import { ls } from './commands/ls';
import { shell } from './commands/shell';
import { installSkill } from './commands/install-skill';
import { up } from './commands/up';
import { url } from './commands/url';
import { createContext, type Command } from './context';
import { CommandFailedError } from './session';

const USAGE = `l2b - remote dev sandboxes on e2b

  l2b up <name> [--repo owner/repo] [--branch b] [--full] [--doppler project/config] [--image ref]
  l2b bake <owner/repo>                        build the per-repo snapshot (bare mirror + warm install)
  l2b exec <name> [--cwd dir] -- <cmd...>      run a command (secrets sourced)
  l2b creds <name> [--doppler project/config]  refresh GH token + doppler secrets
  l2b shell <name> [--cwd dir]                 interactive terminal (needs a TTY)
  l2b install-skill                            link the agent skill into ~/.agents/skills and ~/.claude/skills
  l2b url <name> <port>                        public URL for a port
  l2b image build                              build the base image for the configured provider
  l2b ls
  l2b pause <name>
  l2b down <name>
`;

const commands: Record<string, Command> = {
  up,
  image,
  bake,
  exec,
  shell,
  'install-skill': installSkill,
  creds,
  url,
  ls,
  pause,
  down,
};

async function main() {
  const [name, ...args] = process.argv.slice(2);
  const handler = name ? commands[name] : undefined;
  if (!handler) {
    console.log(USAGE);
    process.exitCode = name ? 1 : 0;
    return;
  }
  await handler({ ctx: await createContext(), args });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = err instanceof CommandFailedError ? err.exitCode : 1;
});
