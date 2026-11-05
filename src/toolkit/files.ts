import { CommandFailedError } from './session';
import type { Machine } from './machine';
import { parentDir, shellQuote } from '../shell';

/** Relative paths resolve against the machine workdir; `~/` against the home directory. */
export function remotePath({ box, path }: { box: Pick<Machine, 'workdir' | 'homeDir'>; path: string }) {
  if (path.startsWith('/')) return path;
  if (path.startsWith('~/')) return `${box.homeDir}/${path.slice(2)}`;
  return `${box.workdir}/${path}`;
}

async function plainExec({ box, cmd }: { box: Machine; cmd: string }) {
  const exitCode = await box.exec({
    cmd,
    cwd: '/',
    onOutput: ({ data }) => {
      process.stderr.write(data);
    },
  });
  if (exitCode !== 0) throw new CommandFailedError(cmd, exitCode);
}

/** Writes a text file through the machine's file API and resolves with its absolute path. */
export async function putFile({
  box,
  path: requested,
  content,
  executable,
}: {
  box: Machine;
  path: string;
  content: string;
  executable: boolean;
}) {
  const path = remotePath({ box, path: requested });
  const dir = parentDir(path) || '/';
  // An existing file in a sticky world-writable dir (/tmp, /dev/shm) can't be
  // reopened for writing by the provider's file API under fs.protected_regular,
  // even when the box user owns it; a fresh file can be created.
  await plainExec({ box, cmd: `mkdir -p ${shellQuote(dir)} && rm -f ${shellQuote(path)}` });
  await box.writeFile({ path, content });
  if (executable) await plainExec({ box, cmd: `chmod +x ${shellQuote(path)}` });
  return path;
}
