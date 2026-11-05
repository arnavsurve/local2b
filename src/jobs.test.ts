import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { followLog, jobStatus, listJobs, readLog, startJob } from './jobs';
import { fakeContext, withLocalShell } from './test/fake-provider';

async function localBox() {
  const homeDir = mkdtempSync(join(tmpdir(), 'l2b-jobs-'));
  const { ctx } = fakeContext({ execExitCode: 0, failExecWhen: null, homeDir });
  const base = await ctx.provider.create({ name: 'b', image: 'i', workdir: homeDir });
  return withLocalShell({ box: base });
}

async function waitDone({ box, id }: { box: Awaited<ReturnType<typeof localBox>>; id: string }) {
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
  const id = await startJob({ box, cwd: box.workdir, cmd: "sh -c 'sleep 1; echo done; echo oops >&2; exit 3'" });
  expect(Date.now() - started).toBeLessThan(800);
  expect(await jobStatus({ box, id })).toEqual({ state: 'running' });
  expect(await waitDone({ box, id })).toEqual({ state: 'exited', exitCode: 3 });
  const log = await readLog({ box, id });
  expect(log).toContain('done');
  expect(log).toContain('oops');
});

test('a job runs in the requested cwd with the box env sourced', async () => {
  const box = await localBox();
  mkdirSync(`${box.homeDir}/sub`);
  await Bun.write(`${box.homeDir}/.l2b-env`, 'export JOB_VAR=hello\n');
  const id = await startJob({ box, cwd: `${box.homeDir}/sub`, cmd: `sh -c 'echo $JOB_VAR; pwd'` });
  await waitDone({ box, id });
  const log = await readLog({ box, id });
  expect(log).toContain('hello');
  expect(log).toMatch(/\/sub\n$/);
});

test('listJobs shows each job with its state and command', async () => {
  const box = await localBox();
  const ok = await startJob({ box, cwd: box.workdir, cmd: 'true' });
  const bad = await startJob({ box, cwd: box.workdir, cmd: 'false' });
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
  const id = await startJob({ box, cwd: box.workdir, cmd: "sh -c 'sleep 1; exit 7'" });
  expect(await followLog({ box, id })).toBe(7);
});

test('a corrupt status file is an error naming the job', async () => {
  const box = await localBox();
  mkdirSync(`${box.homeDir}/.l2b-jobs/broken`, { recursive: true });
  await Bun.write(`${box.homeDir}/.l2b-jobs/broken/status`, 'garbage\n');
  await expect(jobStatus({ box, id: 'broken' })).rejects.toThrow('job broken');
  await expect(listJobs({ box })).rejects.toThrow('job broken');
});
