import { mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** A path under `$XDG_STATE_HOME/l2b` (default `~/.local/state/l2b`), where l2b keeps its local records. */
export function statePath(...parts: string[]) {
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(stateHome, 'l2b', ...parts);
}

/** Replaces `path` in one rename, so a concurrent reader sees the old content or the new, never a partial file. */
export async function writeJsonAtomic({ path, value }: { path: string; value: unknown }) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await Bun.write(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}

/** A file-name-safe form of `provider` and `owner/name`. */
export function stateSlug({ provider, repo }: { provider: string; repo: string }) {
  return `${provider}-${repo}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
