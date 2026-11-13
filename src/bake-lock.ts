import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { statePath, stateSlug, writeJsonAtomic } from './state';

const lockSchema = z.object({
  pid: z.number(),
  token: z.string(),
  startedAt: z.iso.datetime(),
  log: z.string().nullable(),
});

/** Who holds a bake lock: the bake's process, and the log it writes to when it runs in the background. */
export type BakeLock = z.infer<typeof lockSchema>;

type Target = { provider: string; repo: string };

const lockPath = (target: Target) => statePath('locks', `bake-${stateSlug(target)}.json`);

function isAlive({ pid }: { pid: number }) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && 'code' in err && err.code === 'EPERM';
  }
}

function readLock({ path }: { path: string }) {
  try {
    const parsed = lockSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Creates the lock file only if none exists; the `wx` open is the atomic step two agents race on. */
function create({ path, lock }: { path: string; lock: BakeLock }) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(path, 'wx');
    writeFileSync(fd, JSON.stringify(lock));
    closeSync(fd);
    return true;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') return false;
    throw err;
  }
}

/**
 * Moves a dead holder's lock aside. Only one racer's rename succeeds; if what
 * it moved is not the lock it judged dead (another agent took over in
 * between), it puts that lock back.
 */
function clearStale({ path, stale }: { path: string; stale: BakeLock | null }) {
  const aside = `${path}.stale-${randomBytes(4).toString('hex')}`;
  try {
    renameSync(path, aside);
  } catch {
    return;
  }
  const moved = readLock({ path: aside });
  if (moved && stale && moved.token !== stale.token) {
    try {
      linkSync(aside, path);
    } catch {
      // Someone created a fresh lock meanwhile; theirs wins.
    }
  }
  unlinkSync(aside);
}

/**
 * Takes the per provider+repo bake lock for `pid`. A lock whose process has
 * died is taken over. Resolves with the token that releases or transfers the
 * lock, or with the live holder.
 */
export async function acquireBakeLock({
  provider,
  repo,
  pid,
  log,
}: Target & { pid: number; log: string | null }): Promise<
  { acquired: true; token: string } | { acquired: false; holder: BakeLock }
> {
  const path = lockPath({ provider, repo });
  const lock = { pid, token: randomBytes(8).toString('hex'), startedAt: new Date().toISOString(), log };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (create({ path, lock })) return { acquired: true, token: lock.token };
    const holder = readLock({ path });
    if (holder && isAlive({ pid: holder.pid })) return { acquired: false, holder };
    clearStale({ path, stale: holder });
  }
  const holder = readLock({ path });
  if (holder) return { acquired: false, holder };
  throw new Error(`could not take the bake lock at ${path}`);
}

/** The live holder of the lock, or null when it is free or its holder has died. */
export async function bakeLockHolder(target: Target) {
  const holder = readLock({ path: lockPath(target) });
  return holder && isAlive({ pid: holder.pid }) ? holder : null;
}

/** Hands a held lock to another process, such as a detached bake this process started. */
export async function transferBakeLock({ token, pid, ...target }: Target & { token: string; pid: number }) {
  const path = lockPath(target);
  const current = readLock({ path });
  if (current?.token !== token) return;
  await writeJsonAtomic({ path, value: { ...current, pid } });
}

/** Frees the lock if `token` still holds it. */
export async function releaseBakeLock({ token, ...target }: Target & { token: string }) {
  const path = lockPath(target);
  if (readLock({ path })?.token !== token) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}
