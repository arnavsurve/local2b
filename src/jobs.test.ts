import { afterEach, expect, test } from 'bun:test';
import { followLog, jobStatus, listJobs, readLog, startJob } from './jobs';
import type { Box } from './providers/types';
import { fakeClock, fakeProvider } from './test/fake-provider';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function localBox() {
  const fake = fakeProvider({ id: 'fake', clock: fakeClock({ start: Date.now() }), failure: null });
  cleanups.push(fake.cleanup);
  return fake.provider.start({
    name: 'b',
    repo: null,
    branch: null,
    source: 'fresh',
    image: null,
    idle: { minutes: 15 },
    credentials: { variables: { JOB_VAR: 'hello' }, git: null },
    gitIdentity: null,
  });
}

async function sh({ box, cmd }: { box: Box; cmd: string }) {
  const code = await box.exec({ cmd, cwd: null, onOutput: () => {} });
  if (code !== 0) throw new Error(`${cmd} exited ${code}`);
}

async function waitDone({ box, id }: { box: Box; id: string }) {
  for (let i = 0; i < 100; i++) {
    const status = await jobStatus({ box, id });
    if (status.state === 'exited') return status;
    await Bun.sleep(50);
  }
  throw new Error('job never exited');
}

test('startJob returns immediately while the command keeps running, then reports its exit code', async () => {
  const box = await localBox();
  const started = Date.now();
  const id = await startJob({ box, cwd: null, cmd: "sh -c 'sleep 1; echo done; echo oops >&2; exit 3'" });
  expect(Date.now() - started).toBeLessThan(800);
  expect(await jobStatus({ box, id })).toEqual({ state: 'running' });
  expect(await waitDone({ box, id })).toEqual({ state: 'exited', exitCode: 3 });
  const log = await readLog({ box, id });
  expect(log).toContain('done');
  expect(log).toContain('oops');
});

test('a job runs in the requested cwd with the box env sourced', async () => {
  const box = await localBox();
  await sh({ box, cmd: 'mkdir sub' });
  const id = await startJob({ box, cwd: `${box.workdir}/sub`, cmd: `sh -c 'echo $JOB_VAR; pwd'` });
  await waitDone({ box, id });
  const log = await readLog({ box, id });
  expect(log).toContain('hello');
  expect(log).toMatch(/\/sub\n$/);
});

test('listJobs shows each job with its state and command', async () => {
  const box = await localBox();
  const ok = await startJob({ box, cwd: null, cmd: 'true' });
  const bad = await startJob({ box, cwd: null, cmd: 'false' });
  await waitDone({ box, id: ok });
  await waitDone({ box, id: bad });
  const jobs = await listJobs({ box });
  expect(jobs.find((j) => j.id === ok)).toMatchObject({ state: 'exited', exitCode: 0 });
  expect(jobs.find((j) => j.id === bad)).toMatchObject({ state: 'exited', exitCode: 1 });
  expect(jobs.find((j) => j.id === ok)?.cmd).toBe("true");
});

test('an unknown job id is an error', async () => {
  const box = await localBox();
  await expect(readLog({ box, id: 'nope' })).rejects.toThrow('no job "nope"');
});

test('followLog waits for the job to finish and returns its exit code', async () => {
  const box = await localBox();
  const id = await startJob({ box, cwd: null, cmd: "sh -c 'sleep 1; exit 7'" });
  expect(await followLog({ box, id })).toBe(7);
});

test('a corrupt status file is an error naming the job', async () => {
  const box = await localBox();
  await sh({ box, cmd: 'mkdir -p "$HOME/.l2b-jobs/broken" && echo garbage > "$HOME/.l2b-jobs/broken/status"' });
  await expect(jobStatus({ box, id: 'broken' })).rejects.toThrow('job broken');
  await expect(listJobs({ box })).rejects.toThrow('job broken');
});
