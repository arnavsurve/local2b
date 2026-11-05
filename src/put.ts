import { readFileSync, statSync } from 'node:fs';
import type { Box } from './providers/types';

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
  return box.put({ path: remote, content, executable });
}
