import { expect, test } from 'bun:test';
import type { Sandbox } from '@boatdev/sdk';
import { ENV_FILE } from '../../toolkit/session';
import {
  BASE_SNAPSHOT,
  STOCK_IMAGE,
  bakedBoxName,
  baseImageScript,
  createRequest,
  forkRequest,
  isExpiredBox,
  newestBake,
  exitCodeOf,
  inDirCommand,
  nameFilter,
  revokeKeyCommand,
  savedSnapshotName,
  sshArgs,
  sshTarget,
  summaryOf,
  ttlSeconds,
  workdirOf,
  writeRoute,
} from './requests';

const config = { type: 'small' as const, environment: null };

test('a box has snapshots and monitoring off, no account environment and no credentials', () => {
  const request = createRequest({ name: 'web', image: STOCK_IMAGE, workdir: '/home/user/app', idleMs: 15 * 60_000, config, bake: null });
  expect(request).toEqual({
    name: 'web',
    type: 'small',
    ttlSeconds: 900,
    labels: { l2b: 'web', 'l2b-workdir': '/home/user/app', 'l2b-image': STOCK_IMAGE },
    snapshots: false,
    monitoring: false,
    noEnv: true,
  });
  expect(request).not.toHaveProperty('env');
  expect(request).not.toHaveProperty('files');
  expect(request).not.toHaveProperty('setupScript');
});

test('a bake box keeps snapshots on and carries its bake label; a named environment replaces noEnv', () => {
  const request = createRequest({
    name: 'bake-api',
    image: 'my-saved-snapshot',
    workdir: '/home/user',
    idleMs: 60_000,
    config: { type: 'default', environment: 'base' },
    bake: 'l2b-acme-api',
  });
  expect(request.snapshots).toBe(true);
  expect(request.monitoring).toBe(false);
  expect(request.labels?.['l2b-bake']).toBe('l2b-acme-api');
  expect(request.from).toBe('my-saved-snapshot');
  expect(request.environment).toBe('base');
  expect(request).not.toHaveProperty('noEnv');
});

test('a box forked from a bake gets its own labels and no bake label, with snapshots and monitoring off', () => {
  const request = forkRequest({ name: 'web', image: 'l2b-acme-api', workdir: '/home/user/api', idleMs: 60_000, config, bake: null });
  expect(request).toEqual({
    type: 'small',
    ttlSeconds: 60,
    labels: { l2b: 'web', 'l2b-workdir': '/home/user/api', 'l2b-image': 'l2b-acme-api' },
    monitoring: false,
    snapshots: false,
    noEnv: true,
  });
  expect(request).not.toHaveProperty('env');
});

const stoppedBox = (over: Partial<{ id: string; name: string; state: Sandbox['state']; labels: Record<string, string>; stoppedAt: Date; dataExpiredAt: Date | null }>) => ({
  id: 'bx_a',
  name: bakedBoxName({ bake: 'l2b-acme-api' }),
  state: 'archived' as Sandbox['state'],
  labels: { l2b: 'bake-api', 'l2b-bake': 'l2b-acme-api' },
  stoppedAt: new Date('2026-11-01T00:00:00Z'),
  dataExpiredAt: null,
  ...over,
});

test('the bake is the newest finished, stopped bake box whose disk boat still keeps', () => {
  const older = stoppedBox({ id: 'bx_old' });
  const newer = stoppedBox({ id: 'bx_new', stoppedAt: new Date('2026-11-02T00:00:00Z') });
  const failed = stoppedBox({ id: 'bx_failed', name: 'bake-api', stoppedAt: new Date('2026-11-03T00:00:00Z') });
  const expired = stoppedBox({ id: 'bx_expired', stoppedAt: new Date('2026-11-04T00:00:00Z'), dataExpiredAt: new Date() });
  const running = stoppedBox({ id: 'bx_running', state: 'running' });
  const otherBake = stoppedBox({ id: 'bx_other', labels: { l2b: 'bake-web', 'l2b-bake': 'l2b-acme-web' } });
  const sandboxes = [older, newer, failed, expired, running, otherBake];
  expect(newestBake({ sandboxes, bake: 'l2b-acme-api' })?.id).toBe('bx_new');
  expect(newestBake({ sandboxes: [failed, expired, running], bake: 'l2b-acme-api' })).toBeNull();
});

test('stopped l2b boxes that are not finished bakes count as expired', () => {
  expect(isExpiredBox({ sandbox: stoppedBox({}) })).toBe(false);
  expect(isExpiredBox({ sandbox: stoppedBox({ name: 'bake-api' }) })).toBe(true);
  expect(isExpiredBox({ sandbox: stoppedBox({ labels: { l2b: 'web' } }) })).toBe(true);
  expect(isExpiredBox({ sandbox: stoppedBox({ labels: { l2b: 'web' }, state: 'running' }) })).toBe(false);
  expect(isExpiredBox({ sandbox: stoppedBox({ labels: { other: 'x' } }) })).toBe(false);
});

test('the auto-stop deadline stays inside what boat accepts', () => {
  expect(ttlSeconds({ idleMs: 1000 })).toBe(60);
  expect(ttlSeconds({ idleMs: 90_500 })).toBe(91);
  expect(ttlSeconds({ idleMs: 365 * 24 * 3600_000 })).toBe(30 * 24 * 3600);
});

test('boxes are found by their l2b label, and only labelled boxes are listed', () => {
  expect(nameFilter({ name: 'web' })).toEqual(['l2b=web']);
  expect(summaryOf({ sandbox: { id: 'bx_1', state: 'idle', labels: { l2b: 'web', 'l2b-image': 'l2b-acme-api' } } })).toEqual({
    name: 'web',
    state: 'idle',
    id: 'bx_1',
    image: 'l2b-acme-api',
  });
  expect(summaryOf({ sandbox: { id: 'bx_2', state: 'idle', labels: { other: 'x' } } })).toBeNull();
  expect(summaryOf({ sandbox: { id: 'bx_3', state: 'idle' } })).toBeNull();
  expect(workdirOf({ sandbox: { labels: { 'l2b-workdir': '/home/user/app' } } })).toBe('/home/user/app');
  expect(workdirOf({ sandbox: { labels: {} } })).toBe('/home/user');
});

test('saved snapshot names fit boat rules and stay distinct when shortened', () => {
  expect(savedSnapshotName({ name: 'l2b-acme-api' })).toBe('l2b-acme-api');
  const long = `l2b-${'a'.repeat(40)}-${'b'.repeat(40)}`;
  const other = `l2b-${'a'.repeat(40)}-${'c'.repeat(40)}`;
  for (const name of [long, other, 'L2B_Acme.API']) expect(savedSnapshotName({ name })).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
  expect(savedSnapshotName({ name: long })).not.toBe(savedSnapshotName({ name: other }));
  expect(savedSnapshotName({ name: long })).toBe(savedSnapshotName({ name: long }));
});

test('the credentials file and paths outside home and /tmp go over ssh, never the file API', () => {
  expect(writeRoute({ path: ENV_FILE })).toBe('ssh');
  expect(writeRoute({ path: '/etc/profile.d/x.sh' })).toBe('ssh');
  expect(writeRoute({ path: '/home/user/../../dev/shm/x' })).toBe('ssh');
  expect(writeRoute({ path: '/home/user/app/a.txt' })).toBe('files-api');
  expect(writeRoute({ path: '/tmp/a' })).toBe('files-api');
  expect(writeRoute({ path: '/tmpx/a' })).toBe('ssh');
});

test('commands change directory themselves and fail when it is missing', async () => {
  const cmd = inDirCommand({ cwd: "/tmp/it's", cmd: 'pwd' });
  const missing = Bun.spawnSync(['bash', '-c', cmd]);
  expect(missing.exitCode).toBe(1);
  const here = Bun.spawnSync(['bash', '-c', inDirCommand({ cwd: '/', cmd: 'pwd; exit 4' })]);
  expect(here.stdout.toString()).toBe('/\n');
  expect(here.exitCode).toBe(4);
});

test('exit codes come from the frame, or from the signal that ended the command', () => {
  expect(exitCodeOf({ frame: { exitCode: 0 } })).toBe(0);
  expect(exitCodeOf({ frame: { exitCode: 7 } })).toBe(7);
  expect(exitCodeOf({ frame: { exitCode: null, signal: 'SIGKILL' } })).toBe(137);
  expect(exitCodeOf({ frame: { exitCode: null, signal: 15 } })).toBe(143);
  expect(exitCodeOf({ frame: {} })).toBe(1);
});

test('ssh goes to the forwarded endpoint when boat sets one, and pins the reported host key', () => {
  expect(sshTarget({ machineIp: '2001:db8::1', sshEndpoint: '203.0.113.10:22001' })).toEqual({ host: '203.0.113.10', port: 22001 });
  expect(sshTarget({ machineIp: '203.0.113.10', sshEndpoint: null })).toEqual({ host: '203.0.113.10', port: 22 });
  expect(() => sshTarget({ machineIp: null, sshEndpoint: null })).toThrow();
  const args = sshArgs({ keyFile: '/k', knownHostsFile: '/kh', alias: 'l2b-boat-bx_1', target: { host: 'h', port: 2 } });
  expect(args.slice(0, 2)).toEqual(['-F', '/dev/null']);
  expect(args).toContain('StrictHostKeyChecking=yes');
  expect(args).toContain('HostKeyAlias=l2b-boat-bx_1');
  expect(args.at(-1)).toBe('user@h');
});

test('revoking a key removes only that key from authorized_keys', () => {
  const home = Bun.spawnSync(['mktemp', '-d']).stdout.toString().trim();
  const keep = 'ssh-ed25519 AAAAkeep+/= other';
  const drop = 'ssh-ed25519 AAAAdrop+/x= l2b-1234';
  Bun.spawnSync(['bash', '-c', `mkdir -p ${home}/.ssh && printf '%s\\n%s\\n' '${keep}' '${drop}' > ${home}/.ssh/authorized_keys`]);
  const run = Bun.spawnSync(['bash', '-c', revokeKeyCommand({ publicKey: drop })], { env: { ...process.env, HOME: home } });
  expect(run.exitCode).toBe(0);
  expect(Bun.spawnSync(['cat', `${home}/.ssh/authorized_keys`]).stdout.toString()).toBe(`${keep}\n`);
  expect(() => revokeKeyCommand({ publicKey: 'garbage' })).toThrow();
});

test('image build runs only what the config adds to the stock image', () => {
  expect(baseImageScript({ aptPackages: [], imageCommands: [] })).toBeNull();
  const script = baseImageScript({ aptPackages: ['postgresql', "x'y"], imageCommands: ['echo hi'] });
  expect(script).toContain("apt-get install -y -q 'postgresql' 'x'\\''y'");
  expect(script?.split('\n').at(-1)).toBe('echo hi');
  expect(BASE_SNAPSHOT).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
});
