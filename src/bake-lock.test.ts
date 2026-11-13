import { afterEach, expect, test } from 'bun:test';
import { acquireBakeLock, bakeLockHolder, releaseBakeLock, transferBakeLock } from './bake-lock';

const target = { provider: 'p', repo: 'o/r' };
const sleepers: ReturnType<typeof Bun.spawn>[] = [];

afterEach(() => {
  for (const proc of sleepers.splice(0)) proc.kill();
});

/** A pid that belonged to a process which has exited. */
async function deadPid() {
  const proc = Bun.spawn(['true']);
  await proc.exited;
  return proc.pid;
}

function liveProcess() {
  const proc = Bun.spawn(['sleep', '30']);
  sleepers.push(proc);
  return proc.pid;
}

test('a lock held by a live process blocks a second acquire and names its holder', async () => {
  const first = await acquireBakeLock({ ...target, pid: process.pid, log: '/tmp/a.log' });
  expect(first.acquired).toBe(true);
  const second = await acquireBakeLock({ ...target, pid: process.pid, log: null });
  expect(second).toMatchObject({ acquired: false, holder: { pid: process.pid, log: '/tmp/a.log' } });
  expect((await bakeLockHolder(target))?.pid).toBe(process.pid);
});

test('locks are per provider and repo', async () => {
  expect((await acquireBakeLock({ ...target, pid: process.pid, log: null })).acquired).toBe(true);
  expect((await acquireBakeLock({ provider: 'p', repo: 'o/other', pid: process.pid, log: null })).acquired).toBe(true);
  expect((await acquireBakeLock({ provider: 'q', repo: 'o/r', pid: process.pid, log: null })).acquired).toBe(true);
});

test('a lock whose process died is taken over', async () => {
  const stale = await acquireBakeLock({ ...target, pid: await deadPid(), log: null });
  expect(stale.acquired).toBe(true);
  expect(await bakeLockHolder(target)).toBeNull();
  const taken = await acquireBakeLock({ ...target, pid: process.pid, log: null });
  expect(taken.acquired).toBe(true);
  expect((await bakeLockHolder(target))?.pid).toBe(process.pid);
});

test('release frees the lock only for the token that holds it', async () => {
  const first = await acquireBakeLock({ ...target, pid: process.pid, log: null });
  if (!first.acquired) throw new Error('expected the lock');
  await releaseBakeLock({ ...target, token: 'someone-else' });
  expect(await bakeLockHolder(target)).not.toBeNull();
  await releaseBakeLock({ ...target, token: first.token });
  expect(await bakeLockHolder(target)).toBeNull();
});

test('a transferred lock is held for as long as the new process lives', async () => {
  const first = await acquireBakeLock({ ...target, pid: await deadPid(), log: null });
  if (!first.acquired) throw new Error('expected the lock');
  const child = liveProcess();
  await transferBakeLock({ ...target, token: first.token, pid: child });
  expect((await bakeLockHolder(target))?.pid).toBe(child);
  expect((await acquireBakeLock({ ...target, pid: process.pid, log: null })).acquired).toBe(false);
});
