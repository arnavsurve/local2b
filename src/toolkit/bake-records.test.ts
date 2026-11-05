import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeMachineHost } from '../test/fake-machine';
import { snapshotName } from './layout';
import { lookupSnapshot, recordBake } from './bake-records';

let stateDir = '';

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'l2b-state-'));
  process.env.XDG_STATE_HOME = stateDir;
});

afterEach(() => {
  delete process.env.XDG_STATE_HOME;
  rmSync(stateDir, { recursive: true, force: true });
});

test('lookupSnapshot has no snapshot until one exists, and no age until a bake is recorded', async () => {
  const { provider, snapshots } = fakeMachineHost({ id: 'fake', execExitCode: 0, homeDir: '/home/user', failure: null });
  expect(await lookupSnapshot({ provider, repo: 'o/r' })).toBeNull();
  snapshots.add(snapshotName('o/r'));
  expect((await lookupSnapshot({ provider, repo: 'o/r' }))?.createdAt).toBeNull();
  const at = new Date(Date.now() - 3_600_000);
  await recordBake({ provider: 'fake', repo: 'o/r', at });
  expect((await lookupSnapshot({ provider, repo: 'o/r' }))?.createdAt?.getTime()).toBe(at.getTime());
});

test('bake records are kept per provider', async () => {
  const { provider, snapshots } = fakeMachineHost({ id: 'fake', execExitCode: 0, homeDir: '/home/user', failure: null });
  snapshots.add(snapshotName('o/r'));
  await recordBake({ provider: 'other', repo: 'o/r', at: new Date() });
  expect((await lookupSnapshot({ provider, repo: 'o/r' }))?.createdAt).toBeNull();
});
