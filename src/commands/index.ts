import type { Command } from '../context';
import type { CommandName } from '../help';
import { bake } from './bake';
import { bakes } from './bakes';
import { creds } from './creds';
import { exec } from './exec';
import { down, pause } from './lifecycle';
import { jobs, logs } from './jobs';
import { image } from './image';
import { ls } from './ls';
import { put } from './put';
import { run } from './run';
import { shell } from './shell';
import { init } from './init';
import { install } from './install';
import { up } from './up';
import { update } from './update';
import { url } from './url';

/** Every l2b command by name. */
export const commands: Record<CommandName, Command> = {
  run,
  up,
  image,
  bake,
  bakes,
  init,
  exec,
  logs,
  jobs,
  put,
  shell,
  install,
  update,
  creds,
  url,
  ls,
  pause,
  down,
};
