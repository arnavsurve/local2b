import { readFileSync, statSync } from 'node:fs';
import type { Box } from './providers/types';
import { CommandFailedError } from './session';
import { parentDir, shellQuote } from './shell';

/** Relative paths resolve against the box workdir; `~/` against the home directory. */
export function remotePath({ box, path }: { box: Pick<Box, 'workdir' | 'homeDir'>; path: string }) {
  if (path.startsWith('/')) return path;
  if (path.startsWith('~/')) return `${box.homeDir}/${path.slice(2)}`;
  return `${box.workdir}/${path}`;
}

async function plainExec({ box, cmd }: { box: Box; cmd: string }) {
  const exitCode = await box.exec({
    cmd,
    cwd: '/',
    onOutput: ({ data }) => {
      process.stderr.write(data);
    },
  });
  if (exitCode !== 0) throw new CommandFailedError(cmd, exitCode);
}

export async function putContent({
  box,
  content,
  executable,
  remote,
}: {
  box: Box;
  content: string;
  executable: boolean;
  remote: string;
}) {
  const path = remotePath({ box, path: remote });
  const dir = parentDir(path) || '/';
  // An existing file in a sticky world-writable dir (/tmp, /dev/shm) can't be
  // reopened for writing by the provider's file API under fs.protected_regular,
  // even when the box user owns it; a fresh file can be created.
  await plainExec({ box, cmd: `mkdir -p ${shellQuote(dir)} && rm -f ${shellQuote(path)}` });
  await box.writeFile({ path, content });
  if (executable) await plainExec({ box, cmd: `chmod +x ${shellQuote(path)}` });
  return path;
}

export function decodeText({ bytes, what }: { bytes: Uint8Array; what: string }) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${what} is not valid UTF-8; put only sends text files`);
  }
}

export async function putLocalFile({ box, localPath, remote }: { box: Box; localPath: string; remote: string }) {
  let bytes: Uint8Array;
  let executable: boolean;
  try {
    bytes = readFileSync(localPath);
    executable = (statSync(localPath).mode & 0o111) !== 0;
  } catch (err) {
    throw new Error(`cannot read ${localPath}: ${err instanceof Error ? err.message : err}`);
  }
  const content = decodeText({ bytes, what: localPath });
  return putContent({ box, content, executable, remote });
}
